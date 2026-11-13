'use strict';
/**
 * 密钥存储：Electron safeStorage（Windows 为 DPAPI）优先，不可用时降级 base64 并显式标记 enc。
 * 红线：密钥只在本机 secrets.json；绝不写入 config.json、日志或任何网络请求。
 */
const fs = require('node:fs');
const path = require('node:path');
const { dataFile } = require('./paths');

function defaultSafeStorage() {
  try {
    // 延迟 require：纯 Node 单测环境没有 electron 也能加载本模块
    const electron = require('electron');
    const safeStorage = electron?.safeStorage;
    if (safeStorage?.isEncryptionAvailable?.()) return safeStorage;
  } catch {
    /* 无 electron 环境 */
  }
  return null;
}

class SecretStore {
  constructor({ file = null, safeStorage = undefined } = {}) {
    this.file = file || dataFile('secrets.json');
    this.injectedSafeStorage = safeStorage;
  }

  #safeStorage() {
    if (this.injectedSafeStorage !== undefined) return this.injectedSafeStorage;
    return defaultSafeStorage();
  }

  #read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  #write(value) {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* 忽略清理失败 */
      }
      throw err;
    }
  }

  /** 返回 {ok, enc}；空值等价于删除。 */
  set(name, value) {
    if (!name) throw new Error('secret_name_required');
    const store = this.#read();
    if (value === undefined || value === null || value === '') {
      delete store[name];
      this.#write(store);
      return { ok: true, cleared: true };
    }
    const ss = this.#safeStorage();
    if (ss) {
      store[name] = {
        enc: 'dpapi',
        v: ss.encryptString(String(value)).toString('base64'),
        updatedAt: Date.now(),
      };
    } else {
      store[name] = {
        enc: 'b64',
        v: Buffer.from(String(value), 'utf8').toString('base64'),
        updatedAt: Date.now(),
      };
    }
    this.#write(store);
    return { ok: true, enc: store[name].enc };
  }

  get(name) {
    const entry = this.#read()[name];
    if (!entry || typeof entry.v !== 'string') return '';
    try {
      if (entry.enc === 'dpapi') {
        const ss = this.#safeStorage();
        if (!ss) return '';
        return ss.decryptString(Buffer.from(entry.v, 'base64'));
      }
      return Buffer.from(entry.v, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  has(name) {
    const entry = this.#read()[name];
    return !!(entry && entry.v);
  }

  remove(name) {
    return this.set(name, '');
  }

  /** 只读诊断信息，不含密文。 */
  describe(name) {
    const entry = this.#read()[name];
    if (!entry) return { exists: false };
    return { exists: true, enc: entry.enc, updatedAt: entry.updatedAt || 0 };
  }
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}${'*'.repeat(Math.min(12, text.length - 8))}${text.slice(-4)}`;
}

let singleton = null;
function defaultStore() {
  if (!singleton) singleton = new SecretStore();
  return singleton;
}

module.exports = {
  SecretStore,
  setSecret: (name, value) => defaultStore().set(name, value),
  getSecret: (name) => defaultStore().get(name),
  hasSecret: (name) => defaultStore().has(name),
  removeSecret: (name) => defaultStore().remove(name),
  maskSecret,
};

