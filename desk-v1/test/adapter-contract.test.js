'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../src/shared/adapter-contract');

function completeAdapter() {
  return {
    id: 'fake',
    accessMode: 'webview',
    supports: () => true,
    ensure: async () => contract.ok(),
    preparePending: async () => contract.ok(),
    popPending: async () => null,
    pendingSnapshot: async () => contract.ok({ count: 0, uids: [] }),
    conversationHistory: async () => contract.ok({ messages: [] }),
    sendText: async () => contract.ok({ msgId: 'm1' }),
    sendImage: async () => contract.ok(),
    sendVideo: async () => contract.ok(),
    release: async () => contract.ok(),
    discard: async () => contract.ok(),
    popMerchantSent: async () => [],
    syncAiEnabled: async () => contract.ok(),
    focusConversation: async () => contract.ok(),
  };
}

test('契约 v2：16 项能力（2 属性 + 14 方法）齐全', () => {
  assert.equal(contract.CONTRACT_VERSION, 2);
  assert.equal(contract.REQUIRED_MEMBERS.length, 16);
  assert.equal(contract.METHODS.length, 14);
  assert.deepEqual(contract.PROPERTIES, ['id', 'accessMode']);
  for (const name of [
    'id',
    'accessMode',
    'supports',
    'ensure',
    'preparePending',
    'popPending',
    'pendingSnapshot',
    'conversationHistory',
    'sendText',
    'sendImage',
    'sendVideo',
    'release',
    'discard',
    'popMerchantSent',
    'syncAiEnabled',
    'focusConversation',
  ]) {
    assert.ok(contract.REQUIRED_MEMBERS.includes(name), name);
  }
});

test('接入方式封闭集合与托管映射', () => {
  assert.deepEqual(contract.ACCESS_MODE_VALUES, ['webview', 'client-inject', 'dual-hook']);
  assert.equal(contract.hostingForAccessMode('webview'), 'webcontents-view');
  assert.equal(contract.hostingForAccessMode('client-inject'), 'external-client');
  assert.equal(contract.hostingForAccessMode('dual-hook'), 'external-client');
  assert.equal(contract.hostingForAccessMode('iframe'), null);
  assert.equal(contract.isAccessMode('webview'), true);
  assert.equal(contract.isAccessMode('iframe'), false);
  assert.deepEqual(contract.OPTIONAL_CAPABILITIES, ['entryUrlFor']);
});

test('失败枚举封闭且 fail() 拒绝未知原因', () => {
  assert.deepEqual(contract.FAILURE_REASON_VALUES, [
    'hook_not_ready',
    'input_not_found',
    'input_busy',
    'send_unconfirmed',
  ]);
  assert.equal(contract.fail('input_busy').ok, false);
  assert.equal(contract.fail('input_busy', 'detail').detail, 'detail');
  assert.throws(() => contract.fail('timeout'), /adapter_failure_reason_invalid/);
  assert.equal(contract.isFailureReason('hook_not_ready'), true);
  assert.equal(contract.isFailureReason('nope'), false);
});

test('完整适配器通过形状校验', () => {
  assert.deepEqual(contract.validateAdapter(completeAdapter()), { ok: true, missing: [], invalid: [] });
  assert.equal(contract.assertAdapterShape(completeAdapter()), true);
});

test('缺失方法被逐个列出，失败信息可定位', () => {
  const adapter = completeAdapter();
  delete adapter.sendVideo;
  delete adapter.popMerchantSent;
  const result = contract.validateAdapter(adapter);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['sendVideo', 'popMerchantSent']);
  assert.throws(() => contract.assertAdapterShape(adapter), /missing: sendVideo,popMerchantSent/);
});

test('id 必须是非空字符串', () => {
  const adapter = completeAdapter();
  adapter.id = '';
  assert.equal(contract.validateAdapter(adapter).ok, false);
  assert.throws(() => contract.assertAdapterShape(adapter), /invalid: id/);
});

test('accessMode 必填且必须是封闭枚举', () => {
  const missing = completeAdapter();
  delete missing.accessMode;
  assert.deepEqual(contract.validateAdapter(missing).invalid, ['accessMode']);
  assert.throws(() => contract.assertAdapterShape(missing), /invalid: accessMode/);

  const bogus = completeAdapter();
  bogus.accessMode = 'iframe';
  assert.equal(contract.validateAdapter(bogus).ok, false);
  assert.throws(() => contract.assertAdapterShape(bogus), /invalid: accessMode/);

  for (const mode of contract.ACCESS_MODE_VALUES) {
    const adapter = completeAdapter();
    adapter.accessMode = mode;
    assert.equal(contract.validateAdapter(adapter).ok, true, mode);
  }
});

test('assertResult 拒绝非契约返回值', () => {
  assert.equal(contract.assertResult({ ok: true }).ok, true);
  assert.equal(contract.assertResult({ ok: false, reason: 'hook_not_ready' }).ok, false);
  assert.throws(() => contract.assertResult({ ok: false, reason: 'boom' }), /adapter_result_reason_invalid/);
  assert.throws(() => contract.assertResult(undefined, 'sendText'), /adapter_result_invalid:sendText/);
});
