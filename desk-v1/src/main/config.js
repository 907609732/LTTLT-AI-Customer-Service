'use strict';
/**
 * 全局配置：data/config.json。
 * 契约：apiKey 永不落 config.json（由 secrets.js 管理）；配置带 version 与迁移链。
 */
const { z } = require('zod');
const { dataFile } = require('./paths');
const { readJson, writeJson } = require('./json-store');

const CURRENT_VERSION = 1;

const DEFAULTS = Object.freeze({
  version: CURRENT_VERSION,
  ai: {
    provider: 'openai',
    baseUrl: '',
    model: 'qwen2.5:7b-instruct',
    temperature: 0.4,
    maxTokens: 512,
    timeoutMs: 60000,
    systemPrompt: [
      '你是店铺的资深客服，语气亲和、简洁，直接给结论。',
      '要求：不超过 80 字；不承诺未确认的时效与赔付；不索要隐私信息；不引导站外交易。',
    ].join('\n'),
  },
  reply: {
    enabled: true,
    pollIntervalMs: 1000,
    maxInflight: 6,
    staleMs: 180000,
    // 登录过期重登后的补回窗口；超窗只入档不回复，并累计 missed 计数。
    recoverWindowMs: 600000,
    fallbackAfterMs: 15000,
    fallbackText: '在的亲，稍等一下，马上为您处理~',
    maxReplyChars: 200,
    handoffText: '已收到您的问题，客服会尽快为您处理，请稍候。',
    // D-11 保守节奏：同 uid 60s、发送前 0.5~2s 抖动、单店每分钟上限。
    perUidMinIntervalMs: 60000,
    sendJitterMinMs: 500,
    sendJitterMaxMs: 2000,
    perStorePerMinuteMax: 20,
  },
  // 纯观测：与 AI/回复开关无关，AI 关闭时也要能看到买家消息。
  monitor: {
    pollIntervalMs: 1500,
  },
  safety: {
    handoffKeywords: ['投诉', '差评', '315', '工商', '起诉', '报警'],
    // 卖家侧消息命中即取消该会话的 AI 自动回复（D-07）；默认空，需用户显式配置。
    manualReplyKeywords: [],
  },
  // D-12：默认不打码；保留开关位与打码实现，便于后续按需开启。
  privacy: { maskPii: false },
  // 抖店本机桥接：url 只允许回环；端口占用时按 fallbackPorts 顺序回退。
  // 运行时可用 DESK_DOUDIAN_BRIDGE_URL / DESK_DOUDIAN_BRIDGE_FALLBACK_PORTS 覆盖。
  doudianBridge: {
    url: 'http://127.0.0.1:42101',
    fallbackPorts: [42102, 42103],
    bodyLimitBytes: 262144,
    requestTimeoutMs: 15000,
  },
  log: { level: 'info' },
  window: { width: 1440, height: 900, sidebarWidth: 300 },
});

const ConfigSchema = z.object({
  version: z.number().int().min(1),
  ai: z
    .object({
      provider: z.enum(['openai', 'echo']),
      baseUrl: z.string().max(500),
      model: z.string().min(1).max(120),
      temperature: z.number().min(0).max(2),
      maxTokens: z.number().int().min(1).max(8192),
      timeoutMs: z.number().int().min(1000).max(300000),
      systemPrompt: z.string().max(8000),
    })
    .default({}),
  reply: z
    .object({
      enabled: z.boolean(),
      pollIntervalMs: z.number().int().min(300).max(60000),
      maxInflight: z.number().int().min(1).max(32),
      staleMs: z.number().int().min(0).max(3600000),
      recoverWindowMs: z.number().int().min(0).max(86400000),
      fallbackAfterMs: z.number().int().min(0).max(120000),
      fallbackText: z.string().max(500),
      maxReplyChars: z.number().int().min(1).max(2000),
      handoffText: z.string().max(500),
      perUidMinIntervalMs: z.number().int().min(0).max(3600000),
      sendJitterMinMs: z.number().int().min(0).max(60000),
      sendJitterMaxMs: z.number().int().min(0).max(60000),
      perStorePerMinuteMax: z.number().int().min(0).max(600),
    })
    .default({}),
  monitor: z
    .object({
      pollIntervalMs: z.number().int().min(300).max(60000),
    })
    .default({}),
  safety: z
    .object({
      handoffKeywords: z.array(z.string().min(1).max(30)).max(100),
      manualReplyKeywords: z.array(z.string().min(1).max(30)).max(100),
    })
    .default({}),
  privacy: z.object({ maskPii: z.boolean() }).default({}),
  doudianBridge: z
    .object({
      url: z.string().max(500),
      fallbackPorts: z.array(z.number().int().min(1).max(65535)).max(8),
      bodyLimitBytes: z.number().int().min(1024).max(4 * 1024 * 1024),
      requestTimeoutMs: z.number().int().min(1000).max(120000),
    })
    .default({}),
  log: z.object({ level: z.enum(['debug', 'info', 'warn', 'error']) }).default({}),
  window: z
    .object({
      width: z.number().int().min(800).max(7680),
      height: z.number().int().min(600).max(4320),
      sidebarWidth: z.number().int().min(120).max(800),
    })
    .default({}),
});

class ConfigError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ConfigError';
    this.details = details;
  }
}

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== 'object' || typeof patch !== 'object') {
    return patch;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

function stripSecrets(raw) {
  const value = raw && typeof raw === 'object' ? structuredClone(raw) : {};
  if (value.ai && typeof value.ai === 'object') delete value.ai.apiKey;
  return value;
}

/**
 * 迁移位：版本号缺失视为 0。新增版本时在 MIGRATIONS 追加 n→n+1 的纯函数。
 * 版本高于当前程序时拒绝启动，避免新版配置被旧版静默写坏。
 */
const MIGRATIONS = {
  0: (raw) => {
    const next = { ...raw };
    if (next.ai && typeof next.ai === 'object') {
      next.ai = { ...next.ai };
      delete next.ai.apiKey;
    }
    return next;
  },
};

function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...structuredClone(DEFAULTS) };
  }
  let version = Number.isInteger(raw.version) ? raw.version : 0;
  if (version > CURRENT_VERSION) {
    throw new ConfigError(`config_version_ahead:${version}`);
  }
  let value = stripSecrets(raw);
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ConfigError(`config_migration_missing:${version}`);
    value = step(value);
    version += 1;
  }
  value.version = CURRENT_VERSION;
  return value;
}

class Config {
  constructor({ file = dataFile('config.json'), logger = null } = {}) {
    this.file = file;
    this.logger = logger;
    this.value = this.#load();
  }

  #parse(input) {
    const result = ConfigSchema.safeParse(input);
    if (!result.success) {
      const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new ConfigError(`config_invalid:${details.join('; ')}`, details);
    }
    return result.data;
  }

  #load() {
    const raw = readJson(this.file, null);
    if (!raw) {
      const value = this.#parse(structuredClone(DEFAULTS));
      writeJson(this.file, value);
      return value;
    }
    try {
      const merged = deepMerge(structuredClone(DEFAULTS), migrateConfig(raw));
      const value = this.#parse(merged);
      writeJson(this.file, value);
      return value;
    } catch (err) {
      // 新版配置不可降级：旧程序写回默认值会把用户配置抹掉
      if (err instanceof ConfigError && err.message.startsWith('config_version_ahead')) throw err;
      this.logger?.warn(`配置读取失败，回退默认值：${err?.message || err}`);
      const value = this.#parse(structuredClone(DEFAULTS));
      writeJson(this.file, value);
      return value;
    }
  }

  /** 显式重读磁盘。构造时已加载一次，供设置页保存后刷新使用。 */
  load() {
    this.value = this.#load();
    return this.value;
  }

  get() {
    return this.value;
  }

  all() {
    return this.value;
  }

  /** patch 中的任何 ai.apiKey 都会被剥离；非法值抛 ConfigError 且不落盘。 */
  update(patch) {
    const clean = stripSecrets(patch || {});
    const merged = deepMerge(structuredClone(this.value), clean);
    const value = this.#parse(merged);
    this.value = value;
    writeJson(this.file, value);
    return value;
  }

  static defaults() {
    return structuredClone(DEFAULTS);
  }
}

module.exports = {
  Config,
  ConfigError,
  ConfigSchema,
  DEFAULTS,
  CURRENT_VERSION,
  deepMerge,
  migrateConfig,
  stripSecrets,
};
