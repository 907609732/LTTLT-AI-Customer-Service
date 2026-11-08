'use strict';
/**
 * 店铺注册表：data/stores.json。
 * 每店独立 session 分区 `persist:desk-store-<id>`，cookie/登录态互不共享。
 * 记录只保存身份与开关，绝不存 cookie / 密码 / token。
 */
const crypto = require('node:crypto');
const { z } = require('zod');
const { dataFile } = require('./paths');
const { readJson, writeJson } = require('./json-store');
const { DEFAULT_PLATFORM_ID } = require('../shared/platform-labels');

const PARTITION_PREFIX = 'persist:desk-store-';
// 平台 id 是适配器契约里的键，只做格式约束（小写 kebab），core 不维护平台枚举。
const PLATFORM_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const StoreSchema = z.object({
  id: z.string().min(6).max(64),
  platform: z.string().min(1).max(40),
  storeName: z.string().min(1).max(60),
  status: z.enum(['inactive', 'active', 'error']).default('inactive'),
  aiEnabled: z.boolean().default(true),
  note: z.string().max(200).default(''),
  group: z.string().trim().max(30).default(''),
  createdAt: z.number().int().nonnegative(),
  lastOpenedAt: z.number().int().nonnegative().default(0),
  lastError: z.string().max(300).default(''),
});

const AddInput = z.object({
  storeName: z.string().trim().min(1).max(60),
  platform: z
    .string()
    .trim()
    .regex(PLATFORM_ID_RE, 'platform 必须是平台适配器 id（小写 kebab，如 pdd-web）')
    .default(DEFAULT_PLATFORM_ID),
  note: z.string().trim().max(200).optional(),
});

function partitionOf(storeOrId) {
  const id = typeof storeOrId === 'string' ? storeOrId : storeOrId?.id;
  if (!id) throw new Error('store_id_required');
  return `${PARTITION_PREFIX}${id}`;
}

function publicView(store) {
  return { ...store, partition: partitionOf(store) };
}

class StoreRegistry {
  constructor({ file = dataFile('stores.json'), logger = null, now = Date.now } = {}) {
    this.file = file;
    this.logger = logger;
    this.now = now;
    const raw = readJson(file, { stores: [] });
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.stores) ? raw.stores : [];
    this.stores = [];
    for (const item of list) {
      const parsed = StoreSchema.safeParse(item);
      if (parsed.success) this.stores.push(parsed.data);
      else this.logger?.warn(`忽略损坏的店铺记录：${parsed.error.issues[0]?.message || 'invalid'}`);
    }
    this.persist();
  }

  persist() {
    writeJson(this.file, { stores: this.stores });
  }

  list() {
    return this.stores.map(publicView);
  }

  get(id) {
    const store = this.stores.find((s) => s.id === id);
    return store ? publicView(store) : null;
  }

  add(input) {
    const parsed = AddInput.parse(input || {});
    const id = crypto.randomUUID();
    const store = StoreSchema.parse({
      id,
      platform: parsed.platform,
      storeName: parsed.storeName,
      status: 'inactive',
      // 新店默认不自动回复：AI 端点未配置时兜底话术仍可能发出，会误发给真实买家。
      aiEnabled: false,
      note: parsed.note || '',
      createdAt: this.now(),
    });
    this.stores.push(store);
    this.persist();
    return publicView(store);
  }

  update(id, patch) {
    const idx = this.stores.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`store_not_found:${id}`);
    const merged = StoreSchema.parse({ ...this.stores[idx], ...(patch || {}), id: this.stores[idx].id });
    this.stores[idx] = merged;
    this.persist();
    return publicView(merged);
  }

  remove(id) {
    const before = this.stores.length;
    this.stores = this.stores.filter((s) => s.id !== id);
    if (this.stores.length === before) throw new Error(`store_not_found:${id}`);
    this.persist();
    return true;
  }

  setAi(id, enabled) {
    return this.update(id, { aiEnabled: !!enabled });
  }

  /** 打开店铺：记录时间并置为 active；启动恢复依赖 lastOpenedAt 排序。 */
  markOpened(id) {
    return this.update(id, { status: 'active', lastOpenedAt: this.now(), lastError: '' });
  }

  markError(id, message) {
    return this.update(id, {
      status: 'error',
      lastError: String(message || '').slice(0, 300),
    });
  }

  /** 上次打开且仍为 active 的店铺，按最近打开时间倒序。 */
  lastActiveIds(limit = 6) {
    return this.stores
      .filter((s) => s.status === 'active')
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, limit)
      .map((s) => s.id);
  }
}

module.exports = { StoreRegistry, StoreSchema, AddInput, partitionOf, PARTITION_PREFIX };
