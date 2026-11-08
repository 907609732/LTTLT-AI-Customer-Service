'use strict';
/**
 * 路径解析：数据目录可用 DESK_DATA_DIR 覆盖（测试/多实例隔离）。
 * 打包态由 src/main/index.js 在加载本模块前指向 Electron userData。
 */
const path = require('node:path');
const fs = require('node:fs');

const APP_ROOT = path.resolve(__dirname, '..', '..');

function dataDir() {
  const override = process.env.DESK_DATA_DIR;
  const dir = override ? path.resolve(override) : path.join(APP_ROOT, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dataFile(...parts) {
  return path.join(dataDir(), ...parts);
}

function ensureDir(...parts) {
  const dir = path.join(dataDir(), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { APP_ROOT, dataDir, dataFile, ensureDir };
