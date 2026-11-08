'use strict';
/**
 * desk-v1 · hook 离线自测
 * 在 fixture 页面上真实注入 src/injections/pdd-web-hook.js，验证：
 *   1) 注入 / 版本握手 / 页面元素探测
 *   2) DOM 采集入 pending（买家），卖家消息不入 pending
 *   3) WebSocket 帧采集入 pending
 *   4) 三表语义：popPending → claimed → releasePendingClaim 归还
 *   5) UI 注入发送：文本真的写入输入框并点发送；self-send 8s 去重不重复入 sent
 *   6) 发送失败 reason：input_busy / input_not_found / send_unconfirmed
 *   7) anti-content 只观测不生成，缓存 TTL 为 6000ms
 *   8) 持久化 msgId 水位：页面 reload 后历史消息不重放进 pending；新消息仍能采集
 *   9) 事件通道 drainEvents：买卖双方入队后可 drain、seq 单调、缓冲上限 500、
 *      reload 后 seq 从 1 重置、只读不碰 pending/claim
 *
 * 用法：node scripts/run-electron.js scripts/hook-selftest.js
 * 输出：单行 [HOOK-SELFTEST] {"ok":true,...}
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

// 每次自测用独立 userData，避免上一次的持久化水位污染本轮「首次采集」断言
app.setPath('userData', path.join(os.tmpdir(), `desk-v1-hook-selftest-${process.pid}`));

const HOOK_PATH = path.join(__dirname, '..', 'src', 'injections', 'pdd-web-hook.js');
const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'mms-chat.html');
const DOUDIAN_HOOK_PATH = path.join(__dirname, '..', 'src', 'injections', 'doudian-bridge.js');
const DOUDIAN_FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'doudian-chat.html');
const SILENT_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function done(payload, code) {
  console.log(`[HOOK-SELFTEST] ${JSON.stringify(payload)}`);
  app.exit(code || 0);
}

async function injectHook(wc) {
  const source = fs.readFileSync(HOOK_PATH, 'utf8');
  await wc.executeJavaScript(source, true);
  return wc.executeJavaScript('(window.__pddWeb && window.__pddWeb.ver) || 0', true);
}

async function evalJson(wc, expr) {
  return JSON.parse(await wc.executeJavaScript(`JSON.stringify((${expr}))`, true));
}

async function evalAsync(wc, expr) {
  return JSON.parse(await wc.executeJavaScript(`(async () => JSON.stringify(await (${expr})))()`, true));
}

/**
 * 抖店 fixture 套件（D-13）：
 *   - 注入 bridge → 订阅 message$ + DOM 扫描 → 买家消息入 pending、卖家消息不入
 *   - popPending → release 归还
 *   - im.sendText 真调用 + 回显确认 + self-send 去重 + popSent
 *   - 发送抛错 → send_unconfirmed
 *   - reload 后历史不重放，新消息仍可采集
 *   - 适配器端到端（webContentsProvider 模拟容器页）
 */
async function runDoudianSuite(checks) {
  const contract = require(path.join(__dirname, '..', 'src', 'shared', 'adapter-contract.js'));
  const platform = require(path.join(__dirname, '..', 'src', 'adapters'));
  const source = fs.readFileSync(DOUDIAN_HOOK_PATH, 'utf8');
  const url = pathToFileURL(DOUDIAN_FIXTURE).href;
  const buyer = 'AQbuyer-fixture';

  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 720,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL(url);
  const wc = win.webContents;
  await wc.executeJavaScript('try { localStorage.clear(); } catch (e) {} true', true);

  checks.doudianBeforeInject = (await evalJson(wc, 'window.__DESK_DOUDIAN_VER || 0')) === 0;
  await wc.executeJavaScript(source, true);
  checks.doudianHookVersion = await evalJson(wc, 'window.__DESK_DOUDIAN_VER || 0');
  checks.doudianInjected = checks.doudianHookVersion > 0;
  checks.doudianVersionMarker = (await evalJson(wc, 'window.__DESK_DOUDIAN_VER || 0')) === checks.doudianHookVersion;

  await sleep(2200);
  await wc.executeJavaScript('window.__deskDoudian.scanNow && window.__deskDoudian.scanNow()', true);
  await sleep(300);

  const state = await evalJson(
    wc,
    '({ stats: window.__deskDoudian.stats(), selfTest: window.__deskDoudian.selfTest(), lastError: window.__deskDoudian.lastError })',
  );
  checks.doudianLastError = state.lastError;
  checks.doudianHasIm = state.selfTest.hasIm === true;
  checks.doudianArmed = state.selfTest.armed === true;
  checks.doudianDomIngested = state.stats.ingested > 0;
  checks.doudianBridgeGlobal = (await evalJson(wc, 'typeof window.__deskDoudianBridge.call')) === 'function';

  /* ---------------- 入队 / 认领 / 归还 ---------------- */
  const popped = await evalAsync(wc, 'window.__deskDoudian.popPending()');
  checks.doudianPendingUid = popped.uid || '';
  checks.doudianPendingBuyerMessage = (popped.messages || []).some(
    (m) => m.from === 'buyer' && String(m.content).includes('外套'),
  );
  checks.doudianPendingExcludesSeller = !(popped.messages || []).some((m) => m.from === 'seller');

  const released = await evalAsync(wc, `window.__deskDoudian.releasePendingClaim(${JSON.stringify(popped.uid || '')})`);
  checks.doudianReleased = released === true;
  const poppedAgain = await evalAsync(wc, 'window.__deskDoudian.popPending()');
  checks.doudianReleaseRestores =
    poppedAgain.uid === popped.uid && (poppedAgain.messages || []).length >= 1;
  if (poppedAgain.uid) {
    await evalAsync(wc, `window.__deskDoudian.releasePendingClaim(${JSON.stringify(poppedAgain.uid)})`);
  }

  /* ---------------- 发送成功 + 回显 + self-send 去重 ---------------- */
  const sendText = '亲，fixture 发送成功，今天下单今天发';
  const sendRes = await evalAsync(wc, `window.__deskDoudian.sendText(${JSON.stringify(buyer)}, ${JSON.stringify(sendText)})`);
  checks.doudianSendOk = sendRes.ok === true;
  checks.doudianSendMethod = sendRes.method || '';
  checks.doudianSendMsgId = typeof sendRes.msgId === 'string' && sendRes.msgId.length > 0;
  const sentInPage = await evalJson(wc, 'window.__sent || []');
  checks.doudianSendCalled = Array.isArray(sentInPage) && sentInPage.some((r) => r.text === sendText);
  await sleep(300);
  await wc.executeJavaScript('window.__deskDoudian.scanNow()', true);
  const sentQueue = await evalAsync(wc, `window.__deskDoudian.popSent(${JSON.stringify(buyer)})`);
  checks.doudianSentQueueLength = sentQueue.length;
  checks.doudianSelfSendDeduped =
    sentQueue.filter((m) => m.content === sendText).length === 1 &&
    sentQueue.every((m) => m.content !== sendText || m.from === 'seller');

  /* ---------------- 发送抛错 → send_unconfirmed ---------------- */
  await wc.executeJavaScript('window.__blockSend = true; true', true);
  const blocked = await evalAsync(wc, `window.__deskDoudian.sendText(${JSON.stringify(buyer)}, "这条应返回未确认")`);
  checks.doudianSendUnconfirmed = blocked.reason === 'send_unconfirmed';
  await wc.executeJavaScript('window.__blockSend = false; true', true);

  /* ---------------- 消息事件通道：drainEvents ---------------- */
  const ev1 = await evalAsync(wc, 'window.__deskDoudian.drainEvents({ sinceSeq: 0 })');
  checks.doudianEventsShape =
    ev1 && ev1.ok === true && typeof ev1.seq === 'number' && Array.isArray(ev1.events) && ev1.events.length > 0;
  checks.doudianEventsBuyer = ev1.events.some(
    (e) => e.uid === buyer && e.from === 'buyer' && String(e.content).includes('外套'),
  );
  checks.doudianEventsSeller = ev1.events.some((e) => e.uid === buyer && e.from === 'seller' && !!e.msgId);
  checks.doudianEventsFields = ev1.events.every(
    (e) =>
      typeof e.seq === 'number' &&
      ['buyer', 'seller'].includes(e.from) &&
      typeof e.uid === 'string' &&
      typeof e.type === 'string' &&
      typeof e.content === 'string' &&
      typeof e.ts === 'number',
  );
  checks.doudianEventsSeqMonotonic = ev1.events.every((e, i) => i === 0 || e.seq > ev1.events[i - 1].seq);

  const cursorSeq = ev1.events.length ? ev1.events[ev1.events.length - 1].seq : 0;
  const ev2 = await evalAsync(wc, `window.__deskDoudian.drainEvents({ sinceSeq: ${cursorSeq} })`);
  checks.doudianEventsIncrementalEmpty =
    ev2.ok === true && ev2.seq >= ev1.seq && ev2.events.every((e) => e.seq > cursorSeq);

  const drainMsg = '事件通道增量消息';
  const pendingBeforeDrain = (await evalAsync(wc, 'window.__deskDoudian.pendingSnapshot()')).count || 0;
  await wc.executeJavaScript(`window.__addBuyerMessage(${JSON.stringify(drainMsg)}); true`, true);
  await sleep(300);
  await wc.executeJavaScript('window.__deskDoudian.scanNow()', true);
  const ev3 = await evalAsync(wc, `window.__deskDoudian.drainEvents({ sinceSeq: ${cursorSeq} })`);
  checks.doudianEventsIncrementalNew = ev3.events.some(
    (e) => e.from === 'buyer' && String(e.content).includes(drainMsg),
  );
  const pendingAfterDrain = (await evalAsync(wc, 'window.__deskDoudian.pendingSnapshot()')).count || 0;
  checks.doudianDrainKeepsPending = pendingAfterDrain >= pendingBeforeDrain;

  const evDefault = await evalAsync(wc, 'window.__deskDoudian.drainEvents()');
  checks.doudianEventsDefaultCap = evDefault.ok === true && evDefault.events.length <= 200;

  // 环形缓冲上限 500：用独立 uid 灌 520 条，避免影响 buyer 的持久化水位/reload 断言。
  // 只推 message$ 单通道：双通道会制造重复回放，抬高 replayed 计数、干扰 reload 对比。
  const capUid = 'AQbuyer-cap';
  await wc.executeJavaScript(
    `for (let i = 0; i < 520; i++) {
       window.__fixture.message$.next({
         serverId: 'evt-cap-' + i,
         conversationId: ${JSON.stringify(capUid + ':' + '10001::2:1:pigeon')},
         senderRole: '1',
         isFromMe: false,
         content: '事件缓冲上限 ' + i,
         createTime: Date.now() + 1,
         ext: { nickname: '缓冲测试', security_pigeon_uid: ${JSON.stringify(capUid)}, type: 'text' },
       });
     }
     true`,
    true,
  );
  await sleep(200);
  await wc.executeJavaScript('window.__deskDoudian.scanNow()', true);
  const evCap = await evalAsync(wc, 'window.__deskDoudian.drainEvents({ sinceSeq: 0 })');
  checks.doudianEventsBufferCap =
    evCap.ok === true && evCap.events.length === 500 && evCap.seq >= 520 && evCap.events[0].seq < evCap.seq;

  /* ---------------- 水位 + reload ---------------- */
  const wm = await evalJson(wc, `window.__deskDoudian.watermark(${JSON.stringify(buyer)})`);
  checks.doudianWatermarkWritten = !!wm && wm.ids > 0;
  const statsBefore = await evalJson(wc, 'window.__deskDoudian.stats()');
  checks.doudianReplayBefore = statsBefore.replayed || 0;

  await win.loadURL(url);
  await sleep(250);
  checks.doudianVersionAfterReload = (await injectDoudian(wc)) || 0;
  await sleep(2200);
  await wc.executeJavaScript('window.__deskDoudian.scanNow()', true);
  await sleep(300);

  const wmAfter = await evalJson(wc, `window.__deskDoudian.watermark(${JSON.stringify(buyer)})`);
  checks.doudianWatermarkLoadedAfterReload = !!wmAfter && wmAfter.ids > 0;
  const snapAfter = await evalAsync(wc, 'window.__deskDoudian.pendingSnapshot()');
  checks.doudianPendingAfterReloadEmpty = Object.keys(snapAfter).length === 0;
  const statsAfter = await evalJson(wc, 'window.__deskDoudian.stats()');
  checks.doudianReplayAfter = statsAfter.replayed || 0;
  checks.doudianReplayBlocked = (statsAfter.replayed || 0) > (statsBefore.replayed || 0);

  /* ---------------- reload 后新消息 ---------------- */
  const fresh = '重载后的新消息，请回复';
  await wc.executeJavaScript(`window.__addBuyerMessage(${JSON.stringify(fresh)}); true`, true);
  await sleep(700);
  await wc.executeJavaScript('window.__deskDoudian.scanNow()', true);
  await sleep(200);
  const freshRow = await evalAsync(wc, 'window.__deskDoudian.popPending()');
  checks.doudianFreshAfterReload = freshRow.uid === buyer && (freshRow.messages || []).some((m) => String(m.content).includes(fresh));
  if (freshRow.uid) await evalAsync(wc, `window.__deskDoudian.releasePendingClaim(${JSON.stringify(freshRow.uid)})`);

  /* ---------------- 适配器端到端 ---------------- */
  const store = { id: 'doudian-selftest', platform: 'doudian-client', shopId: '10001' };
  const adapter = platform.createAdapter(store, {
    logger: SILENT_LOGGER,
    config: { adapter: { expectedShopId: '10001' } },
    webContentsProvider: () => wc,
  });
  checks.doudianAdapterShape = contract.validateAdapter(adapter).ok === true;
  checks.doudianAdapterAccessMode = adapter.accessMode === 'client-inject';
  checks.doudianAdapterNoEntryUrl = platform.entryUrlFor(store) === null;
  checks.doudianAdapterAccessModeFor = platform.accessModeFor(store) === 'client-inject';

  const ensure = await adapter.ensure();
  checks.doudianAdapterEnsure = ensure.ok === true;
  const prepare = await adapter.preparePending();
  checks.doudianAdapterPrepare = prepare.ok === true;

  const snap = await adapter.pendingSnapshot();
  checks.doudianAdapterSnapshot = snap.ok === true && snap.count >= 1 && snap.uids.includes(buyer);
  const pop = await adapter.popPending();
  checks.doudianAdapterPopRow = !!pop && pop.uid === buyer && Array.isArray(pop.messages) && pop.messages.length >= 1;
  const snapClaimed = await adapter.pendingSnapshot();
  checks.doudianAdapterClaimHidden = !snapClaimed.uids.includes(buyer);
  const rel = await adapter.release(pop.uid);
  checks.doudianAdapterRelease = rel.ok === true;
  const pop2 = await adapter.popPending();
  checks.doudianAdapterReleaseRestores = !!pop2 && pop2.uid === pop.uid;
  const disc = await adapter.discard(pop2.uid, { beforeTs: Date.now() + 60000 });
  const snapDiscarded = await adapter.pendingSnapshot();
  checks.doudianAdapterDiscard = disc.ok === true && !snapDiscarded.uids.includes(pop2.uid);

  const history = await adapter.conversationHistory(buyer, { limit: 10 });
  checks.doudianAdapterHistory = history.ok === true && Array.isArray(history.messages);
  const focus = await adapter.focusConversation(buyer);
  checks.doudianAdapterFocus = focus.ok === true && (await evalJson(wc, 'window.__openedUid || ""')) === buyer;
  const ai = await adapter.syncAiEnabled(true);
  checks.doudianAdapterSyncAi = ai.ok === true;

  const adapterSend = await adapter.sendText(buyer, '适配器发送验证');
  checks.doudianAdapterSend = adapterSend.ok === true && typeof adapterSend.msgId === 'string';
  checks.doudianAdapterSendPassesContract = contract.assertResult(adapterSend, 'sendText').ok === true;
  const adapterSent = await adapter.popSent(buyer);
  checks.doudianAdapterPopSent = adapterSent.ok === true && adapterSent.messages.length >= 1;

  const adapterEvents = await adapter.drainEvents({ sinceSeq: 0 });
  checks.doudianAdapterDrainEvents =
    adapterEvents.ok === true &&
    typeof adapterEvents.seq === 'number' &&
    adapterEvents.events.some((e) => e.from === 'buyer') &&
    adapterEvents.events.some((e) => e.from === 'seller');
  const adapterEventsInc = await adapter.drainEvents({ sinceSeq: adapterEvents.seq });
  checks.doudianAdapterDrainIncremental =
    adapterEventsInc.ok === true && adapterEventsInc.seq >= adapterEvents.seq && adapterEventsInc.events.length === 0;
  const adapterEventsDefault = await adapter.drainEvents();
  checks.doudianAdapterDrainDefault = adapterEventsDefault.ok === true && adapterEventsDefault.events.length <= 200;
  const merchant = await adapter.popMerchantSent();
  checks.doudianAdapterMerchantSent = Array.isArray(merchant) && merchant.every((r) => r.uid && r.message);

  const media = await adapter.sendImage(buyer, { url: 'https://example.invalid/fixture.png' });
  checks.doudianAdapterImageUnverified = media.ok === false && media.reason === 'hook_not_ready';

  let videoCode = '';
  try {
    await adapter.sendVideo(buyer, { url: 'https://example.invalid/fixture.mp4' });
  } catch (e) {
    videoCode = e.code || '';
  }
  checks.doudianAdapterVideoUnsupported = videoCode === 'unsupported_capability';

  let invalidThrew = false;
  try {
    await adapter.sendText('', 'x');
  } catch (e) {
    invalidThrew = e instanceof TypeError;
  }
  checks.doudianAdapterInvalidThrows = invalidThrew;

  const dead = platform.createAdapter(store, { logger: SILENT_LOGGER, config: {} });
  const deadEnsure = await dead.ensure();
  checks.doudianAdapterNotReady = deadEnsure.ok === false && deadEnsure.reason === 'hook_not_ready';
  let deadPopThrew = '';
  try {
    await dead.popPending();
  } catch (e) {
    deadPopThrew = e.reason || '';
  }
  checks.doudianAdapterPopThrowsWhenNotReady = deadPopThrew === 'hook_not_ready';

  /* ---------------- 闲鱼 D-14：单入口 webview ---------------- */
  const xy = platform.createAdapter({ id: 'xy-selftest', platform: 'xianyu' }, { logger: SILENT_LOGGER, config: {} });
  checks.xianyuAdapterShape = contract.validateAdapter(xy).ok === true;
  checks.xianyuAccessModeWebview = xy.accessMode === 'webview';
  checks.xianyuEntryUrl = platform.entryUrlFor({ platform: 'xianyu' }) === 'https://www.goofish.com/im';
  checks.xianyuSupports = xy.supports('xianyu') === true && xy.supports('xianyu-seller') === false;
  let sellerThrew = false;
  try {
    platform.createAdapter({ id: 'xy-seller-selftest', platform: 'xianyu-seller' }, { logger: SILENT_LOGGER, config: {} });
  } catch (e) {
    sellerThrew = /unsupported_platform/.test(String(e && e.message));
  }
  checks.xianyuSellerNotImplemented = sellerThrew;
  const xyEnsure = await xy.ensure();
  checks.xianyuHookNotReady = xyEnsure.ok === false && xyEnsure.reason === 'hook_not_ready';

  /* ---------------- 页面模式：message$ 不可用，但 DOM 兜底可采集 → ensure 仍 ok ---------------- */
  const dwin = new BrowserWindow({
    show: false,
    width: 1100,
    height: 720,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await dwin.loadURL(url);
  const dwc = dwin.webContents;
  await dwc.executeJavaScript('try { localStorage.clear(); } catch (e) {}; true', true);
  await dwc.executeJavaScript(
    `(() => {
       const localIm = window.__workbench__ && window.__workbench__.workbenchOptions.extra.im;
       if (localIm) { delete localIm.message$; delete localIm._messagesUpsert$; }
       return true;
     })();`,
    true,
  );
  await dwc.executeJavaScript(source, true);
  await sleep(1800);
  await dwc.executeJavaScript('window.__deskDoudian.scanNow && window.__deskDoudian.scanNow()', true);
  const domEnsure = await evalAsync(dwc, 'window.__deskDoudianBridge.call("ensure", {})');
  checks.doudianPageDomFallbackEnsure =
    domEnsure.ok === true && domEnsure.collection === 'dom' && domEnsure.armed === false && domEnsure.mode === 'page';
  const domStats = await evalJson(dwc, 'window.__deskDoudian.stats()');
  checks.doudianPageDomFallbackCollection = domStats.collection === 'dom' && domStats.domScans > 0;
  dwin.destroy();

  /* ---------------- 抖店容器模式路由（假 webview，离线） ---------------- */
  const cwin = new BrowserWindow({
    show: false,
    width: 600,
    height: 400,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await cwin.loadURL('about:blank');
  const cwc = cwin.webContents;
  await cwc.executeJavaScript(
    `window.__DESK_DOUDIAN_BRIDGE_SOURCE__ = ${JSON.stringify(source)};
     window.__fakeCalls = [];
     // 复现真机缺陷：页面 ensure 报未就绪，但队列/采集仍然可用。
     window.__fakeEnsureBroken = true;
     // 复现：子 webview 查找失败（元素被容器移除），但已注入目标仍可采集。
     window.__hideFakeWebview = false;
     // 复现：子页重新加载后页面里的 bridge 全局消失。
     window.__fakeBridgePresent = false;
     window.__fakeInjectFail = false;
     window.__fakeInjects = 0;
     const fake = {
       src: 'https://im.jinritemai.com/im',
       executeJavaScript(expr) {
         const s = String(expr);
         window.__fakeCalls.push(s.slice(0, 80));
         // 握手探针（带稳定标记；注入源码里也含该标记，用长度区分）
         if (s.indexOf('/*desk-v1-handshake*/') >= 0 && s.length < 800) {
           return {
             ver: window.__fakeBridgePresent ? 1 : 0,
             marker: window.__fakeBridgePresent === true,
             bridge: window.__fakeBridgePresent === true,
           };
         }
         const m = /b\\.call\\("([^"]+)"/.exec(s);
         const method = m ? m[1] : '';
         if (!method) {
           // 注入源码：模拟子页执行。失败开关用于验证“无法注入”分支。
           if (window.__fakeInjectFail) throw new Error('inject_blocked');
           window.__fakeBridgePresent = true;
           window.__fakeInjects++;
           return true;
         }
         if (!window.__fakeBridgePresent) {
           return { ok: false, reason: 'hook_not_ready', detail: 'bridge_missing' };
         }
         if (method === 'ensure') {
           if (window.__fakeEnsureBroken) return { ok: false, reason: 'hook_not_ready', detail: 'message_observable_unavailable' };
           return { ok: true, mode: 'page', armed: true, collection: 'store', shopId: '10001' };
         }
         if (method === 'pendingSnapshot') return { ok: true, count: 1, uids: ['fake-uid'] };
         if (method === 'popPending') {
           return {
             uid: 'fake-uid',
             messages: [{ msgId: 'fake-m1', from: 'buyer', type: 'text', content: 'fixture', ts: Date.now() }],
           };
         }
         if (method === 'stats' || method === 'scanNow') {
           return { ver: 1, mode: 'page', armed: false, collection: 'store', frames: 2, ingested: 3, pending: 1, domScans: 2, shopId: '10001' };
         }
         if (method === 'selfTest') {
           return { mode: 'page', armed: false, collection: 'store', hasIm: true, hasSendText: true, shopId: '10001' };
         }
         if (method === 'release') return { ok: true, released: true };
         return { ok: true };
       }
     };
     Object.defineProperty(document, 'getElementsByTagName', {
       configurable: true,
       value: function (tag) {
         if (String(tag).toLowerCase() === 'webview') return window.__hideFakeWebview ? [] : [fake];
         return Document.prototype.getElementsByTagName.call(document, tag);
       }
     });
     true;`,
    true,
  );
  await cwc.executeJavaScript(source, true);
  checks.doudianContainerMode = (await evalJson(cwc, 'window.__deskDoudianBridge.mode')) === 'container';

  // 真机缺陷复现：页面级 ensure 返回 hook_not_ready，但 stats/pendingSnapshot 表明采集可用。
  const containerEnsure = await evalAsync(cwc, 'window.__deskDoudianBridge.call("ensure", {})');
  checks.doudianContainerEnsure = containerEnsure.ok === true && containerEnsure.shopId === '10001';
  checks.doudianContainerEnsureCollectionFallback =
    containerEnsure.mode === 'container' &&
    containerEnsure.webviewFound === true &&
    containerEnsure.collection === 'store' &&
    containerEnsure.via === 'stats';

  const containerStats = await evalAsync(cwc, 'window.__deskDoudianBridge.call("stats", {})');
  checks.doudianContainerStatsOk =
    containerStats.ok === true &&
    containerStats.mode === 'container' &&
    containerStats.webviewFound === true &&
    containerStats.collection === 'store' &&
    containerStats.page &&
    containerStats.page.mode === 'page';

  const containerSelfTest = await evalAsync(cwc, 'window.__deskDoudianBridge.call("selfTest", {})');
  checks.doudianContainerSelfTestOk =
    containerSelfTest.ok === true &&
    containerSelfTest.mode === 'container' &&
    containerSelfTest.page &&
    containerSelfTest.page.hasIm === true;

  const containerScan = await evalAsync(cwc, 'window.__deskDoudianBridge.call("scanNow", {})');
  checks.doudianContainerScanNowOk = containerScan.ok === true && containerScan.scanned === 1;

  const containerPop = await evalAsync(cwc, 'window.__deskDoudianBridge.call("popPending", {})');
  checks.doudianContainerRoute = containerPop.uid === 'fake-uid';
  checks.doudianContainerInjected = (await evalJson(cwc, 'window.__fakeCalls.length')) >= 2;

  /* ---------------- 子 webview 查找失败，但 store 采集可用 ---------------- */
  await cwc.executeJavaScript('window.__hideFakeWebview = true; true', true);
  const hiddenStats = await evalAsync(cwc, 'window.__deskDoudianBridge.call("stats", {})');
  checks.doudianContainerStatsNoWebviewStoreOk =
    hiddenStats.ok === true &&
    hiddenStats.webviewFound === false &&
    hiddenStats.collection === 'store' &&
    hiddenStats.targetCount === 1 &&
    Array.isArray(hiddenStats.targets) &&
    hiddenStats.targets.length === 1 &&
    hiddenStats.targets[0].bridgePresent === true &&
    hiddenStats.targets[0].attached === false;

  const hiddenEnsure = await evalAsync(cwc, 'window.__deskDoudianBridge.call("ensure", {})');
  checks.doudianContainerEnsureNoWebviewStoreOk =
    hiddenEnsure.ok === true && hiddenEnsure.webviewFound === false && hiddenEnsure.collection === 'store';

  const hiddenScan = await evalAsync(cwc, 'window.__deskDoudianBridge.call("scanNow", {})');
  checks.doudianContainerScanNowNoWebview = hiddenScan.ok === true && hiddenScan.scanned === 1;

  // core 走 ObjectBridge：ensure/stats/scanNow 都必须拿到 ok:true，且保留 webviewFound:false。
  const containerAdapter = platform.createAdapter(store, {
    logger: SILENT_LOGGER,
    config: {},
    doudianBridge: {
      call: (method, params) =>
        evalAsync(cwc, `window.__deskDoudianBridge.call(${JSON.stringify(method)}, ${JSON.stringify(params || {})})`),
    },
  });
  const adapterEnsureHidden = await containerAdapter.ensure();
  checks.doudianContainerAdapterEnsureNoWebview =
    adapterEnsureHidden.ok === true && adapterEnsureHidden.webviewFound === false && adapterEnsureHidden.mode === 'container';
  const adapterStats = await containerAdapter.stats();
  checks.doudianContainerAdapterStatsOk = adapterStats.ok === true && adapterStats.webviewFound === false;
  const adapterScan = await containerAdapter.scanNow();
  checks.doudianContainerAdapterScanOk = adapterScan.ok === true;

  /* ---------------- 真机缺陷回归：target 失效自愈 ---------------- */
  // 1) 子页重新加载：页面里的 bridge 全局消失（容器缓存仍指向同一个 webview）。
  await cwc.executeJavaScript('window.__hideFakeWebview = false; window.__fakeBridgePresent = false; true', true);
  const healedPop = await evalAsync(cwc, 'window.__deskDoudianBridge.call("popPending", {})');
  checks.doudianContainerSelfHealPop =
    healedPop.uid === 'fake-uid' && healedPop.reinjected === true && healedPop.reinjectAttempts >= 1;
  const healStats = await evalAsync(cwc, 'window.__deskDoudianBridge.call("stats", {})');
  checks.doudianContainerSelfHealStats =
    healStats.ok === true &&
    healStats.collection === 'store' &&
    Array.isArray(healStats.targets) &&
    healStats.targets.length === 1 &&
    healStats.targets[0].bridgePresent === true &&
    healStats.targets[0].reinjects >= 1 &&
    healStats.targets[0].lastOkAt > 0 &&
    healStats.reinjects >= 1;
  checks.doudianContainerSelfHealInjects = (await evalJson(cwc, 'window.__fakeInjects')) >= 2;

  // 2) 无法注入：必须返回明确 bridge_missing + reinjectAttempts，且 stats 能看出失败目标。
  await cwc.executeJavaScript('window.__fakeBridgePresent = false; window.__fakeInjectFail = true; true', true);
  const doomedPop = await evalAsync(cwc, 'window.__deskDoudianBridge.call("popPending", {})');
  checks.doudianContainerReinjectFails =
    doomedPop.ok === false &&
    doomedPop.reason === 'hook_not_ready' &&
    doomedPop.detail === 'bridge_missing' &&
    doomedPop.reinjectAttempts >= 1 &&
    doomedPop.reinjectFailed === true;
  const doomedStats = await evalAsync(cwc, 'window.__deskDoudianBridge.call("stats", {})');
  checks.doudianContainerReinjectDiagnostics =
    doomedStats.ok === false &&
    doomedStats.detail === 'bridge_missing' &&
    doomedStats.reinjectAttempts >= 1 &&
    Array.isArray(doomedStats.targets) &&
    doomedStats.targets.length === 1 &&
    doomedStats.targets[0].bridgePresent === false &&
    doomedStats.targets[0].failures >= 1 &&
    doomedStats.targets[0].stale === true;

  // 3) 注入能力恢复后自动回到 ok（不重启容器）。
  await sleep(1600);
  await cwc.executeJavaScript('window.__fakeInjectFail = false; true', true);
  const recoveredPop = await evalAsync(cwc, 'window.__deskDoudianBridge.call("popPending", {})');
  checks.doudianContainerRecoversAfterInjectRestored = recoveredPop.uid === 'fake-uid';
  const recoveredStats = await evalAsync(cwc, 'window.__deskDoudianBridge.call("stats", {})');
  checks.doudianContainerRecoveredStatsOk = recoveredStats.ok === true && recoveredStats.collection === 'store';
}

async function injectDoudian(wc) {
  const source = fs.readFileSync(DOUDIAN_HOOK_PATH, 'utf8');
  await wc.executeJavaScript(source, true);
  return wc.executeJavaScript('(window.__DESK_DOUDIAN_VER) || 0', true);
}

app.whenReady().then(async () => {
  const checks = {};
  try {
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 720,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const url = pathToFileURL(FIXTURE).href + '?uid=demo-buyer';
    await win.loadURL(url);
    const wc = win.webContents;
    await wc.executeJavaScript('try { localStorage.clear(); } catch (e) {} true', true);

    checks.beforeInject = (await evalJson(wc, '((window.__pddWeb && window.__pddWeb.ver) || 0)')) === 0;
    checks.hookVersion = await injectHook(wc);
    checks.injected = checks.hookVersion > 0;
    checks.versionMarker = (await evalJson(wc, 'window.__PDD_WEB_VER || 0')) === checks.hookVersion;

    await sleep(1600);
    await wc.executeJavaScript('window.__pddWeb.scanNow && window.__pddWeb.scanNow()', true);
    await sleep(300);

    const state = await evalJson(
      wc,
      '({ stats: window.__pddWeb.stats(), selfTest: window.__pddWeb.selfTest(), lastError: window.__pddWeb.lastError })',
    );
    checks.lastError = state.lastError;
    checks.hasInput = state.selfTest.input === true;
    checks.hasSendButton = state.selfTest.sendButton === true;
    checks.panelFound = state.selfTest.panel === true;
    checks.domIngested = state.stats.ingested > 0;

    /* ---------------- DOM 采集 + 三表 ---------------- */
    const popped = await evalAsync(wc, 'window.__pddWeb.popPending()');
    checks.pendingUid = popped.uid || '';
    checks.pendingBuyerMessage = (popped.messages || []).some(
      (m) => m.from === 'buyer' && String(m.content).includes('针织衫'),
    );
    checks.pendingExcludesSeller = !(popped.messages || []).some((m) => m.from === 'seller');

    const released = await evalAsync(wc, `window.__pddWeb.releasePendingClaim(${JSON.stringify(popped.uid || '')})`);
    checks.released = released === true;
    const poppedAgain = await evalAsync(wc, 'window.__pddWeb.popPending()');
    checks.releaseRestoresRow = poppedAgain.uid === popped.uid && (poppedAgain.messages || []).length >= 1;
    // 归位，保持后续断言可重复
    if (poppedAgain.uid) await evalAsync(wc, `window.__pddWeb.releasePendingClaim(${JSON.stringify(poppedAgain.uid)})`);

    /* ---------------- WebSocket 帧采集 ---------------- */
    await wc.executeJavaScript('new WebSocket("ws://mock"); true', true);
    await wc.executeJavaScript(
      `window.__pushWsFrame({
        msg_id: 'ws-msg-1',
        from: { role: 'user', uid: 'ws-buyer' },
        to: { role: 'mall_cs' },
        ts: Math.floor(Date.now() / 1000),
        type: 1,
        content: 'WS 帧测试消息'
      }); true`,
      true,
    );
    await sleep(200);
    const snap = await evalAsync(wc, 'window.__pddWeb.pendingSnapshot()');
    checks.wsFramePending = !!snap['ws-buyer'];
    checks.wsFrameContent = checks.wsFramePending
      ? snap['ws-buyer'].messages.some((m) => String(m.content).includes('WS 帧测试消息'))
      : false;

    /* ---------------- 消息事件通道：drainEvents（与抖店同一语义） ---------------- */
    // 重复帧与系统消息都必须被事件通道过滤：不重复写、不写 system
    await wc.executeJavaScript(
      `window.__pushWsFrame({
        msg_id: 'ws-msg-1',
        from: { role: 'user', uid: 'ws-buyer' },
        to: { role: 'mall_cs' },
        ts: Math.floor(Date.now() / 1000),
        type: 1,
        content: 'WS 帧测试消息'
      });
      window.__pushWsFrame({
        msg_id: 'ws-sys-1',
        from: { role: 'system', uid: 'ws-buyer' },
        to: { role: 'mall_cs' },
        ts: Math.floor(Date.now() / 1000),
        type: 1,
        content: '系统提示：对方已转接'
      });
      true`,
      true,
    );
    await sleep(200);

    const ev1 = await evalAsync(wc, 'window.__pddWeb.drainEvents({ sinceSeq: 0 })');
    checks.pddEventsShape =
      ev1 && ev1.ok === true && typeof ev1.seq === 'number' && Array.isArray(ev1.events) && ev1.events.length > 0;
    checks.pddEventsBuyerDom =
      ev1.ok === true && ev1.events.some((e) => e.uid === 'demo-buyer' && e.from === 'buyer' && String(e.content).includes('针织衫'));
    checks.pddEventsSellerDom =
      ev1.ok === true && ev1.events.some((e) => e.uid === 'demo-buyer' && e.from === 'seller');
    checks.pddEventsWs = ev1.ok === true && ev1.events.some((e) => e.uid === 'ws-buyer' && String(e.content).includes('WS 帧测试消息'));
    checks.pddEventsFields =
      ev1.ok === true &&
      ev1.events.every(
        (e) =>
          typeof e.seq === 'number' &&
          ['buyer', 'seller'].includes(e.from) &&
          typeof e.uid === 'string' &&
          typeof e.type === 'string' &&
          typeof e.content === 'string' &&
          typeof e.ts === 'number' &&
          typeof e.msgId === 'string' &&
          typeof e.goodsTitle === 'string',
      );
    checks.pddEventsNoSystem = ev1.ok === true && !ev1.events.some((e) => e.msgId === 'ws-sys-1');
    checks.pddEventsDeduped =
      ev1.ok === true && ev1.events.filter((e) => e.msgId === 'ws-msg-1').length === 1;
    checks.pddEventsSeqMonotonic = ev1.ok === true && ev1.events.every((e, i) => i === 0 || e.seq > ev1.events[i - 1].seq);

    const pddCursor = ev1.ok && ev1.events.length ? ev1.events[ev1.events.length - 1].seq : 0;
    const pddEventsIncEmpty = await evalAsync(wc, `window.__pddWeb.drainEvents({ sinceSeq: ${pddCursor} })`);
    checks.pddEventsIncrementalEmpty =
      pddEventsIncEmpty.ok === true &&
      pddEventsIncEmpty.seq >= ev1.seq &&
      pddEventsIncEmpty.events.every((e) => e.seq > pddCursor);

    // drain 是只读的：不能动 pending / claim
    const pendingBeforeDrain = (await evalAsync(wc, 'window.__pddWeb.pendingSnapshot()')).count || 0;
    await evalAsync(wc, 'window.__pddWeb.drainEvents({ sinceSeq: 0 })');
    const pendingAfterDrain = (await evalAsync(wc, 'window.__pddWeb.pendingSnapshot()')).count || 0;
    checks.pddDrainKeepsPending = pendingAfterDrain === pendingBeforeDrain;

    const evDefault = await evalAsync(wc, 'window.__pddWeb.drainEvents()');
    checks.pddEventsDefaultCap = evDefault.ok === true && evDefault.events.length <= 200;

    /* ---------------- 发送失败枚举 ---------------- */
    await wc.executeJavaScript('document.getElementById("input").value = "占位"; true', true);
    const busy = await evalAsync(wc, 'window.__pddWeb.sendText("uid-demo", "不应发出")');
    checks.inputBusyReason = busy.reason === 'input_busy';
    await wc.executeJavaScript('document.getElementById("input").value = ""; true', true);

    await wc.executeJavaScript('document.getElementById("input").style.display = "none"; true', true);
    const noInput = await evalAsync(wc, 'window.__pddWeb.sendText("uid-demo", "不应发出")');
    checks.inputNotFoundReason = noInput.reason === 'input_not_found';
    await wc.executeJavaScript('document.getElementById("input").style.display = ""; true', true);

    await wc.executeJavaScript('window.__blockSend = true; true', true);
    const blocked = await evalAsync(wc, 'window.__pddWeb.sendText("uid-demo", "发送被拦住")');
    checks.sendUnconfirmedReason = blocked.reason === 'send_unconfirmed';
    await wc.executeJavaScript('window.__blockSend = false; document.getElementById("input").value = ""; true', true);

    /* ---------------- UI 注入发送成功 + self-send 去重 ---------------- */
    const sendText = '亲，有货的，今天下单今天发~';
    const sendRes = await evalAsync(wc, `window.__pddWeb.sendText("demo-buyer", ${JSON.stringify(sendText)})`);
    checks.sendOk = sendRes.ok === true;
    checks.sendMethod = sendRes.method || '';
    checks.sentInPage = await evalJson(wc, 'window.__sent || []');
    checks.sentRecorded = Array.isArray(checks.sentInPage) && checks.sentInPage.includes(sendText);
    await sleep(400);
    await wc.executeJavaScript('window.__pddWeb.scanNow()', true);
    const sentQueue = await evalAsync(wc, 'window.__pddWeb.popSent("demo-buyer")');
    checks.sentQueueLength = sentQueue.length;
    checks.selfSendDeduped =
      sentQueue.filter((m) => m.content === sendText).length === 1 &&
      sentQueue.every((m) => m.content !== sendText || m.from === 'seller');

    const evAfterSend = await evalAsync(wc, `window.__pddWeb.drainEvents({ sinceSeq: ${pddCursor} })`);
    checks.pddEventsSellerSend =
      evAfterSend.ok === true &&
      evAfterSend.events.some(
        (e) => e.from === 'seller' && e.uid === 'demo-buyer' && e.content === sendText && typeof e.msgId === 'string' && e.msgId.length > 0,
      );

    // 环形缓冲上限 500：独立 uid 灌 520 条 WS 帧，避免污染 demo-buyer 的 reload 断言
    await wc.executeJavaScript(
      `for (let i = 0; i < 520; i++) {
         window.__pushWsFrame({
           msg_id: 'evt-cap-' + i,
           from: { role: 'user', uid: 'evt-cap' },
           to: { role: 'mall_cs' },
           ts: Math.floor(Date.now() / 1000),
           type: 1,
           content: '事件缓冲上限 ' + i
         });
       }
       true`,
      true,
    );
    await sleep(300);
    const evCap = await evalAsync(wc, 'window.__pddWeb.drainEvents({ sinceSeq: 0 })');
    checks.pddEventsBufferCap =
      evCap.ok === true && evCap.events.length === 500 && evCap.seq >= 520 && evCap.events[0].seq < evCap.seq;

    /* ---------------- anti-content 只观测、TTL 6s ---------------- */
    await wc.executeJavaScript(
      'fetch("data:text/plain,ok", { headers: { "anti-content": "anti-desk-v1-test-1234567890" } }).catch(() => {})',
      true,
    );
    await sleep(150);
    const anti = await evalJson(wc, 'window.__pddWeb.anti()');
    checks.antiObserved = anti.value === 'anti-desk-v1-test-1234567890';
    checks.antiTtlMs = anti.ttlMs === 6000;

    /* ---------------- 持久化水位 ---------------- */
    const wm = await evalJson(wc, 'window.__pddWeb.watermark("demo-buyer")');
    checks.watermarkWritten = !!wm && wm.ids > 0;
    const statsBefore = await evalJson(wc, 'window.__pddWeb.stats()');
    checks.replayCountBeforeReload = statsBefore.replayed || 0;

    /* ---------------- reload：历史不重放 ---------------- */
    await win.loadURL(url);
    await sleep(200);
    checks.afterReloadVersion = await injectHook(wc);
    await sleep(1500);
    await wc.executeJavaScript('window.__pddWeb.scanNow()', true);
    await sleep(300);

    const wmAfter = await evalJson(wc, 'window.__pddWeb.watermark("demo-buyer")');
    checks.watermarkLoadedAfterReload = !!wmAfter && wmAfter.ids > 0;
    const pendingAfterReload = await evalAsync(wc, 'window.__pddWeb.pendingSnapshot()');
    checks.pendingAfterReloadEmpty = Object.keys(pendingAfterReload).length === 0;
    const statsAfter = await evalJson(wc, 'window.__pddWeb.stats()');
    checks.replayCountAfterReload = statsAfter.replayed || 0;
    checks.replayBlocked = checks.replayCountAfterReload > checks.replayCountBeforeReload;

    /* ---------------- reload 后新消息仍可采集 ---------------- */
    const fresh = '重载后的新消息，请回复';
    await wc.executeJavaScript(`window.__addBuyerMessage(${JSON.stringify(fresh)}); true`, true);
    await sleep(500);
    await wc.executeJavaScript('window.__pddWeb.scanNow()', true);
    await sleep(200);
    const freshRow = await evalAsync(wc, 'window.__pddWeb.popPending()');
    checks.freshAfterReloadUid = freshRow.uid || '';
    checks.freshAfterReloadCaptured =
      freshRow.uid === 'demo-buyer' && (freshRow.messages || []).some((m) => String(m.content).includes(fresh));
    if (freshRow.uid) await evalAsync(wc, `window.__pddWeb.releasePendingClaim(${JSON.stringify(freshRow.uid)})`);

    // reload 后事件 seq 从 1 重置；历史回放不写事件，只有新消息写
    const evReload = await evalAsync(wc, 'window.__pddWeb.drainEvents({ sinceSeq: 0 })');
    checks.pddEventsSeqResetAfterReload =
      evReload.ok === true && evReload.events.length >= 1 && evReload.events[0].seq === 1;
    checks.pddEventsFreshAfterReload =
      evReload.ok === true &&
      evReload.events.some((e) => e.uid === 'demo-buyer' && e.from === 'buyer' && String(e.content).includes(fresh));

    checks.selfTestAfterReload = await evalAsync(wc, 'window.__pddWeb.selfTest()');
    checks.inputAfterReload = checks.selfTestAfterReload.input === true;

    /* ---------------- 适配器端到端（Adapter Contract v1） ---------------- */
    const contract = require(path.join(__dirname, '..', 'src', 'shared', 'adapter-contract.js'));
    const platform = require(path.join(__dirname, '..', 'src', 'adapters'));
    const silent = { debug() {}, info() {}, warn() {}, error() {} };
    const store = { id: 'selftest-store', platform: 'pdd-web', storeName: 'selftest' };
    const adapter = platform.createAdapter(store, {
      logger: silent,
      config: { adapter: { hookGlobal: '__pddWeb' } },
      webContentsProvider: () => wc,
    });
    checks.adapterContractShape = contract.validateAdapter(adapter).ok === true;
    checks.adapterSupports = adapter.supports('pdd-web') === true && adapter.supports('other') === false;
    checks.adapterEntryUrl = platform.entryUrlFor(store) === 'https://mms.pinduoduo.com/chat-merchant/index.html';
    const adapterEnsure = await adapter.ensure();
    checks.adapterEnsure = adapterEnsure.ok === true;
    const adapterPrepare = await adapter.preparePending();
    checks.adapterPrepare = adapterPrepare.ok === true;

    const adapterSnap = await adapter.pendingSnapshot();
    checks.adapterSnapshot = adapterSnap.ok === true && adapterSnap.count >= 1 && adapterSnap.uids.includes('demo-buyer');
    const adapterPop = await adapter.popPending();
    checks.adapterPopRow = !!adapterPop && adapterPop.uid === 'demo-buyer' && Array.isArray(adapterPop.messages);
    const adapterSnapClaimed = await adapter.pendingSnapshot();
    checks.adapterClaimHidden = !adapterSnapClaimed.uids.includes('demo-buyer');
    const adapterRelease = await adapter.release(adapterPop.uid);
    checks.adapterRelease = adapterRelease.ok === true;
    const adapterPop2 = await adapter.popPending();
    checks.adapterReleaseRestores = !!adapterPop2 && adapterPop2.uid === adapterPop.uid;
    const adapterDiscard = await adapter.discard(adapterPop2.uid, { beforeTs: Date.now() + 60000 });
    const adapterSnapDiscarded = await adapter.pendingSnapshot();
    checks.adapterDiscard = adapterDiscard.ok === true && !adapterSnapDiscarded.uids.includes(adapterPop2.uid);

    const adapterHistory = await adapter.conversationHistory('demo-buyer', { limit: 10 });
    checks.adapterHistory = adapterHistory.ok === true && Array.isArray(adapterHistory.messages);
    const adapterFocus = await adapter.focusConversation('demo-buyer');
    checks.adapterFocus = adapterFocus.ok === true;
    const adapterAi = await adapter.syncAiEnabled(true);
    checks.adapterSyncAi = adapterAi.ok === true;

    const adapterSend = await adapter.sendText('demo-buyer', '适配器发送验证');
    checks.adapterSend = adapterSend.ok === true && typeof adapterSend.msgId === 'string' && adapterSend.msgId.length > 0;
    checks.adapterSendPassesContract = contract.assertResult(adapterSend, 'sendText').ok === true;
    const adapterSent = await adapter.popSent('demo-buyer');
    checks.adapterPopSent = adapterSent.ok === true && adapterSent.messages.length === 1;
    const merchantRows = await adapter.popMerchantSent();
    checks.adapterMerchantSent = Array.isArray(merchantRows) && merchantRows.every((r) => r.uid && r.message);
    checks.adapterMerchantSentShape =
      merchantRows.length === 0 ||
      merchantRows.every(
        (r) =>
          typeof r.message.msgId === 'string' &&
          ['buyer', 'seller', 'system'].includes(r.message.from) &&
          typeof r.message.ts === 'number',
      );

    const pddAdapterEvents = await adapter.drainEvents({ sinceSeq: 0 });
    checks.pddAdapterDrainEvents =
      pddAdapterEvents.ok === true &&
      typeof pddAdapterEvents.seq === 'number' &&
      pddAdapterEvents.events.some((e) => e.from === 'buyer' && e.uid === 'demo-buyer') &&
      pddAdapterEvents.events.some((e) => e.from === 'seller' && e.content === '适配器发送验证');
    const pddAdapterInc = await adapter.drainEvents({ sinceSeq: pddAdapterEvents.seq });
    checks.pddAdapterDrainIncremental =
      pddAdapterInc.ok === true && pddAdapterInc.seq >= pddAdapterEvents.seq && pddAdapterInc.events.length === 0;
    const pddAdapterDefault = await adapter.drainEvents();
    checks.pddAdapterDrainDefault = pddAdapterDefault.ok === true && pddAdapterDefault.events.length <= 200;

    let adapterInvalidThrew = false;
    try {
      await adapter.sendText('', 'x');
    } catch (e) {
      adapterInvalidThrew = e instanceof TypeError;
    }
    checks.adapterInvalidThrows = adapterInvalidThrew;
    let adapterMediaInvalidThrew = false;
    try {
      await adapter.sendImage('demo-buyer', {});
    } catch (e) {
      adapterMediaInvalidThrew = e instanceof TypeError;
    }
    checks.adapterMediaInvalidThrows = adapterMediaInvalidThrew;

    const deadAdapter = platform.createAdapter(store, {
      logger: silent,
      config: { adapter: { hookGlobal: '__pddWeb' } },
      webContentsProvider: () => null,
    });
    const deadEnsure = await deadAdapter.ensure();
    checks.adapterNotReady = deadEnsure.ok === false && deadEnsure.reason === 'hook_not_ready';
    let deadPopThrew = '';
    try {
      await deadAdapter.popPending();
    } catch (e) {
      deadPopThrew = e.reason || '';
    }
    checks.adapterPopThrowsWhenNotReady = deadPopThrew === 'hook_not_ready';
    const deadDrain = await deadAdapter.drainEvents({ sinceSeq: 0 });
    checks.pddAdapterDrainNotReady = deadDrain.ok === false && deadDrain.reason === 'hook_not_ready';

    /* ---------------- 抖店 + 闲鱼（第三阶段） ---------------- */
    await runDoudianSuite(checks);

    const doudianOk =
      checks.doudianBeforeInject &&
      checks.doudianInjected &&
      checks.doudianVersionMarker &&
      checks.doudianHasIm &&
      checks.doudianArmed &&
      checks.doudianDomIngested &&
      checks.doudianBridgeGlobal &&
      checks.doudianPendingBuyerMessage &&
      checks.doudianPendingExcludesSeller &&
      checks.doudianReleased &&
      checks.doudianReleaseRestores &&
      checks.doudianSendOk &&
      checks.doudianSendMethod === 'im.sendText' &&
      checks.doudianSendMsgId &&
      checks.doudianSendCalled &&
      checks.doudianSelfSendDeduped &&
      checks.doudianSendUnconfirmed &&
      checks.doudianWatermarkWritten &&
      checks.doudianWatermarkLoadedAfterReload &&
      checks.doudianPendingAfterReloadEmpty &&
      checks.doudianReplayBlocked &&
      checks.doudianFreshAfterReload &&
      checks.doudianAdapterShape &&
      checks.doudianAdapterAccessMode &&
      checks.doudianAdapterNoEntryUrl &&
      checks.doudianAdapterAccessModeFor &&
      checks.doudianAdapterEnsure &&
      checks.doudianAdapterPrepare &&
      checks.doudianAdapterSnapshot &&
      checks.doudianAdapterPopRow &&
      checks.doudianAdapterClaimHidden &&
      checks.doudianAdapterRelease &&
      checks.doudianAdapterReleaseRestores &&
      checks.doudianAdapterDiscard &&
      checks.doudianAdapterHistory &&
      checks.doudianAdapterFocus &&
      checks.doudianAdapterSyncAi &&
      checks.doudianAdapterSend &&
      checks.doudianAdapterSendPassesContract &&
      checks.doudianAdapterPopSent &&
      checks.doudianAdapterMerchantSent &&
      checks.doudianAdapterImageUnverified &&
      checks.doudianAdapterVideoUnsupported &&
      checks.doudianAdapterInvalidThrows &&
      checks.doudianAdapterNotReady &&
      checks.doudianAdapterPopThrowsWhenNotReady &&
      checks.xianyuAdapterShape &&
      checks.xianyuAccessModeWebview &&
      checks.xianyuEntryUrl &&
      checks.xianyuSupports &&
      checks.xianyuSellerNotImplemented &&
      checks.xianyuHookNotReady &&
      checks.doudianContainerMode &&
      checks.doudianContainerEnsure &&
      checks.doudianContainerEnsureCollectionFallback &&
      checks.doudianContainerStatsOk &&
      checks.doudianContainerSelfTestOk &&
      checks.doudianContainerScanNowOk &&
      checks.doudianContainerRoute &&
      checks.doudianContainerInjected &&
      checks.doudianPageDomFallbackEnsure &&
      checks.doudianPageDomFallbackCollection &&
      checks.doudianContainerStatsNoWebviewStoreOk &&
      checks.doudianContainerEnsureNoWebviewStoreOk &&
      checks.doudianContainerScanNowNoWebview &&
      checks.doudianContainerAdapterEnsureNoWebview &&
      checks.doudianContainerAdapterStatsOk &&
      checks.doudianContainerAdapterScanOk &&
      checks.doudianContainerSelfHealPop &&
      checks.doudianContainerSelfHealStats &&
      checks.doudianContainerSelfHealInjects &&
      checks.doudianContainerReinjectFails &&
      checks.doudianContainerReinjectDiagnostics &&
      checks.doudianContainerRecoversAfterInjectRestored &&
      checks.doudianContainerRecoveredStatsOk;

    const ok =
      checks.beforeInject &&
      checks.injected &&
      checks.versionMarker &&
      checks.hasInput &&
      checks.hasSendButton &&
      checks.panelFound &&
      checks.domIngested &&
      checks.pendingBuyerMessage &&
      checks.pendingExcludesSeller &&
      checks.released &&
      checks.releaseRestoresRow &&
      checks.wsFramePending &&
      checks.wsFrameContent &&
      checks.inputBusyReason &&
      checks.inputNotFoundReason &&
      checks.sendUnconfirmedReason &&
      checks.sendOk &&
      checks.sendMethod === 'ui' &&
      checks.sentRecorded &&
      checks.selfSendDeduped &&
      checks.antiObserved &&
      checks.antiTtlMs &&
      checks.watermarkWritten &&
      checks.watermarkLoadedAfterReload &&
      checks.pendingAfterReloadEmpty &&
      checks.replayBlocked &&
      checks.freshAfterReloadCaptured &&
      checks.inputAfterReload &&
      checks.adapterContractShape &&
      checks.adapterSupports &&
      checks.adapterEntryUrl &&
      checks.adapterEnsure &&
      checks.adapterPrepare &&
      checks.adapterSnapshot &&
      checks.adapterPopRow &&
      checks.adapterClaimHidden &&
      checks.adapterRelease &&
      checks.adapterReleaseRestores &&
      checks.adapterDiscard &&
      checks.adapterHistory &&
      checks.adapterFocus &&
      checks.adapterSyncAi &&
      checks.adapterSend &&
      checks.adapterSendPassesContract &&
      checks.adapterPopSent &&
      checks.adapterMerchantSent &&
      checks.adapterMerchantSentShape &&
      checks.adapterInvalidThrows &&
      checks.adapterMediaInvalidThrows &&
      checks.adapterNotReady &&
      checks.adapterPopThrowsWhenNotReady &&
      checks.pddEventsShape &&
      checks.pddEventsBuyerDom &&
      checks.pddEventsSellerDom &&
      checks.pddEventsWs &&
      checks.pddEventsFields &&
      checks.pddEventsNoSystem &&
      checks.pddEventsDeduped &&
      checks.pddEventsSeqMonotonic &&
      checks.pddEventsIncrementalEmpty &&
      checks.pddDrainKeepsPending &&
      checks.pddEventsDefaultCap &&
      checks.pddEventsSellerSend &&
      checks.pddEventsBufferCap &&
      checks.pddEventsSeqResetAfterReload &&
      checks.pddEventsFreshAfterReload &&
      checks.pddAdapterDrainEvents &&
      checks.pddAdapterDrainIncremental &&
      checks.pddAdapterDrainDefault &&
      checks.pddAdapterDrainNotReady &&
      doudianOk;

    done({ ok, hookVersion: checks.hookVersion, checks }, ok ? 0 : 1);
  } catch (e) {
    done({ ok: false, error: String((e && e.stack) || e), checks }, 1);
  }
});

app.on('window-all-closed', () => app.exit(0));
