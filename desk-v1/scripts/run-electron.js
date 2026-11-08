'use strict';
/**
 * desk-v1 · Electron 脚本启动器
 * 清掉 ELECTRON_RUN_AS_NODE（否则 electron 退化成纯 Node），以子进程跑指定脚本并转发退出码。
 *
 * 用法：node scripts/run-electron.js scripts/hook-selftest.js
 * 解析 electron 可执行文件顺序：
 *   1) ELECTRON_BIN 环境变量
 *   2) desk-v1/node_modules/electron
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const target = process.argv[2];
if (!target) {
  console.error('用法：node scripts/run-electron.js <electron 入口脚本>');
  process.exit(2);
}

function binaryFromRoot(root) {
  const file = path.join(root, 'node_modules', 'electron', 'path.txt');
  if (!fs.existsSync(file)) return null;
  const rel = fs.readFileSync(file, 'utf8').trim();
  const bin = path.join(root, 'node_modules', 'electron', 'dist', rel);
  return fs.existsSync(bin) ? bin : null;
}

function findElectron() {
  if (process.env.ELECTRON_BIN && fs.existsSync(process.env.ELECTRON_BIN)) return process.env.ELECTRON_BIN;
  const roots = [path.join(__dirname, '..')];
  for (const root of roots) {
    const bin = binaryFromRoot(root);
    if (bin) return bin;
  }
  return null;
}

const bin = findElectron();
if (!bin) {
  console.error('未安装 electron：请在 desk-v1 执行 npm install，或设置 ELECTRON_BIN 指向 electron 可执行文件');
  process.exit(2);
}

const entry = path.isAbsolute(target) ? target : path.resolve(__dirname, '..', target);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(bin, [entry], { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code == null ? 1 : code);
});
child.on('error', (err) => {
  console.error(`启动 electron 失败：${err.message}`);
  process.exit(2);
});
