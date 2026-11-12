'use strict';
/**
 * desk-v1 · 抖店客户端适配器（client-inject / Adapter Contract v2）
 *
 * 接入拓扑：
 *   抖店工作台（外部进程） ── IM 容器页 ── <script src=本机>/doudian-bridge.js
 *        └─ 容器页发现 im.jinritemai.com / darenim.jinritemai.com 的 <webview>
 *             └─ 向 IM 页注入同一份 bridge（页面模式）
 *   容器页暴露 window.__deskDoudianBridge.call(method, params)：
 *     - 离线/直接托管：适配器通过 deps.webContentsProvider 用 executeJavaScript 调它；
 *     - 真实客户端：容器页可选连接本机 RPC（地址由外部注入，脚本不写死），
 *       由 core 侧桥接对象通过 deps.doudianBridge 注入。协议见 docs/platform-onboarding.md §1.9。
 *
 * 契约：
 *   - accessMode = 'client-inject'；不建 WebContentsView、不 loadURL。
 *   - 业务失败只返回 4 个枚举；未知异常直接 throw。
 *   - 发送成功以页面回显确认为准；超时/无法确认返回 send_unconfirmed，禁止内部重试。
 *   - sendVideo 现有实现未暴露，V1 抛 unsupported_capability（不伪装成 hook_not_ready 死循环）。
 *
 * 红线：
 *   - 不逆向签名、不读 cookie、不上传凭据、不写死远端地址。
 *   - 不修改第三方客户端文件；桥接脚本由客户端页面从本机加载。
 */

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../shared/adapter-contract');

const { ok, fail } = contract;

const PLATFORM_ID = 'doudian-client';
const PLATFORM_NAME = '抖店工作台（doudian-client）';
const ACCESS_MODE = contract.ACCESS_MODES.CLIENT_INJECT;
const SUPPORTED_PLATFORMS = Object.freeze([PLATFORM_ID]);
const HOOK_PATH = path.join(__dirname, '..', 'injections', 'doudian-bridge.js');
const BRIDGE_GLOBAL = '__deskDoudianBridge';
const VERSION_GLOBAL = '__DESK_DOUDIAN_VER';
const VER_RE = /var\s+VER\s*=\s*(\d+)\s*;/;

const DEFAULT_TIMEOUTS = Object.freeze({
  ensure: 15000,
  read: 5000,
  prepare: 6000,
  popPending: 8000,
  send: 25000,
  sendMedia: 40000,
  history: 12000,
  focus: 12000,
});

function versionOf(source) {
  const m = VER_RE.exec(String(source || ''));
  return m ? Number(m[1]) : 0;
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || 'bridge 调用'}超时（${ms}ms）`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeFrom(from) {
  const v = String(from || '').toLowerCase();
  if (v === 'buyer' || v === 'seller' || v === 'system') return v;
  return 'system';
}

function toMessage(raw) {
  const m = raw || {};
  const ts = Number(m.ts) || 0;
  return {
    msgId: String(m.msgId || `ts:${ts}`),
    from: normalizeFrom(m.from),
    type: String(m.type || 'text'),
    content: String(m.content == null ? '' : m.content),
    ts,
  };
}

function sanitizeRow(raw) {
  const row = raw || {};
  return {
    uid: String(row.uid),
    messages: (Array.isArray(row.messages) ? row.messages : []).map(toMessage).sort((a, b) => a.ts - b.ts),
    ...(row.username ? { username: String(row.username) } : {}),
    ...(row.goodsTitle ? { goodsTitle: String(row.goodsTitle) } : {}),
    ...(row.orderId ? { orderId: String(row.orderId) } : {}),
    claimedAt: Number(row.claimedAt) || Date.now(),
  };
}

function unsupportedCapability(method, detail) {
  const err = new Error(`${PLATFORM_ID}:${method}:unsupported_capability${detail ? `:${detail}` : ''}`);
  err.code = 'unsupported_capability';
  err.reason = undefined;
  return err;
}

/* ------------------------------------------------------------------ *
 * 两种 bridge 形状统一成 { call(method, params, opts) }
 * ------------------------------------------------------------------ */
class WebContentsBridge {
  constructor(provider, { logger, injector, source, version } = {}) {
    this.provider = provider;
    this.logger = logger;
    this.injector = injector || null;
    this.source = source || '';
    this.version = version || 0;
    this.lastProbe = { at: 0, version: 0 };
    this.reinjects = 0;
    this.lastReinjectAt = 0;
  }

  wc() {
    let wc = null;
    try {
      wc = this.provider ? this.provider() : null;
    } catch (err) {
      const e = new Error(`doudian 容器页不可用：${err && err.message ? err.message : err}`);
      e.reason = 'hook_not_ready';
      throw e;
    }
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
      const e = new Error('doudian 容器页已销毁或未创建');
      e.reason = 'hook_not_ready';
      throw e;
    }
    return wc;
  }

  async probe() {
    const wc = this.wc();
    const value = await withTimeout(wc.executeJavaScript(`(window[${JSON.stringify(VERSION_GLOBAL)}]) || 0`, true), 4000, 'bridge 探测');
    this.lastProbe = { at: Date.now(), version: Number(value) || 0 };
    return numberOrZero(value);
  }

  async inject() {
    if (!this.source) return 0;
    const wc = this.wc();
    if (this.injector && typeof this.injector.call === 'function') {
      await this.injector.call(wc, this.source, { label: 'doudian-bridge 注入' });
    } else {
      await withTimeout(wc.executeJavaScript(this.source, true), DEFAULT_TIMEOUTS.ensure, 'bridge 注入');
    }
    return this.probe();
  }

  async call(method, params, opts = {}) {
    const wc = this.wc();
    const expr = `(async () => {
      const b = window[${JSON.stringify(BRIDGE_GLOBAL)}];
      if (!b || typeof b.call !== 'function') {
        return { ok: false, reason: 'hook_not_ready', detail: 'bridge_missing' };
      }
      try {
        return await b.call(${JSON.stringify(method)}, ${JSON.stringify(params || {})});
      } catch (err) {
        return { ok: false, reason: 'hook_not_ready', detail: String((err && err.message) || err) };
      }
    })()`;
    const ms = opts.timeoutMs || DEFAULT_TIMEOUTS.read;
    const invoke = async () => {
      const raw = await withTimeout(wc.executeJavaScript(expr, true), ms, opts.label || method);
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    };

    let result = await invoke();
    // 容器页自身 reload / SPA 路由切换后，全局 bridge 会消失：
    // 这里做一次“重新注入 + 重试”，失败则把 reinjectAttempts 透传给 core 排障。
    if (!isBridgeMissingResult(result) || !this.source) return result;
    try {
      this.reinjects = (this.reinjects || 0) + 1;
      this.lastReinjectAt = Date.now();
      const version = await this.inject();
      if (version > 0) {
        result = await invoke();
      }
      if (!isBridgeMissingResult(result)) {
        if (result && typeof result === 'object') result.reinjectAttempts = this.reinjects;
        return result;
      }
    } catch (err) {
      this.logger?.warn?.(`[doudian] bridge 重注入失败：${err && err.message ? err.message : err}`);
    }
    return {
      ok: false,
      reason: 'hook_not_ready',
      detail: 'bridge_missing',
      reinjectAttempts: this.reinjects || 1,
      reinjectFailed: true,
    };
  }
}

function isBridgeMissingResult(result) {
  return !!(
    result &&
    result.ok === false &&
    /bridge_missing|bridge_not_installed|bridge_undefined/i.test(String(result.detail || '') + ' ' + String(result.reason || ''))
  );
}

class ObjectBridge {
  constructor(bridge) {
    this.bridge = bridge;
  }
  async call(method, params, opts = {}) {
    const ms = opts.timeoutMs || DEFAULT_TIMEOUTS.read;
    const run = Promise.resolve().then(() => this.bridge.call(method, params || {}));
    return withTimeout(run, ms, opts.label || method);
  }
  async ensure() {
    if (typeof this.bridge.ensure === 'function') return this.bridge.ensure();
    return true;
  }
}

function numberOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ *
 * 适配器
 * ------------------------------------------------------------------ */
class DoudianAdapter {
  constructor({ store, logger, config, doudianBridge, webContentsProvider, getWebContents, injector } = {}) {
    const platformId = String(store && store.platform ? store.platform : PLATFORM_ID);
    if (!SUPPORTED_PLATFORMS.includes(platformId)) {
      throw new Error(`unsupported_platform:${platformId}`);
    }

    this.id = PLATFORM_ID;
    this.accessMode = ACCESS_MODE;
    this.platform = PLATFORM_ID;
    this.platformName = PLATFORM_NAME;
    this.store = store || null;
    this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
    this.config = config || {};
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(this.config.adapter && this.config.adapter.timeouts) };
    this.expectedShopId = String(
      (this.config.adapter && this.config.adapter.expectedShopId) ||
        (store && (store.shopId || store.serviceId)) ||
        '',
    );
    this.injector = injector || null;

    const provider =
      typeof getWebContents === 'function'
        ? getWebContents
        : typeof webContentsProvider === 'function'
          ? webContentsProvider
          : null;

    let source = '';
    let version = 0;
    if (provider && this.config.adapter?.injectHookSource !== false) {
      try {
        source = fs.readFileSync(HOOK_PATH, 'utf8');
        version = versionOf(source);
      } catch (err) {
        this.logger.warn?.(`[doudian] 读取 bridge 源码失败：${err && err.message ? err.message : err}`);
      }
    }

    if (doudianBridge && typeof doudianBridge.call === 'function') {
      this.transport = new ObjectBridge(doudianBridge);
      this.transportKind = 'rpc';
    } else if (provider) {
      this.transport = new WebContentsBridge(provider, {
        logger: this.logger,
        injector: this.injector,
        source,
        version,
      });
      this.transportKind = 'webcontents';
    } else {
      this.transport = null;
      this.transportKind = 'none';
    }

    this.bridgeVersion = version;
    this.lastFailure = null;
  }

  supports(platformId) {
    return SUPPORTED_PLATFORMS.includes(String(platformId || ''));
  }

  /* ------------------------------------------------------------------ *
   * 内部：调用与失败映射
   * ------------------------------------------------------------------ */
  _noTransport(method) {
    this.lastFailure = { method, reason: 'hook_not_ready', detail: 'doudian_bridge_not_connected', at: Date.now() };
    return fail('hook_not_ready', 'doudian_bridge_not_connected');
  }

  _mapReason(err) {
    if (!err) return null;
    if (err.reason && contract.isFailureReason(err.reason)) return err.reason;
    const msg = String((err && (err.message || err)) || '');
    if (/超时|timeout/i.test(msg)) return null; // 由发送/读取分别处理
    if (/hook_not_ready|未连接|bridge_missing|no_im_webview|webview_not_ready|未注入|页面已销毁|isDestroyed|destroyed/i.test(msg)) {
      return 'hook_not_ready';
    }
    if (/input_busy|editor_busy/i.test(msg)) return 'input_busy';
    if (/input_not_found|shop_mismatch|未找到这家店的客服页|会话不存在/i.test(msg)) return 'input_not_found';
    if (/send_unconfirmed|no_message_echo|no_image_echo/i.test(msg)) return 'send_unconfirmed';
    return null;
  }

  _failOrThrow(method, err) {
    const detail = String((err && (err.message || err)) || err || '').slice(0, 300);
    if (/超时|timeout/i.test(detail)) {
      this.lastFailure = { method, reason: 'hook_not_ready', detail, at: Date.now() };
      return fail('hook_not_ready', detail);
    }
    const reason = this._mapReason(err);
    this.lastFailure = { method, reason, detail, at: Date.now() };
    if (!reason) throw err;
    try {
      this.logger.warn?.(`[doudian] ${method} 失败（${reason}）：${detail}`);
    } catch (e) {}
    return fail(reason, detail);
  }

  _sendFailOrThrow(method, err) {
    const detail = String((err && (err.message || err)) || err || '').slice(0, 300);
    if (/超时|timeout/i.test(detail)) return fail('send_unconfirmed', `发送结果未知：${detail}`);
    return this._failOrThrow(method, err);
  }

  async _call(method, params, opts = {}) {
    if (!this.transport) {
      const err = new Error('doudian_bridge_not_connected');
      err.reason = 'hook_not_ready';
      throw err;
    }
    return this.transport.call(method, params, opts);
  }

  _rawFail(method, raw, fallback = 'hook_not_ready') {
    const reason = raw && contract.isFailureReason(raw.reason) ? raw.reason : fallback;
    return fail(reason, String((raw && (raw.detail || raw.reason)) || '').slice(0, 300));
  }

  /* ------------------------------------------------------------------ *
   * 契约 1/16：ensure
   * ------------------------------------------------------------------ */
  async ensure() {
    if (!this.transport) {
      this.lastFailure = { method: 'ensure', reason: 'hook_not_ready', detail: 'doudian_bridge_not_connected', at: Date.now() };
      return fail('hook_not_ready', 'doudian_bridge_not_connected');
    }
    try {
      if (this.transportKind === 'webcontents') {
        let version = await this.transport.probe();
        if (version !== this.bridgeVersion) {
          version = await this.transport.inject();
          if (version !== this.bridgeVersion) {
            return this._failOrThrow(
              'ensure',
              new Error(`bridge 注入未生效（期望 v${this.bridgeVersion}，实际 v${version}）`),
            );
          }
          try {
            this.logger.info?.(`[doudian] bridge 已注入 v${this.bridgeVersion}`);
          } catch (e) {}
        }
      }
      const raw = await this._call('ensure', {}, { timeoutMs: this.timeouts.ensure, label: 'ensure' });
      if (!raw || raw.ok !== true) return this._rawFail('ensure', raw, 'hook_not_ready');
      this.lastFailure = null;
      // 保留 bridge 的就绪诊断字段，core 排障不必再单独调 stats。
      const extra = {};
      if (raw.shopId) extra.shopId = String(raw.shopId);
      for (const key of [
        'mode',
        'webviewFound',
        'webviewCount',
        'targets',
        'targetCount',
        'reinjectAttempts',
        'armed',
        'collection',
        'via',
      ]) {
        if (raw[key] !== undefined) extra[key] = raw[key];
      }
      return ok(extra);
    } catch (err) {
      return this._failOrThrow('ensure', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约：preparePending / popPending / pendingSnapshot
   * ------------------------------------------------------------------ */
  async preparePending() {
    try {
      const raw = await this._call('preparePending', {}, { timeoutMs: this.timeouts.prepare, label: 'preparePending' });
      return raw && raw.ok === true ? ok() : this._rawFail('preparePending', raw);
    } catch (err) {
      return this._failOrThrow('preparePending', err);
    }
  }

  async popPending() {
    const raw = await this._call('popPending', {}, { timeoutMs: this.timeouts.popPending, label: 'popPending' });
    if (!raw || raw.ok === false) {
      if (raw && contract.isFailureReason(raw.reason)) return null;
      return null;
    }
    if (!raw.uid) return null;
    return sanitizeRow(raw);
  }

  async pendingSnapshot() {
    try {
      const raw = await this._call('pendingSnapshot', {}, { timeoutMs: this.timeouts.read, label: 'pendingSnapshot' });
      if (!raw || raw.ok === false) return this._rawFail('pendingSnapshot', raw);
      const uids = Array.isArray(raw.uids) ? raw.uids.map(String).filter(Boolean) : [];
      return ok({ count: uids.length, uids });
    } catch (err) {
      return this._failOrThrow('pendingSnapshot', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约：conversationHistory
   * ------------------------------------------------------------------ */
  async conversationHistory(uid, opts = {}) {
    if (!uid) return fail('input_not_found', 'uid_required');
    const limit = Number(opts && opts.limit) > 0 ? Math.min(Number(opts.limit), 100) : 20;
    try {
      const raw = await this._call(
        'conversationHistory',
        { uid: String(uid), limit },
        { timeoutMs: this.timeouts.history, label: 'conversationHistory' },
      );
      if (Array.isArray(raw)) {
        return ok({ messages: raw.map(toMessage).sort((a, b) => a.ts - b.ts).slice(-limit) });
      }
      if (raw && raw.ok === false) return this._rawFail('conversationHistory', raw);
      const list = raw && Array.isArray(raw.messages) ? raw.messages : [];
      return ok({ messages: list.map(toMessage).sort((a, b) => a.ts - b.ts).slice(-limit) });
    } catch (err) {
      return this._failOrThrow('conversationHistory', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约：发送
   * ------------------------------------------------------------------ */
  async sendText(uid, text, opts = {}) {
    if (!uid) throw new TypeError('sendText: uid 不能为空');
    const content = String(text == null ? '' : text).trim();
    if (!content) throw new TypeError('sendText: text 不能为空');
    if (!this.transport) return this._noTransport('sendText');
    try {
      const raw = await this._call(
        'sendText',
        { uid: String(uid), text: content, expectedShopId: this.expectedShopId || undefined },
        { timeoutMs: Number(opts && opts.timeoutMs) || this.timeouts.send, label: 'sendText' },
      );
      if (!raw || raw.ok !== true) {
        if (raw && contract.isFailureReason(raw.reason)) return fail(raw.reason, raw.detail);
        throw new Error(`sendText 未返回受控结果：${(raw && (raw.reason || raw.detail)) || 'unknown'}`);
      }
      return raw.msgId ? ok({ msgId: String(raw.msgId) }) : ok();
    } catch (err) {
      return this._sendFailOrThrow('sendText', err);
    }
  }

  _mediaPayload(payload, method) {
    const p = payload || {};
    if (p.base64) {
      return { mode: 'base64', payload: String(p.base64), filename: p.filename || 'image.png', mime: p.mime };
    }
    if (p.url) {
      return { mode: 'url', payload: String(p.url), filename: p.filename || 'image.png', mime: p.mime };
    }
    if (p.dataUrl || p.payload) {
      const raw = String(p.dataUrl || p.payload);
      return { mode: raw.startsWith('data:') ? 'dataurl' : 'url', payload: raw, filename: p.filename || 'image.png', mime: p.mime };
    }
    throw new TypeError(`${method}: payload 需要 url 或 base64`);
  }

  async sendImage(uid, payload, opts = {}) {
    if (!uid) throw new TypeError('sendImage: uid 不能为空');
    const normalized = this._mediaPayload(payload, 'sendImage');
    if (!this.transport) return this._noTransport('sendImage');
    try {
      const raw = await this._call(
        'sendImage',
        { uid: String(uid), payload: normalized, expectedShopId: this.expectedShopId || undefined },
        { timeoutMs: this.timeouts.sendMedia, label: 'sendImage' },
      );
      if (!raw || raw.ok !== true) {
        if (raw && contract.isFailureReason(raw.reason)) return fail(raw.reason, raw.detail);
        throw new Error(`sendImage 未返回受控结果：${(raw && (raw.reason || raw.detail)) || 'unknown'}`);
      }
      return raw.msgId ? ok({ msgId: String(raw.msgId) }) : ok();
    } catch (err) {
      return this._sendFailOrThrow('sendImage', err);
    }
  }

  async sendVideo(uid, payload) {
    if (!uid) throw new TypeError('sendVideo: uid 不能为空');
    this._mediaPayload(payload, 'sendVideo');
    // 现有实现未暴露视频发送；不伪装成可重试的 hook_not_ready。
    throw unsupportedCapability('sendVideo', 'doudian_video_unverified');
  }

  /* ------------------------------------------------------------------ *
   * 契约：release / discard / popMerchantSent
   * ------------------------------------------------------------------ */
  async release(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    if (!this.transport) return this._noTransport('release');
    try {
      const raw = await this._call('release', { uid: String(uid) }, { timeoutMs: this.timeouts.read, label: 'release' });
      if (raw && raw.ok === false) return this._rawFail('release', raw);
      return ok({ released: !!(raw && raw.released) });
    } catch (err) {
      return this._failOrThrow('release', err);
    }
  }

  async discard(uid, opts = {}) {
    if (!uid) return fail('input_not_found', 'uid_required');
    if (!this.transport) return this._noTransport('discard');
    try {
      const beforeTs = Number(opts && opts.beforeTs) || 0;
      const raw = await this._call(
        'discard',
        { uid: String(uid), beforeTs },
        { timeoutMs: this.timeouts.read, label: 'discard' },
      );
      return raw && raw.ok === false ? this._rawFail('discard', raw) : ok();
    } catch (err) {
      return this._failOrThrow('discard', err);
    }
  }

  async popMerchantSent() {
    if (!this.transport) return [];
    const raw = await this._call('popMerchantSent', {}, { timeoutMs: this.timeouts.read, label: 'popMerchantSent' });
    const rows = Array.isArray(raw) ? raw : raw && Array.isArray(raw.rows) ? raw.rows : [];
    return rows
      .filter((r) => r && r.uid && r.message)
      .map((r) => ({ uid: String(r.uid), message: toMessage(r.message) }));
  }

  /* ------------------------------------------------------------------ *
   * 契约：syncAiEnabled / focusConversation
   * ------------------------------------------------------------------ */
  async syncAiEnabled(enabled) {
    if (!this.transport) return this._noTransport('syncAiEnabled');
    try {
      const raw = await this._call(
        'syncAiEnabled',
        { enabled: !!enabled },
        { timeoutMs: this.timeouts.read, label: 'syncAiEnabled' },
      );
      return raw && raw.ok === false ? this._rawFail('syncAiEnabled', raw) : ok();
    } catch (err) {
      return this._failOrThrow('syncAiEnabled', err);
    }
  }

  async focusConversation(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    if (!this.transport) return this._noTransport('focusConversation');
    try {
      const raw = await this._call(
        'focusConversation',
        { uid: String(uid), expectedShopId: this.expectedShopId || undefined },
        { timeoutMs: this.timeouts.focus, label: 'focusConversation' },
      );
      if (raw && raw.ok === true) return ok();
      const reason = raw && contract.isFailureReason(raw.reason) ? raw.reason : 'input_not_found';
      return fail(reason, String((raw && (raw.detail || raw.reason)) || 'conversation_not_found'));
    } catch (err) {
      return this._failOrThrow('focusConversation', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 扩展：诊断（core 不依赖）
   * ------------------------------------------------------------------ */
  async probe() {
    if (!this.transport) return fail('hook_not_ready', 'doudian_bridge_not_connected');
    try {
      const version = await this._call('selfTest', {}, { timeoutMs: this.timeouts.read, label: 'probe' });
      return ok({ selfTest: version || null, bridgeVersion: this.bridgeVersion });
    } catch (err) {
      return this._failOrThrow('probe', err);
    }
  }

  _diag(raw) {
    const out = {};
    for (const key of [
      'mode',
      'webviewFound',
      'webviewCount',
      'targets',
      'targetCount',
      'reinjects',
      'reinjectAttempts',
      'armed',
      'collection',
      'shopId',
      'pending',
      'ingested',
      'domScans',
    ]) {
      if (raw && raw[key] !== undefined) out[key] = raw[key];
    }
    return out;
  }

  async stats() {
    if (!this.transport) return fail('hook_not_ready', 'doudian_bridge_not_connected');
    try {
      const raw = await this._call('stats', {}, { timeoutMs: this.timeouts.read, label: 'stats' });
      if (!raw || raw.ok === false) return this._rawFail('stats', raw || { reason: 'hook_not_ready' });
      return ok({ ...this._diag(raw), stats: raw });
    } catch (err) {
      return this._failOrThrow('stats', err);
    }
  }

  async selfTest() {
    if (!this.transport) return fail('hook_not_ready', 'doudian_bridge_not_connected');
    try {
      const raw = await this._call('selfTest', {}, { timeoutMs: this.timeouts.read, label: 'selfTest' });
      if (!raw || raw.ok === false) return this._rawFail('selfTest', raw || { reason: 'hook_not_ready' });
      return ok({ ...this._diag(raw), selfTest: raw });
    } catch (err) {
      return this._failOrThrow('selfTest', err);
    }
  }

  async scanNow() {
    if (!this.transport) return fail('hook_not_ready', 'doudian_bridge_not_connected');
    try {
      const raw = await this._call('scanNow', {}, { timeoutMs: this.timeouts.prepare, label: 'scanNow' });
      if (raw && raw.ok === false) return this._rawFail('scanNow', raw);
      return ok(this._diag(raw || {}));
    } catch (err) {
      return this._failOrThrow('scanNow', err);
    }
  }

  async popSent(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    if (!this.transport) return this._noTransport('popSent');
    try {
      const raw = await this._call('popSent', { uid: String(uid) }, { timeoutMs: this.timeouts.read, label: 'popSent' });
      const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.messages) ? raw.messages : [];
      return ok({ messages: list.map(toMessage) });
    } catch (err) {
      return this._failOrThrow('popSent', err);
    }
  }

  /**
   * 非契约扩展（与 stats / popSent 同级）：只读消息事件出口。
   * 接口与 electron-core 约定固定：
   *   drainEvents({ sinceSeq }) -> { ok, seq, events:[{seq,uid,username,from,type,content,msgId,ts,goodsTitle}] }
   * 不清 pending、不影响 claim；参数缺省时由 bridge 取缓冲内最后 200 条。
   */
  async drainEvents(params = {}) {
    if (!this.transport) return this._noTransport('drainEvents');
    const rawSince = params ? params.sinceSeq : undefined;
    const hasSince = rawSince !== undefined && rawSince !== null && rawSince !== '' && Number.isFinite(Number(rawSince));
    const payload = hasSince ? { sinceSeq: Math.max(0, Number(rawSince)) } : {};
    try {
      const raw = await this._call('drainEvents', payload, { timeoutMs: this.timeouts.read, label: 'drainEvents' });
      if (!raw || raw.ok === false) return this._rawFail('drainEvents', raw || {});
      return ok({
        seq: Number(raw.seq) || 0,
        events: Array.isArray(raw.events) ? raw.events : [],
      });
    } catch (err) {
      return this._failOrThrow('drainEvents', err);
    }
  }

  status() {
    return {
      id: this.id,
      accessMode: this.accessMode,
      transportKind: this.transportKind,
      bridgeVersion: this.bridgeVersion,
      expectedShopId: this.expectedShopId || '',
      configured: !!this.transport,
      reason: this.transport ? '' : 'doudian_bridge_not_connected',
      lastFailure: this.lastFailure,
    };
  }
}

module.exports = {
  DoudianAdapter,
  PLATFORM_ID,
  PLATFORM_NAME,
  ACCESS_MODE,
  SUPPORTED_PLATFORMS,
  HOOK_PATH,
  BRIDGE_GLOBAL,
  versionOf,
  WebContentsBridge,
  ObjectBridge,
  unsupportedCapability,
};

