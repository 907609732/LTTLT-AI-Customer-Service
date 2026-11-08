'use strict';
/**
 * 店铺窗口管理：一店一个 WebContentsView，共用主窗口网格铺排。
 * 隔离：每店独立 session 分区（persist:desk-store-<id>），cookie 不共享。
 * 平台入口 URL 由平台层注入 resolveEntryUrl，core 不写死任何平台域名。
 * D-01：非 webview 接入（client-inject / dual-hook）不建页面窗口，登记等待外部客户端。
 */
const path = require('node:path');
const { WebContentsView, session, shell } = require('electron');
const { partitionOf } = require('./store-registry');
const { ClientWaitController, DEFAULT_TIMEOUT_MS: DEFAULT_CLIENT_WAIT_MS } = require('./client-wait');
const UiText = require('../shared/ui-text');

const SHOP_PRELOAD = path.join(__dirname, '..', 'preload', 'shop-preload.cjs');
const DEFAULT_HEALTH_CHECK_MS = 15000;

/** 健康检查超时后必须给出可读原因，不能把页面永久留在「加载中」。 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || '调用'}超时（${ms}ms）`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class ShopWindowManager {
  constructor({
    window,
    registry,
    logger,
    resolveEntryUrl,
    resolveAccessMode,
    prepareStore = null,
    ensureClientRunning = null,
    healthCheckTimeoutMs = DEFAULT_HEALTH_CHECK_MS,
    clientWaitTimeoutMs = DEFAULT_CLIENT_WAIT_MS,
    clientWaitProbeIntervalMs = 5000,
    clientWait = null,
    onEvent = null,
  }) {
    this.window = window;
    this.registry = registry;
    this.logger = logger;
    this.resolveEntryUrl = resolveEntryUrl;
    this.resolveAccessMode = resolveAccessMode;
    // 平台层能力：建完窗口后调用适配器 ensure()（注入 hook + 版本握手）。
    // core 不关心实现，只知道成功/失败。
    this.prepareStore = prepareStore;
    // 外部客户端平台：打开店铺时「未运行则启动」，已在运行只等待；重启只能由按钮触发。
    this.ensureClientRunning = ensureClientRunning;
    this.healthCheckTimeoutMs = healthCheckTimeoutMs;
    this.clientWait =
      clientWait ||
      new ClientWaitController({
        timeoutMs: clientWaitTimeoutMs,
        intervalMs: clientWaitProbeIntervalMs,
      });
    this.onEvent = onEvent;
    this.views = new Map();
    this.configuredSessions = new Set();
    this.sidebarWidth = 300;
  }

  #sessionFor(store) {
    const partition = partitionOf(store);
    const ses = session.fromPartition(partition, { cache: true });
    if (!this.configuredSessions.has(partition)) {
      ses.setPermissionRequestHandler((_wc, permission, callback) => {
        const allowed = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'];
        callback(allowed.includes(permission));
      });
      ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
      this.configuredSessions.add(partition);
    }
    return ses;
  }

  async open(storeId) {
    const existing = this.views.get(storeId);
    if (existing) {
      this.#relayout();
      // 再次点「打开」= 重试（webview 重跑健康检查；客户端店铺重启等待窗口）。
      if (existing.view) await this.#verifyAndMark(storeId, existing);
      else {
        const store = this.registry.get(storeId) || existing.store;
        await this.#ensureClientStarted(store);
        this.#startClientWait(storeId, existing);
      }
      return existing.view || null;
    }
    const store = this.registry.get(storeId);
    if (!store) throw new Error(`store_not_found:${storeId}`);

    const accessMode = (await this.resolveAccessMode?.(store)) || 'webview';
    if (accessMode !== 'webview') {
      // 外部客户端由用户侧启动；core 只登记并等待适配器 ensure 成功
      const entry = {
        view: null,
        store,
        accessMode,
        awaitingClient: true,
        online: false,
        lastError: '',
      };
      this.views.set(storeId, entry);
      this.registry.markOpened(storeId);
      this.logger?.info(`店铺 ${store.storeName} ${UiText.awaitingFor(store.platform)}接入（${accessMode}）`);
      this.onEvent?.({ type: 'shop:awaiting_client', storeId, platform: store.platform, accessMode });
      await this.#ensureClientStarted(store);
      this.#startClientWait(storeId, entry);
      return null;
    }

    const url = await this.resolveEntryUrl?.(store);
    if (!url) throw new Error(`entry_url_missing:${store.platform}`);

    this.#sessionFor(store);
    const view = new WebContentsView({
      webPreferences: {
        partition: partitionOf(store),
        preload: SHOP_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#0f1218');
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      shell.openExternal(target).catch(() => {});
      return { action: 'deny' };
    });
    view.webContents.on('render-process-gone', (_e, details) => {
      const entry = this.views.get(storeId);
      if (entry) {
        entry.online = false;
        entry.lastError = `页面异常退出：${details?.reason || 'unknown'}`;
      }
      this.logger?.error(`店铺窗口异常退出 store=${storeId} reason=${details?.reason}`);
      this.onEvent?.({ type: 'shop:crash', storeId, reason: details?.reason });
    });
    // 页面主框架加载失败时也要落 lastError，而不是停在「打开中」。
    view.webContents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      const entry = this.views.get(storeId);
      const message = `${errorDescription || 'load_failed'} (${errorCode})`;
      if (entry) {
        entry.online = false;
        entry.lastError = message;
      }
      this.registry.markError(storeId, message);
      this.onEvent?.({ type: 'shop:open_failed', storeId, platform: store.platform, accessMode, reason: message });
    });

    this.window.contentView.addChildView(view);
    const entry = { view, store, accessMode, awaitingClient: false, online: false, lastError: '' };
    this.views.set(storeId, entry);
    this.#relayout();

    try {
      await view.webContents.loadURL(url);
    } catch (err) {
      this.close(storeId);
      this.registry.markError(storeId, String(err?.message || err));
      throw err;
    }

    // 页面已加载：调用适配器 ensure()（注入平台 hook），失败不关窗，留给用户登录/重试。
    await this.#verifyAndMark(storeId, entry);
    return view;
  }

  /**
   * 打开外部客户端店铺时的启动策略：未运行才 launch，已运行保持不动。
   * 任何失败都只写日志，不阻断「等待客户端」流程（等待期仍会做探测与超时提示）。
   */
  async #ensureClientStarted(store) {
    if (typeof this.ensureClientRunning !== 'function') return;
    try {
      const result = await this.ensureClientRunning(store);
      if (result && result.ok === false && result.reason !== 'unsupported_platform') {
        this.logger?.warn(
          `客户端未启动 ${store.storeName}：${result.reason || 'unknown'}（仍进入等待）`,
        );
      }
    } catch (err) {
      this.logger?.warn(`客户端启动检查失败 ${store.storeName}：${err?.message || err}`);
    }
  }

  /**
   * 等待外部客户端：打开后先显示等待，立即探测一次，之后轮询；
   * 超过 clientWaitTimeoutMs 仍未连上只发一次错误事件（避免刷屏）。
   */
  #startClientWait(storeId, entry) {
    const store = this.registry.get(storeId) || entry.store;
    entry.awaitingClient = true;
    entry.online = false;
    entry.lastError = '';
    // 重试时也要清掉上一轮的错误记录，界面才会回到「等待客户端」。
    this.registry.markOpened(storeId);
    this.clientWait.wait(storeId, {
      platformId: store.platform,
      probe: () => this.#probeClient(store),
      onReady: () => this.#markClientReady(storeId, store),
      onExpired: (_id, message) => this.#markClientUnavailable(storeId, store, message),
    });
  }

  async #probeClient(store) {
    if (typeof this.prepareStore !== 'function') {
      return { ok: false, reason: 'adapter_factory_missing' };
    }
    try {
      return await withTimeout(
        Promise.resolve(this.prepareStore(store)),
        this.healthCheckTimeoutMs,
        '客户端连接检查',
      );
    } catch (err) {
      return { ok: false, reason: err?.reason || 'client_probe_failed', detail: String(err?.message || err) };
    }
  }

  #markClientReady(storeId, store) {
    const entry = this.views.get(storeId);
    if (!entry || entry.view) return;
    entry.awaitingClient = false;
    entry.online = true;
    entry.lastError = '';
    this.registry.markOpened(storeId);
    this.logger?.info(`店铺 ${store.storeName} 已连接（${entry.accessMode}）`);
    this.onEvent?.({ type: 'shop:opened', storeId, platform: store.platform, accessMode: entry.accessMode });
  }

  #markClientUnavailable(storeId, store, message) {
    const entry = this.views.get(storeId);
    if (!entry || entry.view) return;
    entry.awaitingClient = false;
    entry.online = false;
    entry.lastError = message;
    this.registry.markError(storeId, message);
    this.logger?.warn(`店铺 ${store.storeName} 连接失败：${message}`);
    this.onEvent?.({
      type: 'shop:client_unavailable',
      storeId,
      platform: store.platform,
      accessMode: entry.accessMode,
      message,
    });
  }

  /**
   * 健康检查：由平台层 ensure() 完成注入与版本握手，core 只负责超时与记录。
   * 失败保留窗口（用户可能只是没登录），状态置 error 并写 lastError。
   */
  async #verifyAndMark(storeId, entry) {
    const store = this.registry.get(storeId) || entry.store;
    let result = { ok: true, skipped: true };
    if (typeof this.prepareStore === 'function') {
      try {
        result = await withTimeout(
          Promise.resolve(this.prepareStore(store)),
          this.healthCheckTimeoutMs,
          '店铺健康检查',
        );
      } catch (err) {
        result = { ok: false, reason: err?.reason || 'health_check_failed', detail: String(err?.message || err) };
      }
    }

    if (result && result.ok) {
      entry.online = true;
      entry.lastError = '';
      this.registry.markOpened(storeId);
      this.logger?.info(`店铺页面就绪：${store.storeName}（${entry.accessMode}）`);
      this.onEvent?.({ type: 'shop:opened', storeId, platform: store.platform, accessMode: entry.accessMode });
      return true;
    }

    entry.online = false;
    const detail = String(result?.detail || result?.reason || 'health_check_failed').slice(0, 300);
    entry.lastError = detail;
    this.registry.markError(storeId, detail);
    this.logger?.warn(`店铺健康检查未通过：${store.storeName}（${detail}）`);
    this.onEvent?.({
      type: 'shop:open_failed',
      storeId,
      platform: store.platform,
      accessMode: entry.accessMode,
      reason: detail,
    });
    return false;
  }

  /**
   * 重启客户端成功后重新进入等待/探测（覆盖上一轮已超时进入 error 的情况）。
   * 只对已打开的外部客户端店铺生效；webview 店铺不参与。
   */
  retryClient(storeId) {
    const entry = this.views.get(storeId);
    if (!entry || entry.view) return false;
    const store = this.registry.get(storeId) || entry.store;
    this.#startClientWait(storeId, entry);
    return true;
  }

  close(storeId) {
    const entry = this.views.get(storeId);
    if (!entry) return false;
    this.clientWait.stop(storeId);
    this.views.delete(storeId);
    if (entry.view) {
      try {
        this.window.contentView.removeChildView(entry.view);
        entry.view.webContents.close();
      } catch {
        /* 窗口已销毁 */
      }
    }
    this.#relayout();
    this.onEvent?.({ type: 'shop:closed', storeId });
    return true;
  }

  closeAll() {
    for (const id of [...this.views.keys()]) this.close(id);
  }

  webContentsOf(storeId) {
    return this.views.get(storeId)?.view?.webContents || null;
  }

  modeOf(storeId) {
    return this.views.get(storeId)?.accessMode || null;
  }

  isAwaitingClient(storeId) {
    return !!this.views.get(storeId)?.awaitingClient;
  }

  /**
   * 渲染层用的运行态快照（不参与持久化）：
   * online 表示页面已加载且适配器 ensure() 成功；client-inject 店铺只有 awaitingClient。
   */
  stateOf(storeId) {
    const entry = this.views.get(storeId);
    if (!entry) {
      return { open: false, accessMode: null, awaitingClient: false, online: false, lastError: '' };
    }
    const alive = !entry.view || !entry.view.webContents?.isDestroyed?.();
    return {
      open: true,
      accessMode: entry.accessMode,
      awaitingClient: !!entry.awaitingClient,
      online: !!(entry.online && alive && !entry.awaitingClient),
      lastError: entry.awaitingClient ? '' : String(entry.lastError || ''),
    };
  }

  list() {
    return [...this.views.keys()];
  }

  #relayout() {
    const ids = [...this.views.entries()].filter(([, entry]) => entry.view).map(([id]) => id);
    if (!ids.length) return;
    const [width, height] = this.window.getContentSize();
    const sidebar = this.sidebarWidth;
    const areaWidth = Math.max(320, width - sidebar);
    const columns = Math.min(ids.length, Math.max(1, Math.floor(areaWidth / 640)));
    const rows = Math.ceil(ids.length / columns);
    const cellWidth = Math.floor(areaWidth / columns);
    const cellHeight = Math.floor(height / rows);
    ids.forEach((id, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      this.views.get(id).view.setBounds({
        x: sidebar + col * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
    });
  }

  relayout() {
    this.#relayout();
  }
}

module.exports = { ShopWindowManager };
