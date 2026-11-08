'use strict';
/**
 * 主进程入口。装配顺序：数据目录 → 日志 → 配置 → 注册表 → AI → 窗口 → 平台适配器 → 回复引擎 → IPC。
 *
 * 边界：core 不知道任何平台域名/DOM。平台能力通过可选的 src/adapters 模块注入；
 * 该目录归 platform-hooks 所有，本文件只按约定调用 createAdapter / entryUrlFor。
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// paths.js 在 require 时读取 DESK_DATA_DIR；必须在加载本地模块前指向 userData
if (!process.env.DESK_DATA_DIR) {
  process.env.DESK_DATA_DIR = app.getPath('userData');
}

const { dataDir, dataFile } = require('./paths');
const { Logger } = require('./logger');
const { Config } = require('./config');
const { StoreRegistry } = require('./store-registry');
const { AiClient } = require('./ai-client');
const { ReplyEngine } = require('./reply-engine');
const { ShopWindowManager } = require('./shop-window');
const { MessageMonitor } = require('./message-monitor');
const { registerIpc, EVENT_CHANNEL } = require('./ipc');
const { DoudianBridgeServer } = require('./doudian-bridge-server');
const { ClientLauncher } = require('./client-launcher');
const secrets = require('./secrets');

let win = null;
let config = null;
let registry = null;
let manager = null;
let engine = null;
let monitor = null;
let logger = null;
let platform = null;
let bridgeServer = null;
let launcher = null;

logger = new Logger({ level: process.env.DESK_LOG_LEVEL || 'info', storeId: 'main' });

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function emitUi(payload) {
  if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, payload);
}

function loadPlatformModule() {
  try {
    return require('../adapters');
  } catch (err) {
    // 平台层尚未交付时 core 仍可启动（注册表/设置可用），只是无法打开店铺
    logger.warn(`平台适配器模块不可用：${err?.message || err}`);
    return null;
  }
}

function makeAdapter(store) {
  if (!platform || typeof platform.createAdapter !== 'function') {
    throw new Error('adapter_factory_missing');
  }
  return platform.createAdapter(store, {
    logger: logger.child(store.storeName),
    config: config.all(),
    webContentsProvider: () => manager.webContentsOf(store.id),
    secrets: { get: secrets.getSecret, has: secrets.hasSecret },
    dataDir: dataDir(),
    // 只有抖店适配器消费；本机 RPC 未启动时为 null，适配器据此诚实返回 hook_not_ready。
    doudianBridge: bridgeServer
      ? {
          call: (method, params, opts) => bridgeServer.call(method, params, opts),
          status: () => bridgeServer.status(),
        }
      : undefined,
  });
}

function resolveEntryUrl(store) {
  if (typeof platform?.entryUrlFor === 'function') return platform.entryUrlFor(store);
  if (platform?.entryUrls && platform.entryUrls[store.platform]) return platform.entryUrls[store.platform];
  return null;
}

/**
 * D-01：接入方式优先由平台工厂声明；缺省 webview 兼容既有平台。
 * 外部客户端接入（client-inject / dual-hook）时 entryUrlFor 可以完全不存在。
 */
function resolveAccessMode(store) {
  if (typeof platform?.accessModeFor === 'function') return platform.accessModeFor(store);
  if (platform?.accessModes && platform.accessModes[store.platform]) return platform.accessModes[store.platform];
  return 'webview';
}

/**
 * 打开店铺后的健康检查：交给适配器 ensure()（webview 平台负责注入 hook 并做版本握手）。
 * 平台模块缺失时明确失败，避免 UI 显示「已打开」但实际没有采集能力。
 */
async function verifyStore(store) {
  if (!platform || typeof platform.createAdapter !== 'function') {
    return { ok: false, reason: 'adapter_factory_missing' };
  }
  const adapter = makeAdapter(store);
  return adapter.ensure();
}

/**
 * 桥接监听地址：环境变量优先于 config.doudianBridge，且 host 必须是回环。
 * 回退端口只从配置读取，代码内不追加隐式端口。
 */
function resolveBridgeOptions(value) {
  const cfg = value?.doudianBridge || {};
  const rawUrl = String(process.env.DESK_DOUDIAN_BRIDGE_URL || cfg.url || 'http://127.0.0.1:42101');
  const parsed = new URL(rawUrl);
  const host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
  if (host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
    throw new Error('doudian_bridge_host_must_be_loopback');
  }
  const port = Number(parsed.port) || 42101;
  const envFallback = process.env.DESK_DOUDIAN_BRIDGE_FALLBACK_PORTS;
  const fallbackPorts = envFallback
    ? envFallback
        .split(',')
        .map((part) => Number(String(part).trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
    : cfg.fallbackPorts;
  return {
    host: host === '[::1]' ? '::1' : host,
    port,
    fallbackPorts,
    bodyLimit: cfg.bodyLimitBytes,
    requestTimeoutMs: cfg.requestTimeoutMs,
  };
}

async function startBridgeServer() {
  try {
    bridgeServer = new DoudianBridgeServer({
      ...resolveBridgeOptions(config.all()),
      logger: logger.child('bridge'),
    });
    await bridgeServer.start();
  } catch (err) {
    bridgeServer = null;
    // 不回显 URL/token；端口占用且无可回退端口时仅降级为“适配器 hook_not_ready”。
    logger.warn(`抖店桥接服务未启动：${err?.message || err}`);
  }
}

function createWindow() {
  const windowCfg = config.all().window || {};
  win = new BrowserWindow({
    width: windowCfg.width || 1440,
    height: windowCfg.height || 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#101318',
    title: 'Desk v1 客服台',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'console-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.on('resize', () => manager?.relayout());
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
}

function initServices() {
  platform = loadPlatformModule();
  // 抖店客户端启动器：data 下的 launcher_config.json 可作为安装路径覆盖，
  // 缺失时回退到注册表与标准安装目录。
  launcher = new ClientLauncher({
    logger: logger.child('client'),
    launcherConfigPath: dataFile('launcher_config.json'),
  });
  manager = new ShopWindowManager({
    window: win,
    registry,
    logger: logger.child('shop'),
    resolveEntryUrl,
    resolveAccessMode,
    prepareStore: verifyStore,
    ensureClientRunning: (store) => launcher.ensureRunning(store),
    healthCheckTimeoutMs: 15000,
    onEvent: (event) => {
      emitUi(event);
      // 监控随店铺生命周期启停，覆盖 IPC 打开/关闭与启动恢复两条路径。
      if (event.type === 'shop:opened' || event.type === 'shop:awaiting_client') {
        monitor?.start(event.storeId).catch((err) => {
          logger.warn(`消息监控启动失败 ${event.storeId}：${err?.message || err}`);
        });
      } else if (event.type === 'shop:closed') {
        monitor?.stop(event.storeId);
      }
    },
  });
  manager.sidebarWidth = config.all().window?.sidebarWidth || 300;

  monitor = new MessageMonitor({
    registry,
    adapterFactory: makeAdapter,
    getConfig: () => config.all(),
    logger,
    onEvent: emitUi,
  });

  const aiClient = new AiClient({ getConfig: () => config.all(), logger: logger.child('ai'), secretReader: secrets.getSecret });
  engine = new ReplyEngine({
    registry,
    adapterFactory: makeAdapter,
    aiClient,
    getConfig: () => config.all(),
    logger: logger.child('engine'),
    onEvent: (event) => {
      emitUi(event);
      if (event.type === 'reply:sent') {
        logger.info(`[${event.storeId}] 已回复 ${event.uid}：${String(event.text).slice(0, 60)}`);
      } else if (event.type === 'reply:failed') {
        logger.warn(`[${event.storeId}] 回复失败 ${event.uid}：${event.reason}`);
      } else if (event.type === 'reply:error') {
        logger.error(`[${event.storeId}] 回复异常 ${event.uid}：${event.error}`);
      } else if (event.type === 'reply:transfer') {
        logger.info(`[${event.storeId}] 转人工 ${event.uid}：关键词「${event.keyword}」`);
      } else if (event.type === 'reply:manual_suppress') {
        logger.info(`[${event.storeId}] 客服手动接管 ${event.uid}：关键词「${event.keyword}」`);
      } else if (event.type === 'reply:missed') {
        logger.warn(`[${event.storeId}] 漏回 ${event.uid}：超出补回窗口 ${event.ageMs}ms`);
      } else if (event.type === 'merchant:self_send') {
        logger.debug(`[${event.storeId}] 忽略自发送回环 ${event.uid}`);
      }
    },
  });

  registerIpc({ config, registry, engine, manager, secrets, logger, launcher });

  if (typeof aiClient.probe === 'function' && config.all().ai?.baseUrl) {
    aiClient
      .probe()
      .then((result) => {
        if (result.ok) logger.info(`AI 端点就绪：${result.endpoint || result.provider}`);
        else logger.warn(`AI 端点不可用（${result.error || result.status}），只采集不回复`);
      })
      .catch(() => {});
  }
}

async function restoreStores() {
  if (!platform) {
    logger.warn('跳过店铺恢复：平台适配器未就绪');
    return;
  }
  const ids = registry.lastActiveIds(6);
  for (const id of ids) {
    try {
      await manager.open(id);
      const store = registry.get(id);
      if (store && store.aiEnabled && config.all().reply?.enabled) {
        await engine.startStore(id);
        logger.info(`[${store.storeName}] 回复引擎已启动`);
      }
    } catch (err) {
      logger.warn(`恢复店铺 ${id} 失败：${err?.message || err}`);
    }
  }
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  try {
    config = new Config({ logger: logger.child('config') });
    logger.setLevel(config.all().log?.level || process.env.DESK_LOG_LEVEL || 'info');
    logger.setMaskPii(config.all().privacy?.maskPii === true);
    registry = new StoreRegistry({ logger: logger.child('registry') });

    createWindow();
    await startBridgeServer();
    initServices();
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    emitUi({ type: 'app:ready' });
    logger.info(`启动完成：数据目录 ${dataDir()}，店铺 ${registry.list().length} 个`);
    await restoreStores();
  } catch (err) {
    logger.error(`启动失败：${err?.stack || err}`);
    if (process.env.DESK_SMOKE === '1') app.exit(1);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  try {
    engine?.stopAll();
    monitor?.stopAll();
    manager?.closeAll();
    bridgeServer?.close().catch(() => {});
    logger?.info('已退出');
  } catch {
    /* 退出路径不抛 */
  }
});

process.on('uncaughtException', (err) => {
  logger?.error(`未捕获异常：${err?.stack || err}`);
  if (process.env.DESK_SMOKE === '1') app.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger?.error(`未处理拒绝：${err?.stack || err}`);
});
