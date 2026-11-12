'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { ClientWaitController, DEFAULT_TIMEOUT_MS } = require('../src/main/client-wait');

/** 可推进的假时钟：把 setTimeout 记录在表里，advance 时按时间顺序执行并清微任务。 */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: now + Math.max(0, ms) });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (!next || timer.at < next.timer.at) next = { id, timer };
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.timer.at;
        next.timer.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

test('抖店适配器长期 hook_not_ready：等待期内保持 waiting，超时只报一次通用错误', async () => {
  const clock = makeClock();
  const events = [];
  const expirations = [];
  let probes = 0;
  const controller = new ClientWaitController({
    timeoutMs: DEFAULT_TIMEOUT_MS,
    intervalMs: 5000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onEvent: (event) => events.push(event),
  });

  controller.wait('store-1', {
    platformId: 'doudian-client',
    probe: async () => {
      probes += 1;
      return { ok: false, reason: 'hook_not_ready' };
    },
    onExpired: (storeId, message) => expirations.push({ storeId, message }),
  });

  assert.equal(controller.stateOf('store-1').state, 'waiting');
  await clock.advance(0);
  assert.ok(probes >= 1);

  await clock.advance(DEFAULT_TIMEOUT_MS - 1);
  assert.equal(controller.stateOf('store-1').state, 'waiting');
  assert.equal(expirations.length, 0);

  await clock.advance(2);
  assert.equal(controller.stateOf('store-1').state, 'error');
  assert.equal(expirations.length, 1);
  assert.equal(expirations[0].storeId, 'store-1');
  assert.equal(expirations[0].message, '抖店客户端未连接，请确认客户端已安装并登录后重试');

  const errors = events.filter((event) => event.type === 'client:unavailable');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, '抖店客户端未连接，请确认客户端已安装并登录后重试');

  // 错误态不再轮询，也不重复发事件（避免界面/日志刷屏）。
  const probesAtError = probes;
  await clock.advance(5 * DEFAULT_TIMEOUT_MS);
  assert.equal(probes, probesAtError);
  assert.equal(events.filter((event) => event.type === 'client:unavailable').length, 1);
  assert.equal(clock.pending(), 0);
});

test('等待期内客户端连上：转为 ready 且不再报错', async () => {
  const clock = makeClock();
  const events = [];
  const ready = [];
  let probes = 0;
  const controller = new ClientWaitController({
    timeoutMs: 60000,
    intervalMs: 5000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onEvent: (event) => events.push(event),
  });

  controller.wait('store-2', {
    platformId: 'doudian-client',
    probe: async () => {
      probes += 1;
      return probes >= 3 ? { ok: true } : { ok: false, reason: 'hook_not_ready' };
    },
    onReady: (storeId) => ready.push(storeId),
    onExpired: () => assert.fail('客户端已连上，不应超时报错'),
  });

  await clock.advance(12000);
  assert.equal(controller.stateOf('store-2').state, 'ready');
  assert.deepEqual(ready, ['store-2']);
  assert.equal(events.filter((event) => event.type === 'client:ready').length, 1);
  assert.equal(clock.pending(), 0);
});

test('关闭店铺会取消等待，后续不再产生事件', async () => {
  const clock = makeClock();
  const events = [];
  const controller = new ClientWaitController({
    timeoutMs: 60000,
    intervalMs: 5000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onEvent: (event) => events.push(event),
  });

  controller.wait('store-3', {
    platformId: 'doudian-client',
    probe: async () => ({ ok: false, reason: 'hook_not_ready' }),
  });
  assert.equal(controller.stop('store-3'), true);
  await clock.advance(120000);
  assert.equal(controller.stateOf('store-3').state, null);
  assert.equal(events.length, 0);
  assert.equal(clock.pending(), 0);
});

