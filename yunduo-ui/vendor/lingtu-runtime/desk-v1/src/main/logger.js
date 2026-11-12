'use strict';
/**
 * 文件日志：固定行格式 `<时间> [LEVEL] [storeId] msg`。
 * 8MB 轮转，最多保留 5 份历史，避免客服长期运行把磁盘写满。
 */
const fs = require('node:fs');
const path = require('node:path');
const { ensureDir } = require('./paths');
const { maskPii } = require('./privacy');

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

function stamp(d = new Date()) {
  const p = (v, n = 2) => String(v).padStart(n, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

class Logger {
  constructor({
    level = 'info',
    storeId = 'app',
    dir = ensureDir('logs'),
    fileName = 'app.log',
    maxBytes = DEFAULT_MAX_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    console = true,
    state = null,
    maskPiiEnabled = false,
  } = {}) {
    // state 由父子 logger 共享：level / maskPii 都随父级即时生效。
    this.state = state || { level: LEVELS[level] ? level : 'info', maskPii: !!maskPiiEnabled };
    this.storeId = storeId;
    this.dir = dir;
    this.file = path.join(dir, fileName);
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.console = console;
    this.subscribers = new Set();
  }

  get level() {
    return this.state.level;
  }

  set level(value) {
    if (LEVELS[value]) this.state.level = value;
  }

  setLevel(value) {
    this.level = value;
    return this.level;
  }

  /** D-12 开关：默认 false；开启后只影响新写入行，不改历史日志。 */
  setMaskPii(value) {
    this.state.maskPii = !!value;
    return this.state.maskPii;
  }

  /** 子 logger 共享 level 与订阅者，只换 storeId 前缀。 */
  child(storeId, extra = {}) {
    const child = new Logger({
      storeId,
      state: this.state,
      dir: this.dir,
      fileName: path.basename(this.file),
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
      console: this.console,
      ...extra,
    });
    child.subscribers = this.subscribers;
    return child;
  }

  onLine(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  #rotate() {
    let size = 0;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.maxBytes) return;
    for (let i = this.maxFiles - 1; i >= 1; i -= 1) {
      const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
      const to = `${this.file}.${i}`;
      try {
        fs.renameSync(from, to);
      } catch {
        /* 源文件不存在时继续 */
      }
    }
  }

  #write(level, args) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const text = args.map(formatArg).join(' ');
    const safeText = this.state.maskPii ? maskPii(text) : text;
    const line = `${stamp()} [${level.toUpperCase()}] [${this.storeId}] ${safeText}`;

    if (this.console) {
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }

    this.#rotate();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      /* 磁盘异常不阻断业务 */
    }
    for (const fn of this.subscribers) {
      try {
        fn({ level, storeId: this.storeId, text: safeText, at: Date.now() });
      } catch {
        /* 订阅者异常忽略 */
      }
    }
  }

  debug(...args) {
    this.#write('debug', args);
  }

  info(...args) {
    this.#write('info', args);
  }

  warn(...args) {
    this.#write('warn', args);
  }

  error(...args) {
    this.#write('error', args);
  }

  tail(lines = 200) {
    try {
      const raw = fs.readFileSync(this.file, 'utf8').trimEnd();
      return raw ? raw.split('\n').slice(-lines) : [];
    } catch {
      return [];
    }
  }
}

module.exports = { Logger, LEVELS, DEFAULT_MAX_BYTES };

