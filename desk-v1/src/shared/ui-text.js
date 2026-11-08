'use strict';
/**
 * 面向用户的固定文案：渲染层与主进程共用，避免错误提示出现多套说法。
 * 只放展示文案，不含平台行为；平台差异用 key 区分，不在调用点拼字符串。
 *
 * 同时供 CommonJS（主进程/测试）与普通 <script>（渲染层，无打包器）使用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeskUiText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ERRORS = Object.freeze({
    doudianUnavailable: '抖店客户端未连接，请确认客户端已安装并登录后重试',
    doudianLaunchFailed: '无法启动抖店客户端，请确认已安装',
    clientUnavailable: '客户端未连接，请稍后重试',
  });

  const STATUS = Object.freeze({
    awaitingDoudianClient: '等待抖店客户端',
    awaitingClient: '等待客户端',
  });

  const DOUDIAN_PLATFORM_ID = 'doudian-client';

  function errorFor(platformId, fallback = '未知错误') {
    if (platformId === DOUDIAN_PLATFORM_ID) return ERRORS.doudianUnavailable;
    return fallback;
  }

  function awaitingFor(platformId) {
    return platformId === DOUDIAN_PLATFORM_ID ? STATUS.awaitingDoudianClient : STATUS.awaitingClient;
  }

  return Object.freeze({
    ERRORS,
    STATUS,
    DOUDIAN_PLATFORM_ID,
    errorFor,
    awaitingFor,
  });
});
