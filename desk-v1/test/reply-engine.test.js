'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { StoreWorker, ReplyEngine, mergeThread, buyerTexts } = require('../src/main/reply-engine');

const NOW = 1_700_000_000_000;

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};

function baseConfig(overrides = {}) {
  const base = {
    ai: { systemPrompt: 'SYS', timeoutMs: 1000 },
    reply: {
      enabled: true,
      pollIntervalMs: 60000,
      maxInflight: 6,
      staleMs: 180000,
      recoverWindowMs: 600000,
      fallbackAfterMs: 0,
      fallbackText: '稍等',
      maxReplyChars: 200,
      handoffText: '正在转接人工客服',
      perUidMinIntervalMs: 60000,
      sendJitterMinMs: 500,
      sendJitterMaxMs: 2000,
      perStorePerMinuteMax: 20,
    },
    safety: { handoffKeywords: ['投诉'], manualReplyKeywords: [] },
  };
  return {
    ...base,
    ...overrides,
    ai: { ...base.ai, ...(overrides.ai || {}) },
    reply: { ...base.reply, ...(overrides.reply || {}) },
    safety: { ...base.safety, ...(overrides.safety || {}) },
  };
}

function buyerRow(uid, msgId, content = '在吗', ts = NOW - 1000) {
  return {
    uid,
    messages: [{ msgId, from: 'buyer', type: 'text', content, ts }],
  };
}

function makeAdapter(rows = []) {
  const state = {
    queue: [...rows],
    sent: [],
    released: [],
    discarded: [],
    merchant: [],
    history: {},
    aiSync: [],
    ensureCalls: 0,
    sendOverride: null,
    failPops: 0,
  };
  const adapter = {
    id: 'fake',
    accessMode: 'webview',
    supports: () => true,
    ensure: async () => {
      state.ensureCalls += 1;
      return { ok: true };
    },
    preparePending: async () => ({ ok: true }),
    popPending: async () => {
      if (state.failPops > 0) {
        state.failPops -= 1;
        throw new Error('hook 未就绪');
      }
      return state.queue.shift() || null;
    },
    pendingSnapshot: async () => ({ ok: true, count: state.queue.length, uids: state.queue.map((r) => r.uid) }),
    conversationHistory: async (uid) => ({ ok: true, messages: state.history[uid] || [] }),
    sendText: async (uid, text) => {
      if (state.sendOverride) return state.sendOverride(uid, text);
      state.sent.push({ uid, text });
      return { ok: true, msgId: `s-${state.sent.length}` };
    },
    sendImage: async () => ({ ok: true }),
    sendVideo: async () => ({ ok: true }),
    release: async (uid) => {
      state.released.push(uid);
      return { ok: true };
    },
    discard: async (uid) => {
      state.discarded.push(uid);
      return { ok: true };
    },
    popMerchantSent: async () => {
      const items = state.merchant;
      state.merchant = [];
      return items;
    },
    syncAiEnabled: async (enabled) => {
      state.aiSync.push(enabled);
      return { ok: true };
    },
    focusConversation: async () => ({ ok: true }),
  };
  return { adapter, state };
}

function makeAi({ reply = '您好', gate = null } = {}) {
  return {
    calls: 0,
    last: null,
    async reply(payload) {
      this.calls += 1;
      this.last = payload;
      if (gate) await gate.promise;
      return { reply, images: [], videos: [], cardActions: [], couponName: '', handoff: false };
    },
  };
}

function gate() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function workerFor({
  rows = [],
  ai = makeAi(),
  config = baseConfig(),
  store = {},
  events = [],
  now = () => NOW,
  sleep = async () => {},
  random = () => 0,
} = {}) {
  const { adapter, state } = makeAdapter(rows);
  const worker = new StoreWorker({
    store: { id: 's1', storeName: '测试店', aiEnabled: true, ...store },
    adapter,
    aiClient: ai,
    getConfig: () => config,
    logger: silentLogger,
    onEvent: (event) => events.push(event),
    now,
    sleep,
    random,
  });
  worker.running = true;
  return { worker, adapter, state, ai, events };
}

async function waitFor(check, timeoutMs = 1000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('每店回复引擎使用自己的实时关键词，配置更新不需要重启', async () => {
  const first = makeAdapter([buyerRow('u1', 'm1', '我要退款')]);
  const second = makeAdapter([buyerRow('u2', 'm2', '我要退款')]);
  const ai = makeAi();
  const config = baseConfig();
  const perStore = { s1: ['退款'], s2: ['人工'] };
  const engine = new ReplyEngine({
    registry: { get: id => ({ id, storeName: id, aiEnabled: true }) },
    adapterFactory: store => store.id === 's1' ? first.adapter : second.adapter,
    aiClient: ai,
    getConfig: id => ({ ...config, safety: { ...config.safety, handoffKeywords: perStore[id] || [] } }),
    logger: silentLogger, now: () => NOW, sleep: async () => {}, random: () => 0,
  });
  const a = await engine.startStore('s1');
  const b = await engine.startStore('s2');
  try {
    await a.tick(); await b.tick(); await a.settle(); await b.settle();
    assert.equal(a.stats.transferred, 1);
    assert.equal(b.stats.transferred, 0);
    assert.equal(ai.calls, 1);
    perStore.s2 = ['退款'];
    second.state.queue.push(buyerRow('u3', 'm3', '需要退款'));
    await b.tick(); await b.settle();
    assert.equal(b.stats.transferred, 1);
    assert.equal(ai.calls, 1);
  } finally { engine.stopAll(); }
});

test('AI 禁用词按长词优先单次替换，空回复不发送并交给人工', async () => {
  const config=baseConfig({safety:{bannedWords:[{word:'微信',replacement:''},{word:'微信客服',replacement:'人工客服'}]}});
  const ai=makeAi({reply:'请联系微信客服，微信123'});
  const first=workerFor({rows:[buyerRow('u1','m1')],ai,config});
  await first.worker.tick();await first.worker.settle();
  assert.deepEqual(first.state.sent,[{uid:'u1',text:'请联系人工客服，123'}]);
  const second=workerFor({rows:[buyerRow('u2','m2')],ai:makeAi({reply:'微信'}),config});
  await second.worker.tick();await second.worker.settle();
  assert.deepEqual(second.state.sent,[]);
  assert.deepEqual(second.state.discarded,['u2']);
  assert.ok(second.events.some(e=>e.type==='reply:failed'&&e.reason==='banned_empty'));
  assert.ok(second.events.some(e=>e.type==='reply:needs-manual'&&e.reason==='banned_empty'));
  const expanded=workerFor({rows:[buyerRow('u3','m3')],ai:makeAi({reply:'x'}),config:baseConfig({reply:{maxReplyChars:5},safety:{bannedWords:[{word:'x',replacement:'123456789'}]}})});
  await expanded.worker.tick();await expanded.worker.settle();
  assert.equal(expanded.state.sent[0].text,'12345');
});

test('正常链路：消费 pending → AI → 发送 → discard，并写入自发送台账', async () => {
  const ai = makeAi({ reply: '在的亲，有货' });
  const { worker, state, events } = workerFor({ rows: [buyerRow('u1', 'm1')], ai });
  await worker.tick();
  await worker.settle();

  assert.deepEqual(state.sent, [{ uid: 'u1', text: '在的亲，有货' }]);
  assert.deepEqual(state.discarded, ['u1']);
  assert.deepEqual(state.released, []);
  assert.equal(worker.stats.replied, 1);
  assert.equal(ai.calls, 1);
  assert.match(ai.last.systemPrompt, /SYS/);
  assert.equal(ai.last.thread.at(-1).content, '在吗');
  assert.ok(events.some((e) => e.type === 'reply:sent'));
  assert.equal(worker.selfSend.size(), 1);
});

test('同一 uid 不并发：第二次认领立即归还，只回复一次', async () => {
  const g = gate();
  const ai = makeAi({ gate: g });
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1'), buyerRow('u1', 'm2')],
    ai,
  });
  const result = await worker.tick();
  assert.equal(result.popped, 1);
  await waitFor(() => ai.calls === 1);
  assert.deepEqual(state.released, ['u1']);
  g.resolve();
  await worker.settle();
  assert.equal(ai.calls, 1);
  assert.equal(state.sent.length, 1);
  assert.deepEqual(state.discarded, ['u1']);
});

test('maxInflight 限制同时处理数，腾出槽位后继续消费', async () => {
  const g = gate();
  const ai = makeAi({ gate: g });
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1'), buyerRow('u2', 'm2'), buyerRow('u3', 'm3')],
    ai,
    config: baseConfig({ reply: { maxInflight: 2 } }),
  });
  await worker.tick();
  await waitFor(() => ai.calls === 2);
  assert.equal(worker.inflight, 2);
  assert.equal(state.queue.length, 1);
  g.resolve();
  await worker.settle();
  assert.equal(worker.inflight, 0);

  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 3);
});

test('人工已回复则 AI 不介入', async () => {
  const ai = makeAi();
  const { worker, state } = workerFor({ rows: [buyerRow('u1', 'm1', '在吗', NOW - 5000)], ai });
  state.merchant = [
    { uid: 'u1', message: { msgId: 'seller-1', from: 'seller', type: 'text', content: '人工回复', ts: NOW } },
  ];
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.deepEqual(state.discarded, ['u1']);
  assert.equal(worker.stats.skipped, 1);
});

test('命中转人工关键词：发转接话术并上报事件，不调用 AI', async () => {
  const ai = makeAi();
  const { worker, state, events } = workerFor({
    rows: [buyerRow('u1', 'm1', '我要投诉你们')],
    ai,
  });
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.deepEqual(state.sent, [{ uid: 'u1', text: '正在转接人工客服' }]);
  const transfer = events.find((e) => e.type === 'reply:transfer');
  assert.ok(transfer);
  assert.equal(transfer.keyword, '投诉');
  assert.equal(worker.stats.transferred, 1);
});

test('send_unconfirmed 不自动重发：直接 discard 并上报失败', async () => {
  const ai = makeAi();
  const { worker, state, events } = workerFor({ rows: [buyerRow('u1', 'm1')], ai });
  state.sendOverride = async () => ({ ok: false, reason: 'send_unconfirmed' });
  await worker.tick();
  await worker.settle();
  assert.deepEqual(state.discarded, ['u1']);
  assert.deepEqual(state.released, []);
  assert.equal(events.filter((e) => e.type === 'reply:failed').length, 1);
  assert.equal(worker.stats.replied, 0);
});

test('input_busy 归还队列等待下次重试', async () => {
  const ai = makeAi();
  const { worker, state } = workerFor({ rows: [buyerRow('u1', 'm1')], ai });
  state.sendOverride = async () => ({ ok: false, reason: 'input_busy' });
  await worker.tick();
  await worker.settle();
  assert.deepEqual(state.released, ['u1']);
  assert.deepEqual(state.discarded, []);
  assert.equal(worker.stats.failed, 1);
});

test('AI 失败归还队列，不丢消息', async () => {
  const ai = {
    async reply() {
      throw new Error('llm_timeout');
    },
  };
  const { worker, state } = workerFor({ rows: [buyerRow('u1', 'm1')], ai });
  await worker.tick();
  await worker.settle();
  assert.deepEqual(state.released, ['u1']);
  assert.deepEqual(state.discarded, []);
  assert.equal(state.sent.length, 0);
});

test('已回复的同一消息不重复回复', async () => {
  const ai = makeAi({ reply: '好' });
  const { worker, state } = workerFor({ rows: [buyerRow('u1', 'm1')], ai });
  await worker.tick();
  await worker.settle();
  state.queue.push(buyerRow('u1', 'm1'));
  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 1);
  assert.equal(worker.stats.skipped, 1);
});

test('D-04：AI 自己发出的回环（有 msgId）不触发手动回复抑制', async () => {
  const ai = makeAi({ reply: '您好' });
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1')],
    ai,
    config: baseConfig({ reply: { perUidMinIntervalMs: 0 }, safety: { manualReplyKeywords: ['您好'] } }),
  });
  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 1);
  assert.equal(worker.manualSuppressed.size, 0);

  // 回环消息：与发送台账 msgId 一致，必须被识别为自发送
  state.merchant = [
    { uid: 'u1', message: { msgId: 's-1', from: 'seller', content: '您好', ts: NOW + 100 } },
  ];
  state.queue.push(buyerRow('u1', 'm2', '另一个问题', NOW + 200));
  await worker.tick();
  await worker.settle();
  assert.equal(worker.manualSuppressed.size, 0);
  assert.equal(ai.calls, 2);
  assert.equal(state.sent.length, 2);
});

test('D-04：无 msgId 时 8 秒文本兜底识别自发送，超 8 秒按人工处理', async () => {
  let clock = NOW;
  const ai = makeAi({ reply: '您好' });
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1')],
    ai,
    config: baseConfig({ safety: { manualReplyKeywords: ['您好'] } }),
    now: () => clock,
  });
  state.sendOverride = async (uid, text) => {
    state.sent.push({ uid, text });
    return { ok: true }; // 平台没有返回 msgId
  };
  await worker.tick();
  await worker.settle();

  // 5 秒内无 msgId 同文 → 自发送
  clock = NOW + 5000;
  state.merchant = [{ uid: 'u1', message: { from: 'seller', content: '您好', ts: NOW + 5000 } }];
  await worker.tick();
  await worker.settle();
  assert.equal(worker.manualSuppressed.size, 0);

  // 9 秒后同文但无 msgId → 视为人工发送，命中关键词取消 AI
  clock = NOW + 9000;
  state.merchant = [{ uid: 'u1', message: { from: 'seller', content: '您好', ts: NOW + 9000 } }];
  await worker.tick();
  await worker.settle();
  assert.equal(worker.manualSuppressed.has('u1'), true);
});

test('D-07：卖家侧消息命中 manualReplyKeywords，取消该会话 AI 并上报事件', async () => {
  const ai = makeAi();
  const { worker, state, events } = workerFor({
    rows: [buyerRow('u1', 'm1', '在吗', NOW - 1000)],
    ai,
    config: baseConfig({ safety: { manualReplyKeywords: ['我来接待'] } }),
  });
  state.merchant = [
    { uid: 'u1', message: { msgId: 'manual-1', from: 'seller', content: '我来接待', ts: NOW } },
  ];
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.equal(worker.stats.skipped, 1);
  assert.deepEqual(state.discarded, ['u1']);
  assert.equal(worker.manualSuppressed.has('u1'), true);
  const event = events.find((e) => e.type === 'reply:manual_suppress');
  assert.ok(event);
  assert.equal(event.keyword, '我来接待');

  // 后续买家消息仍然不回复，直到显式恢复
  state.queue.push(buyerRow('u1', 'm2', '还在吗', NOW + 1000));
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.equal(worker.clearManualSuppression('u1'), true);
  state.queue.push(buyerRow('u1', 'm3', '有人吗', NOW + 2000));
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 1);
});

test('D-07：pending 行里的卖家侧消息同样能取消 AI', async () => {
  const ai = makeAi();
  const row = {
    uid: 'u1',
    messages: [
      { msgId: 'b1', from: 'buyer', type: 'text', content: '在吗', ts: NOW - 1000 },
      { msgId: 's1', from: 'seller', type: 'text', content: '转人工', ts: NOW - 500 },
    ],
  };
  const { worker, state } = workerFor({
    rows: [row],
    ai,
    config: baseConfig({ safety: { manualReplyKeywords: ['转人工'] } }),
  });
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.equal(worker.manualSuppressed.has('u1'), true);
  assert.deepEqual(state.discarded, ['u1']);
});

test('D-07：兜底与 AI 正文都发，兜底不占用同 uid 60s 间隔', async () => {
  const g = gate();
  const ai = makeAi({ reply: '正文', gate: g });
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1')],
    ai,
    config: baseConfig({ reply: { fallbackAfterMs: 10, fallbackText: '兜底' } }),
  });
  await worker.tick();
  await waitFor(() => state.sent.length === 1);
  assert.deepEqual(state.sent[0], { uid: 'u1', text: '兜底' });
  g.resolve();
  await worker.settle();
  assert.deepEqual(state.sent.map((s) => s.text), ['兜底', '正文']);
  assert.equal(worker.stats.fallback, 1);
  assert.equal(worker.stats.replied, 1);
});

test('D-05：重登恢复后，补回窗口内消息即使超过 staleMs 也回复', async () => {
  let clock = NOW;
  const ai = makeAi();
  const { worker, state, events } = workerFor({
    rows: [],
    ai,
    now: () => clock,
    config: baseConfig({ reply: { staleMs: 180000, recoverWindowMs: 600000 } }),
  });
  // 登录过期：popPending 抛错
  state.failPops = 1;
  await worker.tick();
  assert.equal(worker.degraded, true);

  // 重登后消息已积压 5 分钟（超过 staleMs，仍在 recoverWindowMs 内）
  clock = NOW + 300000;
  state.queue.push(buyerRow('u1', 'm1', '等了很久', NOW - 300000 + 1000));
  await worker.tick();
  await worker.settle();
  assert.equal(worker.degraded, false);
  assert.equal(worker.recoveredAt, NOW + 300000);
  assert.equal(ai.calls, 1);
  assert.equal(worker.stats.missed, 0);
  assert.ok(events.some((e) => e.type === 'store:recovered'));
});

test('D-05：超出 recoverWindowMs 的消息只入档不回复，累计漏回计数', async () => {
  let clock = NOW;
  const ai = makeAi();
  const { worker, state, events } = workerFor({
    rows: [],
    ai,
    now: () => clock,
    config: baseConfig({ reply: { recoverWindowMs: 600000 } }),
  });
  state.failPops = 1;
  await worker.tick();

  clock = NOW + 300000;
  state.queue.push(buyerRow('u1', 'm1', '很久以前', NOW - 800000));
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.equal(worker.stats.missed, 1);
  assert.deepEqual(state.discarded, ['u1']);
  const missed = events.find((e) => e.type === 'reply:missed');
  assert.ok(missed);
  assert.equal(missed.recoverWindowMs, 600000);
});

test('D-05：未发生重登时，超过 staleMs 只按过期跳过，不记漏回', async () => {
  const ai = makeAi();
  const { worker, state, events } = workerFor({
    rows: [buyerRow('u1', 'm1', '旧消息', NOW - 400000)],
    ai,
  });
  await worker.tick();
  await worker.settle();
  assert.equal(ai.calls, 0);
  assert.equal(worker.stats.skipped, 1);
  assert.equal(worker.stats.missed, 0);
  assert.equal(events.some((e) => e.type === 'reply:missed'), false);
});

test('D-11：同 uid 最小间隔 60s，第二次发送被限流并归还队列', async () => {
  let clock = NOW;
  const ai = makeAi();
  const { worker, state, events } = workerFor({
    rows: [buyerRow('u1', 'm1', '在吗', NOW - 1000)],
    ai,
    now: () => clock,
    config: baseConfig({ reply: { perUidMinIntervalMs: 60000 } }),
  });
  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 1);

  clock = NOW + 1000;
  state.queue.push(buyerRow('u1', 'm2', '还有吗', NOW + 500));
  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 1);
  assert.equal(worker.stats.throttled, 1);
  assert.deepEqual(state.released, ['u1']);
  const throttled = events.find((e) => e.type === 'reply:throttled');
  assert.ok(throttled);
  assert.equal(throttled.reason, 'uid_interval');
});

test('D-11：发送前抖动按 0.5~2s 配置生成', async () => {
  const sleeps = [];
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1')],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    config: baseConfig({ reply: { sendJitterMinMs: 500, sendJitterMaxMs: 2000 } }),
  });
  await worker.tick();
  await worker.settle();
  assert.deepEqual(sleeps, [1250]);
  assert.equal(state.sent.length, 1);
});

test('D-11：单店每分钟发送上限可配，超出后限流', async () => {
  const ai = makeAi();
  const { worker, state } = workerFor({
    rows: [buyerRow('u1', 'm1')],
    ai,
    config: baseConfig({ reply: { perStorePerMinuteMax: 1 } }),
  });
  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 1);

  state.queue.push(buyerRow('u2', 'm2'));
  await worker.tick();
  await worker.settle();
  assert.equal(state.sent.length, 1);
  assert.equal(worker.stats.throttled, 1);
  assert.equal(worker.stats.failed, 0);
});

test('ReplyEngine 注入 adapterFactory 与 aiClient，启动时 ensure + 同步 AI 开关', async () => {
  const { adapter, state } = makeAdapter([]);
  const store = { id: 's1', storeName: '店', aiEnabled: true };
  const engine = new ReplyEngine({
    registry: { get: (id) => (id === 's1' ? store : null) },
    adapterFactory: async () => adapter,
    aiClient: makeAi(),
    getConfig: () => baseConfig(),
    logger: silentLogger,
  });
  const worker = await engine.startStore('s1');
  assert.ok(worker);
  assert.equal(state.ensureCalls, 1);
  assert.deepEqual(state.aiSync, [true]);
  assert.equal(engine.status().s1.running, true);
  assert.equal(engine.stopStore('s1'), true);
  assert.deepEqual(engine.status(), {});
});

test('ReplyEngine 拒绝不符合契约的适配器', async () => {
  const engine = new ReplyEngine({
    registry: { get: () => ({ id: 's1', storeName: '店', aiEnabled: true }) },
    adapterFactory: async () => ({ id: 'bad', ensure: async () => ({ ok: true }) }),
    aiClient: makeAi(),
    getConfig: () => baseConfig(),
    logger: silentLogger,
  });
  await assert.rejects(() => engine.startStore('s1'), /adapter_contract_violation/);
});

test('ReplyEngine：非 webview 接入的 hook_not_ready 不阻塞启动，等待外部客户端', async () => {
  const { adapter } = makeAdapter([]);
  adapter.accessMode = 'client-inject';
  adapter.ensure = async () => ({ ok: false, reason: 'hook_not_ready' });
  const events = [];
  const engine = new ReplyEngine({
    registry: { get: () => ({ id: 's1', storeName: '店', aiEnabled: true }) },
    adapterFactory: async () => adapter,
    aiClient: makeAi(),
    getConfig: () => baseConfig(),
    logger: silentLogger,
    onEvent: (e) => events.push(e),
  });
  const worker = await engine.startStore('s1');
  assert.ok(worker);
  assert.ok(events.some((e) => e.type === 'store:awaiting_client'));
});

test('ReplyEngine：webview 接入的 hook_not_ready 仍然拒绝启动', async () => {
  const { adapter } = makeAdapter([]);
  adapter.ensure = async () => ({ ok: false, reason: 'hook_not_ready' });
  const engine = new ReplyEngine({
    registry: { get: () => ({ id: 's1', storeName: '店', aiEnabled: true }) },
    adapterFactory: async () => adapter,
    aiClient: makeAi(),
    getConfig: () => baseConfig(),
    logger: silentLogger,
  });
  await assert.rejects(() => engine.startStore('s1'), /adapter_not_ready:hook_not_ready/);
});

test('mergeThread 去重并按时间升序，buyerTexts 只取买家文本', () => {
  const merged = mergeThread(
    [{ msgId: 'm2', from: 'buyer', content: 'b', ts: 2 }],
    [
      { msgId: 'm2', from: 'buyer', content: 'b', ts: 2 },
      { msgId: 'm1', from: 'seller', content: 'a', ts: 1 },
    ],
  );
  assert.deepEqual(merged.map((m) => m.msgId), ['m1', 'm2']);
  assert.equal(buyerTexts([{ from: 'buyer', content: 'x' }, { from: 'seller', content: 'y' }]).length, 1);
});

for (const action of ['stop', 'pause-resume']) test(`inflight AI is cancelled after ${action}`, async () => {
 const pending=gate(); const {worker,state}=workerFor({rows:[buyerRow('cancel','m-cancel')],ai:makeAi({gate:pending})});
 await worker.tick(); worker[action==='stop'?'stop':'pause'](); if(action==='pause-resume')worker.resume(); pending.resolve();await worker.settle();
 assert.equal(state.sent.length,0);assert.ok(state.released.includes('cancel'));
});
test('stop during jitter cancels sending',async()=>{
 const pending=gate();const entered=gate();const {worker,state}=workerFor({rows:[buyerRow('jitter','m-jitter')],sleep:async()=>{entered.resolve();await pending.promise}});
 await worker.tick();await entered.promise;worker.stop();pending.resolve();await worker.settle();assert.equal(state.sent.length,0);
});
test('manual takeover blocks only that conversation in flight',async()=>{
 const pending=gate();const {worker,state}=workerFor({rows:[buyerRow('manual','m1'),buyerRow('other','m2')],ai:makeAi({gate:pending})});
 await worker.tick();worker.manualSuppressed.add('manual');pending.resolve();await worker.settle();
 assert.deepEqual(state.sent.map(s=>s.uid),['other']);
});
