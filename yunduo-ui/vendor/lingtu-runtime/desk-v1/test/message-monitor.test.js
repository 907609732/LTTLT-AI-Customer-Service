'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { MessageMonitor } = require('../src/main/message-monitor');

const NOW = 1_700_000_000_000;

function captureLogger() {
  const lines = { info: [], warn: [], debug: [], error: [] };
  return {
    lines,
    info: (msg) => lines.info.push(String(msg)),
    warn: (msg) => lines.warn.push(String(msg)),
    debug: (msg) => lines.debug.push(String(msg)),
    error: (msg) => lines.error.push(String(msg)),
    child() {
      return this;
    },
  };
}

function registryOf(store) {
  return {
    get(id) {
      return id === store.id ? store : null;
    },
  };
}

/** 与 bridge 语义一致：只返回 seq > sinceSeq 的事件。 */
function makeAdapter(script = []) {
  const calls = [];
  let index = 0;
  const adapter = {
    id: 'fake',
    accessMode: 'webview',
    async drainEvents(params = {}) {
      calls.push(Number(params.sinceSeq) || 0);
      const step = typeof script === 'function' ? script(Number(params.sinceSeq) || 0) : script[index++];
      const payload = step || { ok: true, seq: Number(params.sinceSeq) || 0, events: [] };
      return { ...payload, events: payload.events || [] };
    },
  };
  return { adapter, calls };
}

function event(seq, overrides = {}) {
  return {
    seq,
    uid: 'u1',
    username: '小明',
    from: 'buyer',
    type: 'text',
    content: `消息${seq}`,
    msgId: `m${seq}`,
    ts: NOW + seq,
    goodsTitle: '',
    ...overrides,
  };
}

function makeMonitor({ adapter, store = {}, config = {}, now = () => NOW } = {}) {
  const logger = captureLogger();
  const emitted = [];
  const monitor = new MessageMonitor({
    registry: registryOf({ id: 'store-1', storeName: '测试店', aiEnabled: true, ...store }),
    adapterFactory: async () => adapter,
    getConfig: () => ({
      monitor: { pollIntervalMs: 60000 },
      reply: { enabled: false },
      ...config,
    }),
    logger,
    onEvent: (payload) => emitted.push(payload),
    now,
  });
  return { monitor, logger, emitted };
}

test('买家/我方两行日志格式与既定格式一致，并 emit message:in', async () => {
  const { adapter } = makeAdapter([
    { ok: true, seq: 2, events: [event(1), event(2, { uid: 'u9', username: '', from: 'seller', content: '在的亲' })] },
  ]);
  const { monitor, logger, emitted } = makeMonitor({ adapter });
  await monitor.start('store-1');
  await monitor.tick('store-1');

  assert.deepEqual(logger.lines.info, [
    '[测试店] 收消息 买家 小明：消息1',
    '[测试店] 收消息 我：在的亲',
  ]);
  assert.deepEqual(emitted[0], {
    type: 'message:in',
    storeId: 'store-1',
    uid: 'u1',
    from: 'buyer',
    content: '消息1',
    messageType:'text',msgId:'m1',username:'小明',
    ts: NOW + 1,
  });
  assert.equal(emitted.length, 2);
  monitor.stopAll();
});

test('store.aiEnabled 与 reply.enabled 均为 false 时仍运行（纯观测）', async () => {
  const { adapter } = makeAdapter([{ ok: true, seq: 1, events: [event(1, { content: '有人吗' })] }]);
  const { monitor, logger } = makeMonitor({
    adapter,
    store: { aiEnabled: false },
    config: { reply: { enabled: false } },
  });
  await monitor.start('store-1');
  await monitor.tick('store-1');
  assert.deepEqual(logger.lines.info, ['[测试店] 收消息 买家 小明：有人吗']);
  monitor.stopAll();
});

test('适配器没有 drainEvents 时静默跳过，不建轮询也不报错', async () => {
  const { adapter } = makeAdapter([]);
  delete adapter.drainEvents;
  const { monitor, logger } = makeMonitor({ adapter });
  const watcher = await monitor.start('store-1');
  assert.equal(watcher, null);
  assert.equal(monitor.isRunning('store-1'), false);
  assert.deepEqual(await monitor.tick('store-1'), { events: 0 });
  assert.deepEqual(logger.lines.info, []);
  assert.deepEqual(logger.lines.warn, []);
  assert.deepEqual(logger.lines.error, []);
});

test('sinceSeq 递增，已拉取的事件不重复输出', async () => {
  const { adapter, calls } = makeAdapter([
    { ok: true, seq: 2, events: [event(1), event(2)] },
    { ok: true, seq: 2, events: [] },
  ]);
  const { monitor, logger } = makeMonitor({ adapter });
  await monitor.start('store-1');
  const first = await monitor.tick('store-1');
  const second = await monitor.tick('store-1');
  assert.deepEqual(calls, [0, 2]);
  assert.deepEqual(first, { events: 2 });
  assert.deepEqual(second, { events: 0 });
  assert.equal(logger.lines.info.length, 2);
  monitor.stopAll();
});

test('页面重载 seq 回退时从 0 重拉，msgId 去重防刷屏', async () => {
  const { adapter, calls } = makeAdapter((sinceSeq) => {
    if (calls.length === 1) return { ok: true, seq: 5, events: [event(5, { msgId: 'm5' })] };
    // 重载后页面 seq 从 1 重新计数（小于 core 的 lastSeq），触发重拉
    if (sinceSeq >= 5) return { ok: true, seq: 1, events: [] };
    if (sinceSeq === 0) {
      return { ok: true, seq: 2, events: [event(1, { msgId: 'm5' }), event(2, { msgId: 'm6' })] };
    }
    return { ok: true, seq: sinceSeq, events: [] };
  });
  const { monitor, logger } = makeMonitor({ adapter });
  await monitor.start('store-1');
  await monitor.tick('store-1');
  await monitor.tick('store-1');
  assert.deepEqual(calls, [0, 5, 0]);
  assert.deepEqual(logger.lines.info, ['[测试店] 收消息 买家 小明：消息5', '[测试店] 收消息 买家 小明：消息2']);
  assert.equal(monitor.status()['store-1'].lastSeq, 2);
  monitor.stopAll();
});

test('店铺重开后从 0 重拉，历史 msgId 不重复刷日志', async () => {
  const { adapter } = makeAdapter((sinceSeq) => ({
    ok: true,
    seq: 1,
    events: sinceSeq === 0 ? [event(1, { msgId: 'm1' })] : [],
  }));
  const { monitor, logger } = makeMonitor({ adapter });
  await monitor.start('store-1');
  await monitor.tick('store-1');
  monitor.stop('store-1');

  await monitor.start('store-1');
  await monitor.tick('store-1');
  assert.deepEqual(logger.lines.info, ['[测试店] 收消息 买家 小明：消息1']);
  monitor.stopAll();
});

test('店铺关闭后停止轮询', async () => {
  let drains = 0;
  const adapter = {
    id: 'fake',
    accessMode: 'webview',
    async drainEvents() {
      drains += 1;
      return { ok: true, seq: 0, events: [] };
    },
  };
  const { monitor } = makeMonitor({ adapter, config: { monitor: { pollIntervalMs: 300 } } });
  await monitor.start('store-1');
  await new Promise((resolve) => setTimeout(resolve, 360));
  assert.ok(drains >= 1);
  assert.equal(monitor.stop('store-1'), true);
  assert.equal(monitor.isRunning('store-1'), false);
  const afterStop = drains;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(drains, afterStop);
});

test('适配器抛异常不中断轮询，且日志不含 URL/token', async () => {
  const logger = captureLogger();
  let fail = true;
  const adapter = {
    async drainEvents() {
      if (fail) throw new Error('connect http://127.0.0.1:42101/rpc?token=super-secret failed');
      return { ok: true, seq: 1, events: [event(1)] };
    },
  };
  const monitor = new MessageMonitor({
    registry: registryOf({ id: 'store-1', storeName: '测试店' }),
    adapterFactory: async () => adapter,
    getConfig: () => ({ monitor: { pollIntervalMs: 60000 } }),
    logger,
    onEvent: () => {},
  });
  await monitor.start('store-1');
  assert.deepEqual(await monitor.tick('store-1'), { events: 0 });
  fail = false;
  assert.deepEqual(await monitor.tick('store-1'), { events: 1 });
  assert.equal(logger.lines.warn.length, 1);
  const warnText = logger.lines.warn.join('\n');
  assert.match(warnText, /消息采集已断开/);
  assert.equal(warnText.includes('super-secret'), false);
  assert.equal(warnText.includes('http://'), false);
  const debugText = logger.lines.debug.join('\n');
  assert.ok(debugText.includes('<url>'));
  assert.equal(debugText.includes('super-secret'), false);
  assert.equal(debugText.includes('http://'), false);
  monitor.stopAll();
});

test('连续失败只告警一次，60 秒后可再次告警', async () => {
  let clock = NOW;
  const { adapter } = makeAdapter(() => ({ ok: false, reason: 'hook_not_ready', detail: 'bridge_missing' }));
  const { monitor, logger, emitted } = makeMonitor({ adapter, now: () => clock });
  await monitor.start('store-1');

  await monitor.tick('store-1');
  await monitor.tick('store-1');
  clock += 59_000;
  await monitor.tick('store-1');
  assert.equal(logger.lines.warn.length, 1);

  clock += 1_000;
  await monitor.tick('store-1');
  assert.equal(logger.lines.warn.length, 2);

  const lost = emitted.filter((e) => e.type === 'collection:lost');
  assert.equal(lost.length, 1, '反复失败不应重复通知渲染层');
  assert.deepEqual(lost[0], {
    type: 'collection:lost',
    storeId: 'store-1',
    reason: 'bridge_missing',
    reasonText: '采集桥接失效',
  });
  assert.match(logger.lines.warn[0], /^\[测试店\] 消息采集已断开（采集桥接失效），请在客户端刷新页面或重启客户端$/);
  monitor.stopAll();
});

test('恢复时补一条 INFO 并 emit collection:resumed', async () => {
  let ok = false;
  const adapter = {
    async drainEvents() {
      return ok ? { ok: true, seq: 1, events: [] } : { ok: false, reason: 'hook_not_ready', detail: 'bridge_missing' };
    },
  };
  const { monitor, logger, emitted } = makeMonitor({ adapter });
  await monitor.start('store-1');
  await monitor.tick('store-1');
  await monitor.tick('store-1');
  ok = true;
  await monitor.tick('store-1');
  await monitor.tick('store-1');

  assert.deepEqual(logger.lines.warn, [
    '[测试店] 消息采集已断开（采集桥接失效），请在客户端刷新页面或重启客户端',
  ]);
  assert.deepEqual(logger.lines.info, ['[测试店] 消息采集已恢复']);
  const types = emitted.map((e) => e.type);
  assert.deepEqual(types, ['collection:lost', 'collection:resumed']);
  assert.equal(emitted[1].storeId, 'store-1');
  assert.equal(emitted[1].reason, 'bridge_missing');
  monitor.stopAll();
});

test('drainEvents 正常时不告警、不发 collection 事件', async () => {
  const { adapter } = makeAdapter([{ ok: true, seq: 1, events: [event(1)] }]);
  const { monitor, logger, emitted } = makeMonitor({ adapter });
  await monitor.start('store-1');
  await monitor.tick('store-1');
  await monitor.tick('store-1');
  assert.deepEqual(logger.lines.warn, []);
  assert.deepEqual(logger.lines.info, ['[测试店] 收消息 买家 小明：消息1']);
  assert.deepEqual(emitted.map((e) => e.type), ['message:in']);
  assert.equal(monitor.status()['store-1'].collection.lost, false);
  monitor.stopAll();
});

test('失败原因映射：已知枚举转中文，未知原因保留原值', () => {
  const { mapCollectionReason, collectionFailureReason } = require('../src/main/message-monitor');
  assert.equal(mapCollectionReason('bridge_missing'), '采集桥接失效');
  assert.equal(mapCollectionReason('hook_not_ready'), '采集未就绪');
  assert.equal(mapCollectionReason('some_new_reason'), 'some_new_reason');
  assert.equal(mapCollectionReason(''), '未知原因');
  // detail 更具体时优先，未知 detail 不覆盖 reason
  assert.equal(collectionFailureReason({ reason: 'hook_not_ready', detail: 'bridge_missing' }), 'bridge_missing');
  assert.equal(collectionFailureReason({ reason: 'hook_not_ready', detail: 'connect timeout' }), 'hook_not_ready');
  assert.equal(collectionFailureReason({ reason: 'hook_not_ready' }), 'hook_not_ready');
});
test('图片类型、消息编号和顾客名必须保留到主进程会话事件',async()=>{const {adapter}=makeAdapter([{ok:true,seq:1,events:[event(1,{type:'image',content:'https://images.example.com/a.png'})]}]);const {monitor,emitted}=makeMonitor({adapter});await monitor.start('store-1');await monitor.tick('store-1');assert.equal(emitted[0].messageType,'image');assert.equal(emitted[0].msgId,'m1');assert.equal(emitted[0].username,'小明');monitor.stopAll();});

