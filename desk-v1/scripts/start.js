'use strict';
/**
 * 启动入口：按顺序解析 Electron 可执行文件。
 *   1) ELECTRON_BIN 环境变量
 *   2) 本仓库 node_modules/electron
 * 都找不到时给出安装提示，不做隐式回退。
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function binaryFromNodeModules() {
  const dir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(dir, 'path.txt');
  if (fs.existsSync(pathFile)) {
    const rel = fs.readFileSync(pathFile, 'utf8').trim();
    const bin = path.join(dir, 'dist', rel);
    if (fs.existsSync(bin)) return bin;
  }
  try {
    const bin = require('electron');
    if (typeof bin === 'string' && fs.existsSync(bin)) return bin;
  } catch {
    /* 未安装 */
  }
  return null;
}

function resolveElectron() {
  if (process.env.ELECTRON_BIN && fs.existsSync(process.env.ELECTRON_BIN)) return process.env.ELECTRON_BIN;
  return binaryFromNodeModules();
}

const bin = resolveElectron();
if (!bin) {
  console.error('未找到 Electron。请先执行 npm install，或设置 ELECTRON_BIN 指向 Electron 可执行文件。');
  process.exit(2);
}

const child = spawn(bin, [root], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
