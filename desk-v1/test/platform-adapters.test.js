'use strict';
/**
 * 平台适配器轻量单测（不需要 Electron）：
 *   - 闲鱼 D-14：accessMode=webview、单入口、xianyu-seller 不再注册
 *   - 抖店：契约形状、无 bridge 时 hook_not_ready、注入 fake bridge 后的队列/发送/枚举
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../src/shared/adapter-contract');
const platform = require('../src/adapters');
const { DoudianAdapter } = require('../src/adapters/doudian');
const { XianyuAdapter, ENTRY_URL } = require('../src/adapters/xianyu');

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function fakeBridge() {
  const pending = [
    { uid: 'u1', messages: [{ msgId: 'm1', from: 'buyer', type: 'text', content: '还有货吗', ts: 1000 }] },
  ];
  return {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      switch (method) {
        case 'ensure':
          return { ok: true, shopId: '10001' };
        case 'preparePending':
          return { ok: true };
        case 'popPending': {
          const row = pending.shift();
          return row ? { ...row, claimedAt: Date.now() } : { uid: '', messages: [] };
        }
        case 'pendingSnapshot':
          return { ok: true, count: pending.length, uids: pending.map((r) => r.uid) };
        case 'conversationHistory':
          return [
            { msgId: 'm1', from: 'buyer', type: 'text', content: '还有货吗', ts: 1000 },
            { msgId: 'm2', from: 'seller', type: 'text', content: '有货', ts: 2000 },
          ];
        case 'sendText':
          return { ok: true, msgId: 'srv-1' };
        case 'sendImage':
          return { ok: false, reason: 'hook_not_ready', detail: 'image_uploader_unavailable_UNVERIFIED' };
        case 'release':
          return { ok: true, released: true };
        case 'discard':
          return { ok: true };
        case 'popMerchantSent':
          return [{ uid: 'u1', message: { msgId: 's2', from: 'seller', type: 'text', content: '有货', ts: 2100 } }];
        case 'syncAiEnabled':
          return { ok: true };
        case 'focusConversation':
          return { ok: true };
        case 'popSent':
          return [{ msgId: 'srv-1', from: 'seller', type: 'text', content: '有货', ts: 2200 }];
        default:
          return { ok: false, reason: 'hook_not_ready', detail: 'unknown_method' };
      }
    },
  };
}

test('闲鱼 D-14：webview 单入口，seller 入口未实现', () => {
  const xy = new XianyuAdapter({ store: { platform: 'xianyu' }, logger: silent, config: {} });
  assert.equal(contract.validateAdapter(xy).ok, true);
  assert.equal(xy.accessMode, 'webview');
  assert.equal(xy.supports('xianyu'), true);
  assert.equal(xy.supports('xianyu-seller'), false);
  assert.equal(xy.entryUrlFor(), ENTRY_URL);
  assert.equal(platform.entryUrlFor({ platform: 'xianyu' }), 'https://www.goofish.com/im');
  assert.equal(platform.accessModeFor({ platform: 'xianyu' }), 'webview');
  assert.throws(() => new XianyuAdapter({ store: { platform: 'xianyu-seller' } }), /unsupported_platform/);
  assert.throws(() => platform.createAdapter({ platform: 'xianyu-seller' }), /unsupported_platform/);
});

test('闲鱼骨架：ensure/sendText 返回 hook_not_ready，不假装成功', async () => {
  const xy = new XianyuAdapter({ store: { platform: 'xianyu' }, logger: silent, config: {} });
  assert.deepEqual(await xy.ensure(), { ok: false, reason: 'hook_not_ready', detail: 'xianyu_hook_bridge_not_implemented' });
  assert.equal((await xy.sendText('u1', 'hi')).reason, 'hook_not_ready');
  assert.equal(await xy.popPending(), null);
  assert.deepEqual(await xy.popMerchantSent(), []);
});

test('抖店：无 bridge 时 ensure/send 返回 hook_not_ready，popPending 抛 hook_not_ready', async () => {
  const dd = new DoudianAdapter({ store: { platform: 'doudian-client' }, logger: silent, config: {} });
  assert.equal(contract.validateAdapter(dd).ok, true);
  assert.equal(dd.accessMode, 'client-inject');
  const ensure = await dd.ensure();
  assert.equal(ensure.ok, false);
  assert.equal(ensure.reason, 'hook_not_ready');
  assert.equal((await dd.sendText('u1', 'hi')).reason, 'hook_not_ready');
  await assert.rejects(dd.popPending(), (e) => e.reason === 'hook_not_ready');
});

test('抖店：注入 fake bridge 后队列 / 发送 / 枚举全部走契约', async () => {
  const bridge = fakeBridge();
  const dd = new DoudianAdapter({
    store: { platform: 'doudian-client', shopId: '10001' },
    logger: silent,
    config: {},
    doudianBridge: bridge,
  });
  assert.equal(dd.transportKind, 'rpc');
  assert.deepEqual(await dd.ensure(), { ok: true, shopId: '10001' });
  assert.deepEqual(await dd.preparePending(), { ok: true });

  const snap = await dd.pendingSnapshot();
  assert.equal(snap.ok, true);
  assert.deepEqual(snap.uids, ['u1']);

  const row = await dd.popPending();
  assert.equal(row.uid, 'u1');
  assert.equal(row.messages[0].msgId, 'm1');
  assert.equal((await dd.pendingSnapshot()).count, 0);
  assert.deepEqual(await dd.release('u1'), { ok: true, released: true });
  assert.deepEqual(await dd.discard('u1', { beforeTs: 123 }), { ok: true });

  const history = await dd.conversationHistory('u1', { limit: 10 });
  assert.equal(history.ok, true);
  assert.equal(history.messages.length, 2);
  assert.deepEqual(history.messages.map((m) => m.from), ['buyer', 'seller']);

  const sent = await dd.sendText('u1', '有货');
  assert.equal(sent.ok, true);
  assert.equal(sent.msgId, 'srv-1');
  assert.equal(bridge.calls.find((c) => c.method === 'sendText').params.expectedShopId, '10001');

  const img = await dd.sendImage('u1', { url: 'https://example.invalid/a.png' });
  assert.equal(img.ok, false);
  assert.equal(img.reason, 'hook_not_ready');

  await assert.rejects(dd.sendVideo('u1', { url: 'https://example.invalid/a.mp4' }), (e) => e.code === 'unsupported_capability');

  assert.equal((await dd.syncAiEnabled(true)).ok, true);
  assert.equal((await dd.focusConversation('u1')).ok, true);
  const merchant = await dd.popMerchantSent();
  assert.equal(merchant.length, 1);
  assert.equal(merchant[0].message.content, '有货');
  const popped = await dd.popSent('u1');
  assert.equal(popped.messages.length, 1);

  await assert.rejects(dd.sendText('', 'x'), TypeError);
  await assert.rejects(dd.sendImage('u1', {}), TypeError);
});

function fakeContainerWc() {
  let present = false;
  let injectFail = false;
  let injects = 0;
  const wc = {
    isDestroyed: () => false,
    get injects() {
      return injects;
    },
    setPresent(v) {
      present = !!v;
    },
    setInjectFail(v) {
      injectFail = !!v;
    },
    executeJavaScript(expr) {
      const s = String(expr);
      if (s.startsWith('(window["__DESK_DOUDIAN_VER"])')) return present ? 1 : 0;
      if (s.startsWith('(async () => {')) {
        if (!present) return { ok: false, reason: 'hook_not_ready', detail: 'bridge_missing' };
        if (s.includes('"stats"')) {
          return { ok: true, ver: 1, mode: 'container', webviewFound: true, targetCount: 0, targets: [], collection: 'store' };
        }
        if (s.includes('"pendingSnapshot"')) return { ok: true, count: 0, uids: [] };
        return { ok: true };
      }
      // 其余视为 bridge 源码注入
      if (injectFail) throw new Error('inject_blocked');
      injects++;
      present = true;
      return true;
    },
  };
  return wc;
}

test('抖店适配器：容器页 bridge_missing 时自动重注入并重试', async () => {
  const wc = fakeContainerWc();
  const dd = new DoudianAdapter({
    store: { platform: 'doudian-client', shopId: '10001' },
    logger: silent,
    config: {},
    webContentsProvider: () => wc,
  });
  assert.equal((await dd.ensure()).ok, true);
  assert.equal(wc.injects, 1);
  assert.equal(dd.transport.reinjects, 0);

  // 模拟容器页 SPA 路由 / reload 后全局 bridge 消失
  wc.setPresent(false);
  const snap = await dd.pendingSnapshot();
  assert.equal(snap.ok, true);
  assert.equal(wc.injects, 2);
  assert.equal(dd.transport.reinjects, 1);

  // 注入不可用时返回明确 bridge_missing + reinjectAttempts，不吞成泛化错误
  wc.setPresent(false);
  wc.setInjectFail(true);
  const failed = await dd.pendingSnapshot();
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'hook_not_ready');
  assert.match(failed.detail, /bridge_missing/);
  assert.equal(dd.transport.reinjects, 2);
});
