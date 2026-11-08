'use strict';
/**
 * 平台适配器工厂（core 通过 require('../adapters') 加载）。
 *
 * createAdapter(store, deps) 的 deps 由 core 传入：
 *   { logger, config, webContentsProvider(), secrets, dataDir }
 * 适配器实例绑定单店，方法不再接收 store。
 *
 * Adapter Contract v2：适配器必须声明 accessMode；工厂同时提供 accessModes /
 * accessModeFor(store)，供 core 在创建窗口前判定托管方式。
 */
const { PddWebAdapter, PLATFORM_ID, PLATFORM_NAME, ENTRY_URL } = require('./pdd-web');
const { DoudianAdapter, PLATFORM_ID: DOUDIAN_PLATFORM_ID, ACCESS_MODE: DOUDIAN_ACCESS_MODE } = require('./doudian');
const {
  XianyuAdapter,
  SUPPORTED_PLATFORMS: XIANYU_PLATFORMS,
  ACCESS_MODE: XIANYU_ACCESS_MODE,
  ENTRY_URL: XIANYU_ENTRY_URL,
} = require('./xianyu');

const ENTRY_URLS = Object.freeze({
  [PLATFORM_ID]: ENTRY_URL,
  xianyu: XIANYU_ENTRY_URL,
});

const ID_BY_PLATFORM = Object.freeze({
  [PLATFORM_ID]: PddWebAdapter,
  [DOUDIAN_PLATFORM_ID]: DoudianAdapter,
  xianyu: XianyuAdapter,
  // xianyu-seller（卖家工作台）属 V1.5，未实现；不要映射到 XianyuAdapter。
});

/** D-01/D-14：V1 使用 webview（core 建窗口）与 client-inject（等待外部客户端）。 */
const ACCESS_MODES = Object.freeze({
  [PLATFORM_ID]: 'webview',
  [DOUDIAN_PLATFORM_ID]: DOUDIAN_ACCESS_MODE,
  ...Object.fromEntries(XIANYU_PLATFORMS.map((id) => [id, XIANYU_ACCESS_MODE])),
});

function createAdapter(store, deps = {}) {
  if (!store || !store.platform) throw new Error('store_required');
  const Impl = ID_BY_PLATFORM[store.platform];
  if (!Impl) throw new Error(`unsupported_platform:${store.platform}`);
  const webContentsProvider = typeof deps.webContentsProvider === 'function' ? deps.webContentsProvider : null;
  const getWebContents = typeof deps.getWebContents === 'function' ? deps.getWebContents : null;
  return new Impl({
    store,
    logger: deps.logger,
    config: deps.config,
    webContentsProvider,
    getWebContents,
    // client-inject 平台（抖店）可注入本机 RPC 对象；不注入时适配器回退到
    // webContentsProvider（离线/自托管）或返回 hook_not_ready（真实客户端未连接）。
    doudianBridge: deps.doudianBridge,
    injector: deps.injector,
  });
}

function entryUrlFor(store) {
  if (!store || !store.platform) return null;
  return ENTRY_URLS[store.platform] || null;
}

function accessModeFor(store) {
  if (!store || !store.platform) return null;
  return ACCESS_MODES[store.platform] || 'webview';
}

module.exports = {
  createAdapter,
  entryUrlFor,
  entryUrls: ENTRY_URLS,
  accessModeFor,
  accessModes: ACCESS_MODES,
  PddWebAdapter,
  DoudianAdapter,
  XianyuAdapter,
  PLATFORM_ID,
  PLATFORM_NAME,
};
