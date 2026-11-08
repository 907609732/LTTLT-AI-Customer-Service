'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { SelfSendLedger, normalizeText } = require('../src/main/self-send-ledger');

const NOW = 1_700_000_000_000;

test('归一文本折叠空白并移除零宽字符', () => {
  assert.equal(normalizeText('  你好\u200b  世界  '), '你好 世界');
  assert.equal(normalizeText(null), '');
});

test('有 msgId 时精确匹配，文本再像也不算', () => {
  const ledger = new SelfSendLedger({ now: () => NOW });
  ledger.record({ uid: 'u1', msgId: 'm1', text: '你好', at: NOW });
  assert.equal(ledger.isSelfSent({ uid: 'u1', msgId: 'm1', text: '完全不同的文本', ts: NOW }, NOW), true);
  assert.equal(ledger.isSelfSent({ uid: 'u1', msgId: 'm2', text: '你好', ts: NOW }, NOW), false);
});

test('无 msgId 走 8 秒文本兜底，超时后不再匹配', () => {
  const ledger = new SelfSendLedger({ now: () => NOW });
  ledger.record({ uid: 'u1', msgId: undefined, text: '  你好  ', at: NOW });
  assert.equal(ledger.isSelfSent({ uid: 'u1', text: '你好', ts: NOW + 5000 }, NOW + 5000), true);
  assert.equal(ledger.isSelfSent({ uid: 'u1', text: '你好', ts: NOW + 8001 }, NOW + 8001), false);
});

test('文本兜底必须同 uid', () => {
  const ledger = new SelfSendLedger({ now: () => NOW });
  ledger.record({ uid: 'u1', text: '你好', at: NOW });
  assert.equal(ledger.isSelfSent({ uid: 'u2', text: '你好', ts: NOW }, NOW), false);
});

test('契约里的 ts:<ts> 兜底 msgId 等价于无 msgId，走文本兜底', () => {
  const ledger = new SelfSendLedger({ now: () => NOW });
  ledger.record({ uid: 'u1', text: '你好', at: NOW });
  assert.equal(ledger.isSelfSent({ uid: 'u1', msgId: `ts:${NOW}`, text: '你好', ts: NOW + 1000 }, NOW + 1000), true);
});

test('无 ts 时以判定时刻计算文本兜底窗口', () => {
  const ledger = new SelfSendLedger({ now: () => NOW });
  ledger.record({ uid: 'u1', text: '在吗', at: NOW });
  assert.equal(ledger.isSelfSent({ uid: 'u1', text: '在吗' }, NOW + 1000), true);
  assert.equal(ledger.isSelfSent({ uid: 'u1', text: '在吗' }, NOW + 9000), false);
});

test('台账按保留期裁剪，避免长跑内存膨胀', () => {
  const ledger = new SelfSendLedger({ now: () => NOW, retentionMs: 1000 });
  ledger.record({ uid: 'u1', msgId: 'm1', text: 'a', at: NOW });
  assert.equal(ledger.size(), 1);
  ledger.isSelfSent({ uid: 'u1', msgId: 'x', text: 'b', ts: NOW + 1001 }, NOW + 1001);
  assert.equal(ledger.size(), 0);
});

test('空 uid 不记录也不匹配', () => {
  const ledger = new SelfSendLedger({ now: () => NOW });
  assert.equal(ledger.record({ uid: '', text: 'x', at: NOW }), null);
  assert.equal(ledger.isSelfSent({ uid: '', msgId: 'm1', ts: NOW }, NOW), false);
  assert.equal(ledger.size(), 0);
});
