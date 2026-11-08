'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readJson, writeJson, DebouncedJson } = require('../src/main/json-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desk-json-'));
}

test('写入后读取一致，且不残留临时文件', () => {
  const dir = tempDir();
  const file = path.join(dir, 'nested', 'data.json');
  writeJson(file, { a: 1, list: [1, 2, 3] });
  assert.deepEqual(readJson(file, null), { a: 1, list: [1, 2, 3] });
  const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('损坏或空文件回退默认值且不抛异常', () => {
  const dir = tempDir();
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{"a":', 'utf8');
  assert.deepEqual(readJson(broken, { ok: true }), { ok: true });

  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, '   ', 'utf8');
  assert.deepEqual(readJson(empty, { fallback: 1 }), { fallback: 1 });

  assert.deepEqual(readJson(path.join(dir, 'missing.json'), { missing: 1 }), { missing: 1 });
});

test('回退值返回副本，调用方修改不污染默认对象', () => {
  const fallback = { items: [] };
  const first = readJson(path.join(tempDir(), 'none.json'), fallback);
  first.items.push('x');
  assert.deepEqual(fallback.items, []);
});

test('DebouncedJson 合并高频写入并在 flush 后落盘', async () => {
  const file = path.join(tempDir(), 'd.json');
  const store = new DebouncedJson(file, { delayMs: 30, fallback: { n: 0 } });
  store.set({ n: 1 });
  store.set({ n: 2 });
  assert.deepEqual(store.get(), { n: 2 });
  assert.equal(fs.existsSync(file), false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 });

  store.set({ n: 3 });
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 3 });
});
