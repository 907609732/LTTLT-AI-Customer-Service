'use strict';
/**
 * 店铺页面 preload：默认不向第三方页面暴露任何 desk API。
 * 平台注入由 src/adapters 的 hook 负责，core 不在这里加能力。
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__deskHost', {
  version: 1,
  platform: process.platform,
});
