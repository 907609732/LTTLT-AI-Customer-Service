'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLATFORMS,
  DEFAULT_PLATFORM_ID,
  platformInfo,
  platformLabel,
  platformDisplay,
  platformOptions,
  accessModeOf,
} = require('../src/shared/platform-labels');

test('平台目录包含 V1 三个平台，默认拼多多', () => {
  assert.deepEqual(
    platformOptions().map((item) => item.id),
    ['pdd-web', 'doudian-client', 'xianyu'],
  );
  assert.deepEqual(
    platformOptions().map((item) => item.label),
    ['拼多多（pdd-web）', '抖店（doudian-client）', '闲鱼网页版（xianyu）'],
  );
  assert.equal(DEFAULT_PLATFORM_ID, 'pdd-web');
  assert.equal(PLATFORMS.length, 3);
});

test('店铺卡片标签：中文名 + 英文 id', () => {
  assert.equal(platformDisplay('pdd-web'), '拼多多（pdd-web）');
  assert.equal(platformDisplay('doudian-client'), '抖店（doudian-client）');
  assert.equal(platformDisplay('xianyu'), '闲鱼网页版（xianyu）');
  assert.equal(platformLabel('doudian-client'), '抖店');
});

test('未知平台不伪造中文名，空值给出明确占位', () => {
  assert.equal(platformDisplay('future-platform'), 'future-platform');
  assert.equal(platformDisplay(''), '未知平台');
  assert.equal(platformDisplay(null), '未知平台');
  assert.equal(platformInfo('nope'), null);
  assert.equal(platformLabel('nope'), '');
});

test('接入方式仅供 UI 提示：抖店是 client-inject，其余 webview', () => {
  assert.equal(accessModeOf('pdd-web'), 'webview');
  assert.equal(accessModeOf('xianyu'), 'webview');
  assert.equal(accessModeOf('doudian-client'), 'client-inject');
  assert.equal(accessModeOf('nope'), null);
});
