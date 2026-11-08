'use strict';
/**
 * 原子 JSON 读写：临时文件 → rename。
 * 所有持久化都走这里；不引入原生数据库依赖，保证数据目录可备份、可回滚。
 */
const fs = require('node:fs');
const path = require('node:path');

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return clone(fallback);
    return JSON.parse(raw);
  } catch {
    return clone(fallback);
  }
}

function writeJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 清理失败不掩盖原始异常 */
    }
    throw err;
  }
}

/** 高频变更合并落盘；flush() 供退出前同步调用。 */
class DebouncedJson {
  constructor(file, { delayMs = 1000, fallback } = {}) {
    this.file = file;
    this.delayMs = delayMs;
    this.value = readJson(file, fallback);
    this.timer = null;
  }

  get() {
    return this.value;
  }

  set(value, { flush = false } = {}) {
    this.value = value;
    this.schedule(flush ? 0 : this.delayMs);
  }

  schedule(delay = this.delayMs) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeJson(this.file, this.value);
  }
}

module.exports = { readJson, writeJson, DebouncedJson };
