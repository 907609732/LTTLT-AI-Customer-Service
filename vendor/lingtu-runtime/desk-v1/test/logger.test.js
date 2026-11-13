'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Logger } = require('../src/main/logger');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desk-log-'));
}

test('日志行格式为 [LEVEL] [storeId] msg', () => {
  const dir = tempDir();
  const logger = new Logger({ dir, storeId: 'store-a', console: false });
  logger.info('hello');
  const line = logger.tail(1)[0];
  assert.match(line, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[INFO\] \[store-a\] hello$/);
  assert.equal(fs.existsSync(path.join(dir, 'app.log')), true);
});

test('level 过滤与 setLevel 生效', () => {
  const dir = tempDir();
  const logger = new Logger({ dir, storeId: 's', level: 'warn', console: false });
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  const lines = logger.tail(10);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[WARN\]/);
  logger.setLevel('debug');
  logger.debug('now-visible');
  assert.equal(logger.tail(1)[0].includes('now-visible'), true);
});

test('child 只替换 storeId 并共享 level', () => {
  const dir = tempDir();
  const root = new Logger({ dir, storeId: 'main', console: false });
  const child = root.child('store-b');
  child.warn('from child');
  assert.match(fs.readFileSync(path.join(dir, 'app.log'), 'utf8'), /\[WARN\] \[store-b\] from child/);
  root.setLevel('error');
  assert.equal(child.level, 'error');
});

test('超过 maxBytes 轮转到 app.log.1', () => {
  const dir = tempDir();
  const logger = new Logger({ dir, storeId: 's', console: false, maxBytes: 200, maxFiles: 3 });
  for (let i = 0; i < 12; i += 1) {
    logger.info(`line-${i}-${'x'.repeat(40)}`);
  }
  assert.equal(fs.existsSync(path.join(dir, 'app.log.1')), true);
  const current = fs.statSync(path.join(dir, 'app.log')).size;
  assert.ok(current <= 200 + 80, `current log size ${current}`);
});

test('错误参数序列化为文本，异常带堆栈', () => {
  const dir = tempDir();
  const logger = new Logger({ dir, storeId: 's', console: false });
  logger.error({ code: 1 }, new Error('boom'));
  const content = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.match(content, /\[ERROR\]/);
  assert.match(content, /"code":1/);
  assert.match(content, /boom/);
});

test('D-12 默认不打码，开启 setMaskPii 后按开关打码', () => {
  const dir = tempDir();
  const root = new Logger({ dir, storeId: 'main', console: false });
  root.info('电话 13812345678');
  assert.match(fs.readFileSync(path.join(dir, 'app.log'), 'utf8'), /13812345678/);

  root.setMaskPii(true);
  const child = root.child('store-a');
  child.info('电话 13812345678');
  const content = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.match(content, /138\*{4}5678/);
  assert.equal(content.includes('13812345678'), true); // 历史行不动，只影响新写入
  child.setMaskPii(false);
  child.info('电话 13812345678');
  assert.equal(fs.readFileSync(path.join(dir, 'app.log'), 'utf8').match(/13812345678/g).length, 2);
});

