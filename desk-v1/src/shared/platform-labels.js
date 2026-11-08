'use strict';
/**
 * 平台展示目录：渲染层下拉、店铺卡片标签的唯一来源。
 *
 * 只描述「怎么显示/是否可选」，不含任何平台行为；行为仍由 src/adapters 提供。
 * accessMode 仅用于 UI 在窗口打开前给出提示，实际托管方式由主进程场景判定。
 *
 * 同时供 CommonJS（测试/主进程）与普通 <script>（渲染层，无打包器）使用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeskPlatforms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PLATFORMS = Object.freeze([
    Object.freeze({ id: 'pdd-web', label: '拼多多', accessMode: 'webview' }),
    Object.freeze({ id: 'doudian-client', label: '抖店', accessMode: 'client-inject' }),
    Object.freeze({ id: 'xianyu', label: '闲鱼网页版', accessMode: 'webview' }),
  ]);

  const DEFAULT_PLATFORM_ID = 'pdd-web';
  const BY_ID = Object.freeze(Object.fromEntries(PLATFORMS.map((item) => [item.id, item])));

  function platformInfo(id) {
    return BY_ID[id] || null;
  }

  function platformLabel(id) {
    const info = platformInfo(String(id || '').trim());
    return info ? info.label : '';
  }

  /** 卡片展示：已知平台输出「中文名（英文 id）」，未知 id 原样返回。 */
  function platformDisplay(id) {
    const key = String(id || '').trim();
    if (!key) return '未知平台';
    const info = platformInfo(key);
    return info ? `${info.label}（${key}）` : key;
  }

  function platformOptions() {
    return PLATFORMS.map((item) => ({ id: item.id, label: `${item.label}（${item.id}）` }));
  }

  function accessModeOf(id) {
    const info = platformInfo(String(id || '').trim());
    return info ? info.accessMode : null;
  }

  return {
    PLATFORMS,
    DEFAULT_PLATFORM_ID,
    platformInfo,
    platformLabel,
    platformDisplay,
    platformOptions,
    accessModeOf,
  };
});
