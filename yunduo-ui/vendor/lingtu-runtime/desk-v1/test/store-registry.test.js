'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { StoreRegistry, AddInput, partitionOf, PARTITION_PREFIX } = require('../src/main/store-registry');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-stores-')), 'stores.json');
}

test('新增店铺返回独立 session 分区 persist:desk-store-<id>', () => {
  const file = tempFile();
  const registry = new StoreRegistry({ file });
  const store = registry.add({ storeName: '测试店', platform: 'pdd-web' });
  assert.match(store.id, /^[0-9a-f-]{20,}$/);
  assert.equal(store.partition, `${PARTITION_PREFIX}${store.id}`);
  assert.equal(store.partition, `persist:desk-store-${store.id}`);
  assert.equal(partitionOf(store.id), store.partition);
  assert.equal(store.status, 'inactive');
  assert.equal(store.aiEnabled, false);
});

test('注册表持久化，重载后店铺与分区一致', () => {
  const file = tempFile();
  const first = new StoreRegistry({ file });
  const a = first.add({ storeName: 'A 店' });
  const b = first.add({ storeName: 'B 店', note: '备注' });
  const second = new StoreRegistry({ file });
  const list = second.list();
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((s) => s.id).sort(),
    [a.id, b.id].sort(),
  );
  assert.equal(second.get(b.id).partition, b.partition);
  assert.equal(second.get(b.id).note, '备注');
});

test('更新、AI 开关、删除', () => {
  const file = tempFile();
  const registry = new StoreRegistry({ file });
  const store = registry.add({ storeName: '店' });
  assert.equal(registry.setAi(store.id, false).aiEnabled, false);
  assert.equal(registry.update(store.id, { storeName: '新名' }).storeName, '新名');
  assert.equal(registry.remove(store.id), true);
  assert.equal(registry.get(store.id), null);
  assert.throws(() => registry.remove(store.id), /store_not_found/);
});

test('非法输入被 zod 拒绝', () => {
  const registry = new StoreRegistry({ file: tempFile() });
  assert.throws(() => registry.add({ storeName: '   ' }));
  assert.throws(() => registry.add({ storeName: 'x'.repeat(61) }));
});

test('AddInput 平台校验：默认拼多多、保留显式平台、拒绝非法 id', () => {
  assert.equal(AddInput.parse({ storeName: '默认店' }).platform, 'pdd-web');
  assert.equal(AddInput.parse({ storeName: '抖店', platform: 'doudian-client' }).platform, 'doudian-client');
  assert.equal(AddInput.parse({ storeName: '空格', platform: '  xianyu  ' }).platform, 'xianyu');
  assert.throws(() => AddInput.parse({ storeName: '坏 id', platform: 'pdd web' }));
  assert.throws(() => AddInput.parse({ storeName: '空 id', platform: '   ' }));
  assert.throws(() => AddInput.parse({ storeName: '大写', platform: 'PDD-WEB' }));
  assert.throws(() => AddInput.parse({ storeName: '超长', platform: 'a'.repeat(41) }));

  const registry = new StoreRegistry({ file: tempFile() });
  const store = registry.add({ storeName: '抖店店', platform: 'doudian-client' });
  assert.equal(store.platform, 'doudian-client');
});

test('启动恢复：按 lastOpenedAt 倒序返回 active 店铺，最多 6 个', () => {
  const file = tempFile();
  let clock = 1000;
  const registry = new StoreRegistry({ file, now: () => (clock += 1000) });
  const ids = [];
  for (let i = 0; i < 8; i += 1) ids.push(registry.add({ storeName: `店 ${i}` }).id);
  for (const id of ids) registry.markOpened(id);
  const restored = registry.lastActiveIds(6);
  assert.equal(restored.length, 6);
  assert.deepEqual(restored, ids.slice(-6).reverse());

  registry.update(ids[ids.length - 1], { status: 'inactive' });
  assert.equal(registry.lastActiveIds(6).includes(ids[ids.length - 1]), false);
});

test('损坏的店铺记录被跳过而不是拖垮启动', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({ stores: [{ id: 'x' }, { bad: true }] }), 'utf8');
  const registry = new StoreRegistry({ file });
  assert.deepEqual(registry.list(), []);
});

