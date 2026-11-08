/* eslint-disable */
/**
 * desk-v1 · pdd-web 页面 hook v1
 * 注入目标：mms.pinduoduo.com/chat-merchant（拼多多商家聊天页）
 *
 * 设计原则（继承既有实现的已验证结论，修掉「页面重载重放历史」缺陷）：
 *  1) 不逆向任何平台签名。发送主通道是页面 UI 注入（写输入框 + 点发送 / 回车），
 *     anti-content 只做「观测 + 最近 6 秒缓存」，用于诊断与页面上下文内的降级请求。
 *  2) 采集双源：WebSocket 帧解析（结构化）+ DOM 兜底扫描（最可靠）。
 *  3) 队列三表：pendingByUid（待消费）/ sentByUid（卖家已发）/ claimedRows（已取走未确认）。
 *     取走失败可归还（releasePendingClaim），成功 discardClaim。
 *  4) self-send 8 秒 TTL：自己发出的文本回环成买家消息时丢弃。
 *  5) 持久化水位（本版新增）：按 uid 保存 {maxTs, 最近 msgId 集合} 到 localStorage。
 *     页面重载后，DOM/store 里的历史消息命中水位直接丢弃，不再整体重放进 pending。
 *  6) 任何异常只写 lastError，不抛到页面执行栈。
 *  7) 只读事件通道 drainEvents：环形缓冲 500 条、eventSeq 单调递增，
 *     与抖店 bridge 同语义（system/重复/回放/self-echo 不入），供消息监控实时打日志。
 *
 * 对外对象：window.__pddWeb
 * 版本标记：window.__PDD_WEB_VER = VER
 */
(function () {
  'use strict';

  var VER = 2;
  window.__PDD_WEB_VER = VER;

  var PREV = window.__pddWeb;
  if (PREV && PREV.ver === VER) return;
  if (PREV && typeof PREV.dispose === 'function') {
    try {
      PREV.dispose();
    } catch (e) {}
  }

  var LOG_PREFIX = '%c[PDD-WEB]';
  var LOG_STYLE = 'color:#00a6ff;font-weight:600';
  var CONF = {
    antiTtlMs: 6000,
    selfSendTtlMs: 8000,
    textDedupeMs: 180000,
    crossDedupeMs: 20000,
    replaySlackMs: 60000,
    bootstrapGraceMs: 60000,
    seenMax: 2000,
    watermarkMaxIds: 300,
    eventsMax: 500,
    eventsReturnMax: 200,
    pollMs: 1200,
    scanThrottleMs: 800,
    sendConfirmMs: 2000,
    mediaConfirmMs: 5000,
    pendingTailMax: 30,
    sentTailMax: 50,
    merchantSentMax: 200,
  };
  var WM_KEY = '__pdd_web_hook_watermark_v1';

  var state = {
    ver: VER,
    activeUid: '',
    selfUid: '',
    storeOk: false,
    convCache: [],
    events: [],
    eventSeq: 0,
    pendingByUid: new Map(),
    claimedRows: new Map(),
    sentByUid: new Map(),
    merchantSent: [],
    seen: new Map(),
    seenText: new Map(),
    seenTextAny: new Map(),
    csReplies: new Map(),
    selfSends: [],
    lastEcho: null,
    watermarks: new Map(),
    wmPersistTimer: null,
    anti: { value: '', at: 0, path: '' },
    sockets: [],
    aiEnabled: true,
    eventHandlers: [],
    logs: [],
    timers: [],
    lastError: '',
    bootAt: Date.now(),
    stats: {
      frames: 0,
      ingested: 0,
      watermarked: 0,
      replayed: 0,
      domScans: 0,
      domNodes: 0,
      domLeaf: 0,
      domSeen: 0,
      domNoUid: 0,
      storeHits: 0,
      storeMiss: 0,
      storeConvs: 0,
      storeMsgs: 0,
      bubbleNodes: 0,
      sends: 0,
      startedAt: Date.now(),
    },
  };

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      var line = args.map(function (a) { return String(a); }).join(' ');
      state.logs.push(line);
      if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
      args.unshift(LOG_PREFIX, LOG_STYLE);
      console.log.apply(console, args);
    } catch (e) {}
  }

  function warn() {
    try {
      var args = Array.prototype.slice.call(arguments);
      var line = args.map(function (a) { return String(a); }).join(' ');
      state.logs.push('WARN ' + line);
      if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
      args.unshift('%c[PDD-WEB]', 'color:#ff9f0a;font-weight:600');
      console.warn.apply(console, args);
    } catch (e) {}
  }

  function fail(where, err) {
    var msg = (err && (err.stack || err.message)) || String(err);
    state.lastError = where + ': ' + msg;
    warn(where, msg);
  }

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */
  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }
  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function hash32(str) {
    var h = 5381;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function trimStr(v, max) {
    var s = String(v == null ? '' : v).trim();
    return max ? s.slice(0, max) : s;
  }
  function emptyRow() {
    return { uid: '', username: '', goodsTitle: '', orderId: '', orderStatus: '', messages: [] };
  }
  function addTimer(fn, ms) {
    var t = setInterval(fn, ms);
    state.timers.push(t);
    return t;
  }
  function emit(kind, data) {
    try {
      window.postMessage({ __pddWeb: 1, kind: kind, data: data }, '*');
    } catch (e) {}
    for (var i = 0; i < state.eventHandlers.length; i++) {
      try {
        state.eventHandlers[i]({ kind: kind, data: data });
      } catch (e) {
        fail('emit.handler', e);
      }
    }
  }
  function markSeen(key) {
    if (!key) return false;
    if (state.seen.has(key)) return true;
    state.seen.set(key, Date.now());
    if (state.seen.size > CONF.seenMax) {
      var drop = state.seen.size - CONF.seenMax;
      var it = state.seen.keys();
      while (drop-- > 0) {
        var k = it.next();
        if (k.done) break;
        state.seen.delete(k.value);
      }
    }
    return false;
  }
  function trimMap(map) {
    if (map.size <= CONF.seenMax) return;
    var drop = map.size - CONF.seenMax;
    var it = map.keys();
    while (drop-- > 0) {
      var k = it.next();
      if (k.done) break;
      map.delete(k.value);
    }
  }

  /* ------------------------------------------------------------------ *
   * 持久化水位：按 uid 记住「已处理到这里」
   * ------------------------------------------------------------------ */
  function wmStorage() {
    try {
      if (window.localStorage) return window.localStorage;
    } catch (e) {}
    try {
      if (window.sessionStorage) return window.sessionStorage;
    } catch (e2) {}
    return null;
  }
  function loadWatermarks() {
    var st = wmStorage();
    if (!st) return;
    try {
      var raw = st.getItem(WM_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var uids = data && data.uids;
      if (!uids || typeof uids !== 'object') return;
      Object.keys(uids).forEach(function (uid) {
        var v = uids[uid];
        if (!v) return;
        state.watermarks.set(uid, {
          ts: Number(v.ts) || 0,
          ids: Array.isArray(v.ids) ? v.ids.slice(-CONF.watermarkMaxIds) : [],
          at: Number(v.at) || 0,
        });
      });
    } catch (e) {
      fail('loadWatermarks', e);
    }
  }
  function scheduleWmPersist() {
    if (state.wmPersistTimer) return;
    state.wmPersistTimer = setTimeout(function () {
      state.wmPersistTimer = null;
      var st = wmStorage();
      if (!st) return;
      try {
        var uids = {};
        state.watermarks.forEach(function (wm, uid) {
          uids[uid] = { ts: wm.ts, ids: wm.ids.slice(-CONF.watermarkMaxIds), at: wm.at };
        });
        st.setItem(WM_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), uids: uids }));
      } catch (e) {
        fail('persistWatermarks', e);
      }
    }, 250);
  }
  function noteWatermark(uid, m) {
    if (!uid || !m) return;
    var wm = state.watermarks.get(uid);
    if (!wm) {
      wm = { ts: 0, ids: [], at: 0 };
      state.watermarks.set(uid, wm);
    }
    if (m.ts && m.ts > wm.ts) wm.ts = m.ts;
    if (m.msgId && wm.ids.indexOf(m.msgId) < 0) {
      wm.ids.push(m.msgId);
      if (wm.ids.length > CONF.watermarkMaxIds) wm.ids = wm.ids.slice(-CONF.watermarkMaxIds);
    }
    wm.at = Date.now();
    state.stats.watermarked++;
    scheduleWmPersist();
  }
  function isReplayByWatermark(uid, m) {
    var wm = state.watermarks.get(uid);
    if (!wm) return false;
    if (m.msgId && wm.ids.indexOf(m.msgId) >= 0) return true;
    // 没有时间的历史 DOM 一律视为旧消息
    if (!m.ts) return true;
    // 明显早于水位的，视为历史回放（留 60s 容忍时钟偏差/乱序）
    if (wm.ts && m.ts < wm.ts - CONF.replaySlackMs) return true;
    return false;
  }
  function isBootstrapHistory(uid, m) {
    // 首次注入（没有该 uid 的水位）时，只收「最近的新消息」；
    // 明显早于本次注入时间的 DOM/store 历史只用来打水位，不进 pending。
    if (state.watermarks.has(uid)) return false;
    if (!m.ts) return true;
    return m.ts < state.bootAt - CONF.bootstrapGraceMs;
  }
  function absorb(uid, m) {
    markSeen(m.msgId);
    noteWatermark(uid, m);
  }

  /* ------------------------------------------------------------------ *
   * self-send 8s TTL
   * ------------------------------------------------------------------ */
  function noteSelfSend(uid, content) {
    var now = Date.now();
    state.selfSends = state.selfSends.filter(function (r) {
      return now - r.ts < CONF.selfSendTtlMs;
    });
    state.selfSends.push({ uid: normUid(uid || ''), text: trimStr(content, 500), ts: now });
    if (state.selfSends.length > 50) state.selfSends = state.selfSends.slice(-50);
  }
  function isSelfEcho(uid, m) {
    if (!m || !m.content) return false;
    var now = Date.now();
    state.selfSends = state.selfSends.filter(function (r) {
      return now - r.ts < CONF.selfSendTtlMs;
    });
    var text = trimStr(m.content, 500);
    var key = normUid(uid || '');
    for (var i = state.selfSends.length - 1; i >= 0; i--) {
      var r = state.selfSends[i];
      if (r.text !== text) continue;
      if (r.uid && key && r.uid !== key) continue;
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 方向 / 类型判定
   * ------------------------------------------------------------------ */
  function roleToFrom(role) {
    var r = trimStr(role).toLowerCase();
    if (!r) return '';
    if (/mall|merchant|seller|shop|cs|kefu|客服|商家/.test(r)) return 'seller';
    if (/user|buyer|consumer|买家|顾客|customer/.test(r)) return 'buyer';
    if (/system|notice|系统/.test(r)) return 'system';
    return '';
  }
  function typeFromNumber(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    // 拼多多 WS 消息类型：1 文本、2/8 图片、3 视频、4/5 商品订单卡、6 语音、7 表情
    if (n === 1) return 'text';
    if (n === 2 || n === 8) return 'image';
    if (n === 3) return 'video';
    if (n === 4 || n === 5) return 'card';
    if (n === 6) return 'unknown';
    if (n === 7) return 'text';
    return '';
  }
  function typeFromContent(text) {
    var s = trimStr(text);
    if (!s) return 'unknown';
    if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif|bmp)(\?\S*)?$/i.test(s)) return 'image';
    if (/^https?:\/\/\S+\.(mp4|mov|m3u8)(\?\S*)?$/i.test(s)) return 'video';
    return 'text';
  }
  function extractContent(node) {
    var c = node.content;
    if (c === undefined) c = node.message;
    if (c === undefined) c = node.msg;
    if (c === undefined) c = node.data;
    if (c && typeof c === 'object') {
      var url = c.url || c.image_url || c.img_url || c.imageUrl || c.video_url;
      if (url) return { type: typeFromContent(url), content: String(url) };
      if (c.text != null) return { type: 'text', content: trimStr(c.text) };
      if (c.title || c.goods_name || c.goodsName)
        return { type: 'card', content: trimStr(c.title || c.goods_name || c.goodsName) };
      return { type: 'unknown', content: '' };
    }
    var s = trimStr(c);
    var declared = typeFromNumber(node.type !== undefined ? node.type : node.msg_type);
    var guessed = typeFromContent(s);
    return { type: declared && declared !== 'text' ? declared : guessed, content: s };
  }

  function normalizeNode(node) {
    if (!node || typeof node !== 'object') return null;
    var from = node.from || node.sender || {};
    var to = node.to || node.receiver || {};
    var fromUid = trimStr(from.uid || node.from_uid || node.uid || '');
    var toUid = trimStr(to.uid || node.to_uid || node.uid || '');
    var dir = roleToFrom(from.role || from.type || node.role || node.send_type);
    if (!dir) {
      if (state.selfUid && fromUid && fromUid === state.selfUid) dir = 'seller';
      else if (node.manual_reply === 1 || node.is_aut === 0) dir = 'seller';
      else dir = 'buyer';
    }
    var uid = dir === 'seller' ? toUid : fromUid;
    if (!uid) uid = toUid || fromUid || state.activeUid || '';
    var body = extractContent(node);
    var tsRaw = node.ts !== undefined ? node.ts : node.time !== undefined ? node.time : node.create_time;
    var ts = Number(tsRaw);
    if (!isFinite(ts) || ts <= 0) ts = 0;
    if (ts > 0 && ts < 1e12) ts = ts * 1000;
    var msgId = trimStr(node.msg_id || node.msgId || node.message_id || node.id || '');
    if (!msgId) msgId = 'h-' + hash32(uid + '|' + ts + '|' + body.content);
    return {
      uid: uid,
      from: dir,
      message: {
        msgId: msgId,
        from: dir === 'system' ? 'system' : dir,
        type: body.type,
        content: body.content,
        ts: ts,
        goodsId: trimStr(node.goods_id || node.goodsId || ''),
        goodsTitle: trimStr(node.goods_name || node.goodsName || node.goods_title || ''),
        orderId: trimStr(node.order_id || node.orderId || ''),
      },
      username: trimStr(node.username || node.user_name || node.nickname || node.buyer_name || ''),
      goodsTitle: trimStr(node.goods_name || node.goodsName || node.goods_title || ''),
      orderId: trimStr(node.order_id || node.orderId || ''),
      orderStatus: trimStr(node.order_status || node.orderStatus || ''),
    };
  }

  var MSG_ID_KEYS = ['msg_id', 'msgId', 'message_id'];
  var BODY_KEYS = ['content', 'message', 'msg', 'data'];
  function looksLikeMessage(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var hasId = false;
    for (var i = 0; i < MSG_ID_KEYS.length; i++) if (o[MSG_ID_KEYS[i]] !== undefined) hasId = true;
    var hasBody = false;
    for (var j = 0; j < BODY_KEYS.length; j++) if (o[BODY_KEYS[j]] !== undefined) hasBody = true;
    var hasFrom = o.from !== undefined || o.sender !== undefined || o.role !== undefined || o.send_type !== undefined;
    return (hasId && hasBody) || (hasBody && hasFrom);
  }

  function collectMessages(payload) {
    var queue = [payload];
    var visited = 0;
    while (queue.length && visited < 4000) {
      var cur = queue.shift();
      visited++;
      if (!cur || typeof cur !== 'object') continue;
      if (looksLikeMessage(cur)) {
        try {
          var norm = normalizeNode(cur);
          if (norm && norm.message.content) ingestMessage(norm);
        } catch (e) {
          fail('collectMessages.normalize', e);
        }
      }
      var keys = Object.keys(cur);
      for (var i = 0; i < keys.length; i++) {
        var v = cur[keys[i]];
        if (v && typeof v === 'object') queue.push(v);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 采集入库
   * ------------------------------------------------------------------ */
  function rowFor(uid) {
    var row = state.pendingByUid.get(uid);
    if (row) return row;
    row = emptyRow();
    row.uid = uid;
    row.firstAt = Date.now();
    state.pendingByUid.set(uid, row);
    return row;
  }

  /**
   * 把一条「真正新进的消息」写入只读事件环形缓冲。
   * 与抖店 bridge 的事件通道语义一致：
   *  - 只有通过水位/去重/self-echo 检查、且已入队（或已计入发送台账）的消息才写入；
   *  - 系统消息、重复消息、reload 历史回放、self-echo 一律不写；
   *  - content 保留原文，最长 2000 字符；
   *  - 只读出口，不清 pending、不影响 claim/sent。
   * 页面 reload 后由新注入的 state 从 seq=1 重新开始。
   */
  function pushEvent(uid, username, m, goodsTitle) {
    if (!uid || !m) return null;
    state.eventSeq += 1;
    var content = m.content == null ? '' : String(m.content);
    var ev = {
      seq: state.eventSeq,
      uid: String(uid),
      username: trimStr(username),
      from: m.from === 'seller' ? 'seller' : 'buyer',
      type: m.type || 'text',
      content: content.length > 2000 ? content.slice(0, 2000) : content,
      msgId: m.msgId || '',
      ts: Number(m.ts) || Date.now(),
      goodsTitle: trimStr(goodsTitle || m.goodsTitle),
    };
    state.events.push(ev);
    if (state.events.length > CONF.eventsMax) {
      state.events.splice(0, state.events.length - CONF.eventsMax);
    }
    return ev;
  }

  function ingestMessage(norm) {
    if (!norm) return;
    var uid = norm.uid;
    if (!uid) return;
    var m = norm.message;
    if (!m || !m.content) return;

    // 系统提示不进入待回复队列
    if (m.from === 'system') {
      absorb(uid, m);
      return;
    }
    // 持久化水位：页面重载后历史消息在这里被拦住
    if (isReplayByWatermark(uid, m)) {
      state.stats.replayed++;
      absorb(uid, m);
      return;
    }
    // 首次注入时的历史基线（只打水位，不入队）
    if (isBootstrapHistory(uid, m)) {
      absorb(uid, m);
      return;
    }
    // self-send 回环
    if (isSelfEcho(uid, m)) {
      state.lastEcho = { uid: uid, text: trimStr(m.content, 500), at: Date.now() };
      absorb(uid, m);
      return;
    }
    if (markSeen(m.msgId)) {
      noteWatermark(uid, m);
      return;
    }

    // 跨通道去重：同一条消息在 store 与 DOM 里的 id 体系不同，用文本指纹兜底
    var tkey = uid + '|' + m.from + '|' + trimStr(m.content, 200);
    var seenAt = state.seenText.get(tkey);
    if (seenAt && Date.now() - seenAt < CONF.textDedupeMs) {
      noteWatermark(uid, m);
      return;
    }
    // 跨通道同文去重：同一句话在 store 与 DOM 里 from 可能判得不一样，20 秒内只留先到的一条
    var anyKey = uid + '|' + trimStr(m.content, 200);
    var prevAny = state.seenTextAny.get(anyKey);
    if (prevAny && prevAny.from !== m.from && Date.now() - prevAny.ts < CONF.crossDedupeMs) {
      noteWatermark(uid, m);
      return;
    }
    state.seenTextAny.set(anyKey, { ts: Date.now(), from: m.from });
    trimMap(state.seenTextAny);
    state.seenText.set(tkey, Date.now());
    trimMap(state.seenText);
    state.stats.ingested++;

    var row;
    if (m.from === 'seller') {
      var list = state.sentByUid.get(uid) || [];
      list.push(m);
      if (list.length > CONF.sentTailMax) list = list.slice(-CONF.sentTailMax);
      state.sentByUid.set(uid, list);
      state.merchantSent.push({ uid: uid, message: m, ts: Date.now() });
      if (state.merchantSent.length > CONF.merchantSentMax)
        state.merchantSent.splice(0, state.merchantSent.length - CONF.merchantSentMax);
      state.csReplies.set(uid, Date.now());
      row = state.pendingByUid.get(uid);
      if (row) row.selfRepliedAt = Date.now();
      noteWatermark(uid, m);
      pushEvent(uid, norm.username, m, norm.goodsTitle);
      emit('message', { uid: uid, message: m });
      return;
    }

    row = rowFor(uid);
    if (norm.username) row.username = norm.username;
    if (norm.goodsTitle) row.goodsTitle = norm.goodsTitle;
    if (norm.orderId) row.orderId = norm.orderId;
    if (norm.orderStatus) row.orderStatus = norm.orderStatus;
    if (m.goodsTitle && !row.goodsTitle) row.goodsTitle = m.goodsTitle;
    if (m.orderId && !row.orderId) row.orderId = m.orderId;
    row.messages.push(m);
    if (row.messages.length > CONF.pendingTailMax) row.messages = row.messages.slice(-CONF.pendingTailMax);
    row.lastAt = Date.now();
    noteWatermark(uid, m);
    pushEvent(uid, row.username, m, row.goodsTitle);
    emit('message', { uid: uid, message: m, username: row.username });
  }

  function pushSent(uid, message) {
    var u = uid || state.activeUid || '';
    if (!u) return;
    noteSelfSend(u, message.content);
    var list = state.sentByUid.get(u) || [];
    var dup = false;
    for (var i = list.length - 1; i >= 0; i--) {
      if (
        list[i].from === message.from &&
        trimStr(list[i].content, 500) === trimStr(message.content, 500) &&
        Math.abs((list[i].ts || 0) - (message.ts || 0)) < CONF.selfSendTtlMs
      ) {
        dup = true;
        break;
      }
    }
    if (!dup) list.push(message);
    if (list.length > CONF.sentTailMax) list = list.slice(-CONF.sentTailMax);
    state.sentByUid.set(u, list);
    state.merchantSent.push({ uid: u, message: message, ts: Date.now() });
    if (state.merchantSent.length > CONF.merchantSentMax)
      state.merchantSent.splice(0, state.merchantSent.length - CONF.merchantSentMax);
    state.csReplies.set(u, Date.now());
    noteWatermark(u, message);
    var row = state.pendingByUid.get(u);
    pushEvent(u, row ? row.username : '', message, row ? row.goodsTitle : '');
  }

  /* ------------------------------------------------------------------ *
   * WebSocket 帧采集
   * ------------------------------------------------------------------ */
  function decodeFrame(data) {
    try {
      if (typeof data === 'string') return data;
      if (data instanceof ArrayBuffer) return new TextDecoder('utf-8', { fatal: false }).decode(data);
      if (data && typeof data === 'object' && typeof data.text === 'function') return ''; // Blob 异步，跳过
      return '';
    } catch (e) {
      return '';
    }
  }

  function ingestFrame(data) {
    var text = decodeFrame(data);
    if (!text || text.length > 800000) return;
    state.stats.frames++;
    var payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      return;
    }
    try {
      collectMessages(payload);
    } catch (e) {
      fail('ingestFrame', e);
    }
  }

  function hookSockets() {
    var NativeWS = window.WebSocket;
    if (!NativeWS || NativeWS.__pddWebWrapped) return;
    function HookedWebSocket(url, protocols) {
      var ws = arguments.length > 1 ? new NativeWS(url, protocols) : new NativeWS(url);
      try {
        if (!ws.__pddWebHooked) {
          ws.__pddWebHooked = true;
          state.sockets.push(ws);
          if (state.sockets.length > 8) state.sockets.splice(0, state.sockets.length - 8);
          ws.addEventListener('message', function (ev) {
            ingestFrame(ev && ev.data);
          });
        }
      } catch (e) {
        fail('hookSockets.attach', e);
      }
      return ws;
    }
    HookedWebSocket.prototype = NativeWS.prototype;
    try {
      HookedWebSocket.CONNECTING = NativeWS.CONNECTING;
      HookedWebSocket.OPEN = NativeWS.OPEN;
      HookedWebSocket.CLOSING = NativeWS.CLOSING;
      HookedWebSocket.CLOSED = NativeWS.CLOSED;
    } catch (e) {}
    HookedWebSocket.__pddWebWrapped = true;
    try {
      window.WebSocket = HookedWebSocket;
      log('WebSocket 已接管');
    } catch (e) {
      fail('hookSockets.replace', e);
    }
  }

  /* ------------------------------------------------------------------ *
   * anti-content 观测：只缓存 6 秒，不生成、不复刻签名
   * ------------------------------------------------------------------ */
  function rememberAnti(value, path) {
    var v = trimStr(value);
    if (!v || v.length < 8) return;
    state.anti = { value: v, at: Date.now(), path: trimStr(path || '') };
  }
  function pickAnti() {
    // 页面自身风控对象存在时，只读它当前产出的值（仍不伪造）
    try {
      var store = storeOf();
      var rc = window.riskControlCrawler || (store && store.state && store.state.riskControlCrawler);
      if (rc) {
        if (!state.anti.value && typeof rc.messagePack === 'function') {
          var packed = trimStr(rc.messagePack());
          if (packed && packed.length >= 8) {
            state.anti = { value: packed, at: Date.now(), path: 'riskControlCrawler.messagePack' };
          }
        }
      }
    } catch (e) {
      fail('pickAnti.crawler', e);
    }
    if (!state.anti.value) return '';
    if (Date.now() - state.anti.at > CONF.antiTtlMs) return '';
    return state.anti.value;
  }
  function headersGet(headers, name) {
    try {
      if (!headers) return '';
      if (typeof headers.get === 'function') return headers.get(name) || '';
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === name) return headers[i][1];
        }
        return '';
      }
      var keys = Object.keys(headers);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === name) return headers[keys[j]];
      }
    } catch (e) {}
    return '';
  }
  function hookNetwork() {
    var nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function' && !nativeFetch.__pddWebWrapped) {
      var wrapped = function (input, init) {
        try {
          var h = init && init.headers;
          var anti = headersGet(h, 'anti-content');
          if (anti) rememberAnti(anti, typeof input === 'string' ? input : (input && input.url) || '');
        } catch (e) {}
        return nativeFetch.apply(this, arguments);
      };
      wrapped.__pddWebWrapped = true;
      try {
        window.fetch = wrapped;
      } catch (e) {
        fail('hookNetwork.fetch', e);
      }
    }
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype && !XHR.prototype.__pddWebWrapped) {
      var nativeSet = XHR.prototype.setRequestHeader;
      var nativeOpen = XHR.prototype.open;
      XHR.prototype.open = function (method, url) {
        try {
          this.__pddWebUrl = url;
        } catch (e) {}
        return nativeOpen.apply(this, arguments);
      };
      XHR.prototype.setRequestHeader = function (name, value) {
        try {
          if (String(name).toLowerCase() === 'anti-content') rememberAnti(value, this.__pddWebUrl || '');
        } catch (e) {}
        return nativeSet.apply(this, arguments);
      };
      XHR.prototype.__pddWebWrapped = true;
    }
  }

  /* ------------------------------------------------------------------ *
   * DOM 兜底采集
   * ------------------------------------------------------------------ */
  var PANEL_SELECTORS = [
    '[class*="chatMessage"]',
    '[class*="messageList"]',
    '[class*="message-list"]',
    '[class*="chatContent"]',
    '[class*="chat-content"]',
    '[class*="conversationDetail"]',
    '[class*="chatWrap"]',
    '[class*="chat-container"]',
    '#chat-container',
  ];
  var NODE_SELECTORS = '[class*="bubble"],[class*="msg"],[class*="message"],[class*="text"]';
  var SYSTEM_RE = /^(\d{1,2}:\d{2}|昨天|今天|前天|星期|系统提示|对方正在输入|已读|未读|查看更多|转接)/;

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }
  function findPanel() {
    for (var i = 0; i < PANEL_SELECTORS.length; i++) {
      var els = document.querySelectorAll(PANEL_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) if (visible(els[j])) return els[j];
    }
    return null;
  }
  function resolveActiveUid() {
    try {
      var store = storeOf();
      var sel = store && store.state && store.state.selectingChatUid;
      if (sel) return normUid(sel);
      var u = new URL(location.href);
      var keys = ['uid', 'uid_enc', 'to_uid', 'targetUid'];
      for (var i = 0; i < keys.length; i++) {
        var v = u.searchParams.get(keys[i]);
        if (v) return trimStr(v);
      }
      var cur = store && store.state && store.state.currentUserInfo;
      if (cur && cur.userInfo && cur.userInfo.uid) return normUid(cur.userInfo.uid);
      var box = document.querySelector(
        '.chat-item-box[data-random].active,.chat-item-box[data-random].selected,.chat-item-box[data-random][class*="active"]',
      );
      if (box) {
        var dr = box.getAttribute('data-random');
        if (dr) return trimStr(String(dr).split('-')[0]);
      }
    } catch (e) {}
    return state.activeUid || '';
  }

  /* ------------------------------------------------------------------ *
   * 原生采集：Vuex store
   * ------------------------------------------------------------------ */
  function storeOf() {
    try {
      var app = document.querySelector('#app');
      var vm = app && app.__vue__;
      return (vm && vm.$store) || null;
    } catch (e) {
      return null;
    }
  }
  function normUid(u) {
    return String(u == null ? '' : u)
      .trim()
      .replace(/-\d+-reply$/, '')
      .replace(/-0-all$/, '');
  }
  function convMarked(conv) {
    return !!(conv && (conv.markType || conv.unreply || conv.unreplyTime));
  }
  function pushConv(map, conv) {
    if (!conv || !conv.userInfo || !conv.userInfo.uid) return;
    var key = normUid(conv.userInfo.uid);
    if (!key) return;
    var old = map.get(key);
    if (!old || (convMarked(conv) && !convMarked(old))) map.set(key, conv);
  }
  function conversationsOf(store) {
    var out = new Map();
    var f = store.getters && store.getters['l/todayChatFilter'];
    if (f && typeof f === 'object') {
      var groups = [f.fiveMinutesList, f.timeoutReplyList, f.nightUnreplyList, f.alreadyReplyNeedReplyList, f.isArgueList];
      for (var i = 0; i < groups.length; i++) {
        var arr = groups[i];
        if (!Array.isArray(arr)) continue;
        for (var j = 0; j < arr.length; j++) pushConv(out, arr[j]);
      }
      if (out.size) return Array.from(out.values());
    }
    var st = store.state || {};
    var lists = [st.todayChatList, st.chatList, st.searchChatList];
    for (var k = 0; k < lists.length; k++) {
      var l = lists[k];
      if (!Array.isArray(l)) continue;
      for (var m = 0; m < l.length; m++) pushConv(out, l[m]);
    }
    return Array.from(out.values());
  }
  var STORE_TAIL = 12;
  var MEDIA_RE = /^\[(图片|视频|文件|乐高卡片|表情|语音)\]\s*$/;
  function bodyOf(node) {
    var body = extractContent(node);
    if (body.content) {
      if (MEDIA_RE.test(body.content)) {
        var mt = typeFromContent(body.content);
        return { type: mt === 'text' ? 'card' : mt, content: body.content };
      }
      return body;
    }
    var info = (node && node.info) || {};
    var title = trimStr(info.title || info.goods_name || info.goodsName || '');
    if (title) return { type: 'card', content: '[商品] ' + title };
    return { type: 'text', content: '' };
  }
  function ingestConv(conv) {
    var uid = normUid(conv.userInfo && conv.userInfo.uid);
    if (!uid) return;
    var uinfo = conv.userInfo || {};
    var nick = trimStr(uinfo.nickname || uinfo.nickName || uinfo.nick || uinfo.user_name || uinfo.username || '');
    var list = Array.isArray(conv.messageList) ? conv.messageList : [];
    if (!list.length && conv.lastMessage) list = [conv.lastMessage];
    var start = Math.max(0, list.length - STORE_TAIL);
    for (var i = start; i < list.length; i++) {
      var m = list[i];
      if (!m || typeof m !== 'object') continue;
      var role = (m.from && m.from.role) || '';
      var from = roleToFrom(role);
      if (!from) from = /user|buyer/.test(String(role).toLowerCase()) ? 'buyer' : 'seller';
      if (from === 'system') continue;
      var body = bodyOf(m);
      if (!body.content) continue;
      state.stats.storeMsgs++;
      var msgId = trimStr(m.msg_id || m.msgId || m.message_id || '');
      var ts = Number(m.ts || m.time || m.timestamp || 0);
      if (isFinite(ts) && ts > 0) {
        if (ts < 1e12) ts = ts * 1000;
      } else {
        // 缺时间：只有最后一条按「刚发生」，其余当历史（由水位/基线筛掉）
        ts = i === list.length - 1 ? nowSec() * 1000 : 0;
      }
      if (!msgId) msgId = 'st:' + uid + ':' + hash32(String(ts) + '|' + body.content + '|' + from);
      try {
        ingestMessage({
          uid: uid,
          username: nick,
          message: { msgId: msgId, from: from, type: body.type, content: body.content, ts: ts },
        });
      } catch (e) {
        fail('scanStore.ingest', e);
      }
    }
  }
  function scanStore() {
    var store = storeOf();
    if (!store) {
      state.stats.storeMiss++;
      state.storeOk = false;
      return;
    }
    state.stats.storeHits++;
    state.storeOk = true;
    var convs = conversationsOf(store);
    state.convCache = convs;
    state.stats.storeConvs = convs.length;
    for (var i = 0; i < convs.length; i++) ingestConv(convs[i]);
  }

  /* ------------------------------------------------------------------ *
   * 原生采集：真实 MMS 气泡 DOM
   * ------------------------------------------------------------------ */
  var BUBBLE_SEL = '.chat-item p.chat-message-content, p.chat-message-content';
  var CONV_SEL = '.chat-item-box[data-random]';
  var TIME_SEL = '.chat-time, .message-time, .msg-time, .chat-item-time, .time, time';
  function parseClock(text) {
    var s = trimStr(text || '', 60);
    if (!s) return 0;
    var m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6] || 0).getTime();
    m = /(昨天|前天)\s*(\d{1,2}):(\d{2})/.exec(s);
    if (m) {
      var d = new Date();
      d.setDate(d.getDate() - (m[1] === '昨天' ? 1 : 2));
      d.setHours(+m[2], +m[3], 0, 0);
      return d.getTime();
    }
    m = /(\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(s);
    if (m) return new Date(new Date().getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4], 0, 0).getTime();
    m = /(\d{1,2}):(\d{2})/.exec(s);
    if (m) {
      var t = new Date();
      t.setHours(+m[1], +m[2], 0, 0);
      if (t.getTime() > Date.now() + 60000) t.setDate(t.getDate() - 1);
      return t.getTime();
    }
    return 0;
  }
  function timeNear(el) {
    try {
      var item = el.closest ? el.closest('.chat-item') : null;
      var scope = [item, item && item.previousElementSibling, item && item.nextElementSibling];
      for (var i = 0; i < scope.length; i++) {
        var s = scope[i];
        if (!s || !s.querySelectorAll) continue;
        var list = s.querySelectorAll(TIME_SEL);
        for (var j = 0; j < list.length; j++) {
          var t = parseClock(list[j].textContent || '');
          if (t) return t;
        }
        if (s !== item) {
          var t2 = parseClock(trimStr(s.textContent || '', 40));
          if (t2) return t2;
        }
      }
    } catch (e) {}
    return 0;
  }
  function scanBubbles() {
    if (!document.querySelector(CONV_SEL) && !document.querySelector('.chat-item')) return false;
    var uid = resolveActiveUid();
    var nodes = document.querySelectorAll(BUBBLE_SEL);
    state.stats.bubbleNodes += nodes.length;
    if (!uid) {
      if (nodes.length) state.stats.domNoUid++;
      return true;
    }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = trimStr(el.textContent || '', 500);
      if (!text) continue;
      var ts = timeNear(el);
      if (!ts && i >= nodes.length - 3) ts = Date.now();
      var item = el.closest ? el.closest('.chat-item') : null;
      var mine = false;
      try {
        mine = !!(
          (item && (item.querySelector('.merchantMessage') || (item.classList && item.classList.contains('merchantMessage')))) ||
          (el.closest && el.closest('.merchantMessage'))
        );
      } catch (e) {}
      var type = MEDIA_RE.test(text) ? (typeFromContent(text) === 'text' ? 'card' : typeFromContent(text)) : typeFromContent(text);
      try {
        ingestMessage({
          uid: uid,
          username: '',
          message: {
            msgId: 'dom:' + uid + ':' + hash32(text),
            from: mine ? 'seller' : 'buyer',
            type: type,
            content: text,
            ts: ts,
          },
        });
      } catch (e) {
        fail('scanBubbles.ingest', e);
      }
    }
    return true;
  }
  function unreplyUids() {
    var set = new Set();
    var add = function (box) {
      if (!box) return;
      var dr = box.getAttribute && box.getAttribute('data-random');
      if (!dr) return;
      var k = trimStr(String(dr).split('-')[0]);
      if (k) set.add(k);
    };
    try {
      document.querySelectorAll('.chat-unreply-time, .chat-unreply-over-time').forEach(function (n) {
        add(n.closest && n.closest('.chat-item-box'));
      });
      document
        .querySelectorAll(
          '.five-minute .chat-item-box[data-random], .timeout-unreply .chat-item-box[data-random], ul.already-unreply .chat-item-box[data-random]',
        )
        .forEach(add);
    } catch (e) {}
    return set;
  }

  function scanGenericDom() {
    var panel = findPanel();
    if (!panel) return;
    state.stats.domScans++;
    var pr;
    try {
      pr = panel.getBoundingClientRect();
    } catch (e) {
      return;
    }
    if (!pr || pr.width < 50) return;
    var mid = pr.left + pr.width / 2;
    var nodes = panel.querySelectorAll(NODE_SELECTORS);
    state.stats.domNodes += nodes.length;
    var uid = resolveActiveUid();
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.querySelector(NODE_SELECTORS)) continue; // 只取叶子节点，避免父容器重复文本
      var text = trimStr(el.innerText || el.textContent || '', 500);
      if (!text) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < pr.top - 200 || r.top > pr.bottom + 200) continue;
      state.stats.domLeaf++;
      if (!uid) {
        state.stats.domNoUid++;
        continue;
      }
      var key = 'dom:' + uid + ':' + hash32(text);
      if (state.seen.has(key)) {
        state.stats.domSeen++;
        continue;
      }
      var from;
      if (SYSTEM_RE.test(text)) from = 'system';
      else {
        var center = r.left + r.width / 2;
        from = center > mid ? 'seller' : 'buyer';
      }
      var t = typeFromContent(text);
      try {
        var gts = timeNear(el);
        if (!gts && i >= nodes.length - 3) gts = Date.now();
        ingestMessage({
          uid: uid,
          username: '',
          message: { msgId: key, from: from, type: t, content: text, ts: gts },
        });
      } catch (e) {
        fail('scanGenericDom.ingest', e);
      }
    }
  }

  function scanDom() {
    try {
      scanStore();
    } catch (e) {
      fail('scanStore.timer', e);
    }
    var nativeHit = false;
    try {
      nativeHit = scanBubbles();
    } catch (e) {
      fail('scanBubbles.timer', e);
    }
    if (!nativeHit) scanGenericDom();
  }

  /* ------------------------------------------------------------------ *
   * 发送：UI 注入（主通道，优先）
   * ------------------------------------------------------------------ */
  function findInput() {
    var selectors = [
      'textarea',
      '[contenteditable="true"]',
      '[class*="editor"][contenteditable]',
      '[class*="input"] textarea',
      '[class*="chat"] [contenteditable]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!visible(el)) continue;
        if (el.closest('[class*="sidebar"],[class*="search"]')) continue;
        return el;
      }
    }
    return null;
  }
  function readEditor(el) {
    if (!el) return '';
    if ('value' in el && typeof el.value === 'string') return el.value;
    return el.innerText || el.textContent || '';
  }
  function setEditor(el, value) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } else {
      try {
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, value);
      } catch (e) {}
      if (readEditor(el).trim() !== value.trim()) {
        el.innerHTML = '';
        var p = document.createElement('div');
        p.textContent = value;
        el.appendChild(p);
      }
    }
    try {
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }),
      );
    } catch (e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function findSendButton() {
    var byText = [];
    var buttons = document.querySelectorAll('button,[role="button"],[class*="send"],[class*="btn"]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (!visible(b)) continue;
      var t = trimStr(b.innerText || b.textContent || '');
      var cls = String(b.className || '');
      if (/发送|send/i.test(t) || /send/i.test(cls)) byText.push(b);
    }
    return byText[0] || null;
  }
  function pressEnter(el) {
    var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }
  function clickEl(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var opt = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    try {
      el.dispatchEvent(new MouseEvent('mousedown', opt));
      el.dispatchEvent(new MouseEvent('mouseup', opt));
      el.dispatchEvent(new MouseEvent('click', opt));
    } catch (e) {}
    try {
      if (typeof el.click === 'function') el.click();
    } catch (e) {}
    return true;
  }

  async function uiSendText(uid, text) {
    var el = findInput();
    if (!el) return { ok: false, reason: 'input_not_found' };
    if (trimStr(readEditor(el))) return { ok: false, reason: 'input_busy' };
    setEditor(el, text);
    await sleep(80);
    if (!trimStr(readEditor(el))) {
      return { ok: false, reason: 'send_unconfirmed', detail: 'input_write_failed' };
    }
    // 点击前登记 self-send：页面回显可能比本函数返回更早发生
    noteSelfSend(uid, text);
    var btn = findSendButton();
    if (btn) {
      clickEl(btn);
      await sleep(150);
      if (trimStr(readEditor(el))) pressEnter(el);
    } else {
      pressEnter(el);
      await sleep(150);
      if (trimStr(readEditor(el))) {
        var b2 = findSendButton();
        if (b2) clickEl(b2);
      }
    }
    await sleep(200);
    var left = trimStr(readEditor(el));
    return left ? { ok: false, reason: 'send_unconfirmed', detail: 'editor_still_has_text' } : { ok: true, method: 'ui' };
  }

  /** 契约要求：成功前确认消息真的进入会话（DOM/消息流回显），不能只看输入框清空 */
  async function waitForEcho(uid, text, timeoutMs, since) {
    var target = trimStr(text, 500);
    var key = normUid(uid || '');
    var from = Number(since) || Date.now();
    var deadline = Date.now() + (timeoutMs || CONF.sendConfirmMs);
    while (Date.now() < deadline) {
      var e = state.lastEcho;
      if (e && e.text === target && e.at >= from && (!key || !e.uid || e.uid === key)) return true;
      await sleep(80);
    }
    return false;
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var meta = parts[0] || '';
    var mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1] || '');
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }
  async function toFile(payload) {
    var p = payload || {};
    var raw = p.payload || p.dataUrl || p.url || '';
    var mode = p.mode || (String(raw).slice(0, 5) === 'data:' ? 'dataurl' : 'url');
    var filename = trimStr(p.filename) || (mode === 'url' && /\.(mp4|mov)(\?|$)/i.test(raw) ? 'video.mp4' : 'image.png');
    if (mode === 'dataurl') {
      var blob = dataUrlToBlob(raw);
      return new File([blob], filename, { type: p.mime || blob.type });
    }
    if (mode === 'base64') {
      var blob2 = dataUrlToBlob('data:' + (p.mime || 'image/png') + ';base64,' + raw);
      return new File([blob2], filename, { type: blob2.type });
    }
    var res = await fetch(raw, { credentials: 'omit' });
    if (!res.ok) throw new Error('文件下载失败 ' + res.status);
    var b3 = await res.blob();
    return new File([b3], filename, { type: p.mime || b3.type });
  }
  async function uiSendFile(payload) {    var file;
    try {
      file = await toFile(payload);
    } catch (e) {
      return { ok: false, reason: 'invalid_payload', detail: String((e && e.message) || e) };
    }
    if (!file || !file.size) return { ok: false, reason: 'invalid_payload' };
    var dt = new DataTransfer();
    dt.items.add(file);
    var el = findInput();
    var panel = findPanel();
    var target = el || panel || document.body;
    try {
      target.focus && target.focus();
    } catch (e) {}
    var pasted = false;
    try {
      var ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      pasted = target.dispatchEvent(ev);
    } catch (e) {}
    try {
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    } catch (e) {}
    return { ok: true, via: pasted ? 'paste' : 'drop', filename: file.name, size: file.size };
  }

  /** 媒体发送确认：会话区出现新的 img/video/文件节点才算成功 */
  function mediaNodeCount() {
    try {
      var panel = findPanel() || document.body;
      return panel.querySelectorAll(
        'img,video,[class*="image"],[class*="img-wrap"],[class*="video"],[class*="file-item"],[class*="media"]',
      ).length;
    } catch (e) {
      return 0;
    }
  }
  async function waitForMediaEcho(base, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || CONF.mediaConfirmMs);
    while (Date.now() < deadline) {
      if (mediaNodeCount() > base) return true;
      await sleep(120);
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 页面内 fetch（卡片动作 / 优惠券 / 历史），只使用页面上下文
   * ------------------------------------------------------------------ */
  async function pageJson(path, opts) {
    var o = opts || {};
    var url = path;
    if (o.query) {
      var qs = Object.keys(o.query)
        .map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(o.query[k]);
        })
        .join('&');
      if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
    }
    var headers = { 'content-type': 'application/json' };
    var anti = pickAnti();
    if (anti) headers['anti-content'] = anti;
    var init = { method: o.method || (o.body ? 'POST' : 'GET'), credentials: 'include', headers: headers };
    if (o.body !== undefined) init.body = JSON.stringify(o.body);
    var res = await fetch(url, init);
    var text = await res.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { raw: text.slice(0, 500) };
    }
    return { status: res.status, ok: res.ok, data: data };
  }
  function apiOk(r) {
    var d = r && r.data;
    if (!r || !r.ok) return false;
    if (d && d.success === false) return false;
    if (d && d.error_code && Number(d.error_code) !== 1000000) return false;
    return true;
  }
  function markConversation(uid, markType) {
    var store = storeOf();
    if (!store) return false;
    try {
      var marked = normUid(uid) + '-' + Number(markType || 0) + '-reply';
      if (store._mutations && store._mutations['MARK_CONVERSATION']) {
        store.commit('MARK_CONVERSATION', { uid: marked, markType: Number(markType || 0) });
        return true;
      }
      var conv = null;
      var lists = [store.state && store.state.chatList, store.state && store.state.todayChatList];
      for (var i = 0; i < lists.length && !conv; i++) {
        var l = lists[i];
        if (!Array.isArray(l)) continue;
        for (var j = 0; j < l.length; j++) {
          if (l[j] && l[j].userInfo && normUid(l[j].userInfo.uid) === normUid(uid)) {
            conv = l[j];
            break;
          }
        }
      }
      if (conv) conv.markType = Number(markType || 0);
      return !!conv;
    } catch (e) {
      return false;
    }
  }
  async function cardAction(path, body) {
    try {
      if (!pickAnti()) return { ok: false, reason: 'anti_missing' };
      var r = await pageJson(path, { method: 'POST', body: body });
      return { ok: apiOk(r), status: r.status };
    } catch (e) {
      fail('cardAction', e);
      return { ok: false, reason: 'send_failed', detail: String((e && e.message) || e) };
    }
  }

  /* ------------------------------------------------------------------ *
   * 对外能力对象
   * ------------------------------------------------------------------ */
  var api = {
    ver: VER,
    global: '__pddWeb',
    get lastError() {
      return state.lastError;
    },
    logs: function () {
      return state.logs.slice();
    },
    last: function () {
      return state.logs[state.logs.length - 1] || '';
    },
    currentUid: function () {
      return resolveActiveUid();
    },
    stats: function () {
      return {
        ver: VER,
        frames: state.stats.frames,
        ingested: state.stats.ingested,
        watermarked: state.stats.watermarked,
        replayed: state.stats.replayed,
        domScans: state.stats.domScans,
        domNodes: state.stats.domNodes,
        domLeaf: state.stats.domLeaf,
        domSeen: state.stats.domSeen,
        domNoUid: state.stats.domNoUid,
        storeHits: state.stats.storeHits,
        storeMiss: state.stats.storeMiss,
        storeConvs: state.stats.storeConvs,
        storeMsgs: state.stats.storeMsgs,
        bubbleNodes: state.stats.bubbleNodes,
        storeOk: state.storeOk,
        needLogin: loginReported,
        unreply: (function () {
          try {
            return unreplyUids().size;
          } catch (e) {
            return 0;
          }
        })(),
        sends: state.stats.sends,
        events: state.events.length,
        eventSeq: state.eventSeq,
        pending: state.pendingByUid.size,
        claimed: state.claimedRows.size,
        hasInput: !!findInput(),
        hasSendButton: !!findSendButton(),
        hasPanel: !!findPanel(),
        hasAnti: !!pickAnti(),
        activeUid: resolveActiveUid(),
        watermarkUids: state.watermarks.size,
        aiEnabled: state.aiEnabled,
        startedAt: state.stats.startedAt,
      };
    },
    /**
     * 只读事件出口：返回 seq > sinceSeq 的新消息事件。
     * 缺省 sinceSeq 时从 0 开始，但最多返回缓冲内最后 eventsReturnMax（200）条。
     * 不清 pending、不影响 claim/sent；返回形状与抖店 bridge 一致：
     *   { ok:true, seq, events:[{seq,uid,username,from,type,content,msgId,ts,goodsTitle}] }
     */
    drainEvents: function (params) {
      var p = params || {};
      var raw = p.sinceSeq;
      var hasSince =
        raw !== undefined && raw !== null && raw !== '' && isFinite(Number(raw));
      var since = hasSince ? Math.max(0, Number(raw)) : 0;
      var events = state.events.filter(function (e) {
        return e.seq > since;
      });
      if (!hasSince) events = events.slice(-CONF.eventsReturnMax);
      events = events.map(function (e) {
        return {
          seq: e.seq,
          uid: e.uid,
          username: e.username,
          from: e.from,
          type: e.type,
          content: e.content,
          msgId: e.msgId,
          ts: e.ts,
          goodsTitle: e.goodsTitle,
        };
      });
      return { ok: true, seq: state.eventSeq, events: events };
    },
    selfTest: function () {
      return {
        input: !!findInput(),
        sendButton: !!findSendButton(),
        panel: !!findPanel(),
        panelTag: findPanel() ? findPanel().className : '',
        antiAgeMs: state.anti.at ? Date.now() - state.anti.at : -1,
        sockets: state.sockets.length,
        activeUid: resolveActiveUid(),
        watermarkUids: state.watermarks.size,
      };
    },
    onMsg: function (fn) {
      if (typeof fn === 'function') state.eventHandlers.push(fn);
      return function () {
        var i = state.eventHandlers.indexOf(fn);
        if (i >= 0) state.eventHandlers.splice(i, 1);
      };
    },
    pending: function () {
      var out = {};
      state.pendingByUid.forEach(function (row, uid) {
        out[uid] = {
          uid: uid,
          username: row.username,
          goodsTitle: row.goodsTitle,
          orderId: row.orderId,
          orderStatus: row.orderStatus,
          messages: row.messages.slice(),
        };
      });
      return out;
    },
    popPending: function () {
      var best = null;
      state.pendingByUid.forEach(function (row) {
        if (!best || (row.firstAt || 0) < (best.firstAt || 0)) best = row;
      });
      if (!best) return emptyRow();
      state.pendingByUid.delete(best.uid);
      best.claimAt = Date.now();
      state.claimedRows.set(best.uid, best);
      return {
        uid: best.uid,
        username: best.username || '',
        goodsTitle: best.goodsTitle || '',
        orderId: best.orderId || '',
        orderStatus: best.orderStatus || '',
        messages: best.messages.slice(),
      };
    },
    releasePendingClaim: function (uid) {
      var key = String(uid || '');
      var row = state.claimedRows.get(key);
      if (!row) return false;
      state.claimedRows.delete(key);
      var cur = state.pendingByUid.get(row.uid);
      if (cur) {
        cur.messages = row.messages.concat(cur.messages).slice(-CONF.pendingTailMax);
        cur.firstAt = Math.min(cur.firstAt || Date.now(), row.firstAt || Date.now());
      } else {
        state.pendingByUid.set(row.uid, row);
      }
      return true;
    },
    discardClaim: function (uid) {
      return state.claimedRows.delete(String(uid || ''));
    },
    discardBefore: function (uid, beforeTs) {
      var key = String(uid || '');
      var ts = Number(beforeTs) || 0;
      if (!key || ts <= 0) return false;
      var row = state.pendingByUid.get(key);
      if (!row) return false;
      row.messages = row.messages.filter(function (m) {
        return !m.ts || m.ts >= ts;
      });
      if (!row.messages.length) state.pendingByUid.delete(key);
      return true;
    },
    sent: function (uid) {
      var list = state.sentByUid.get(String(uid || '')) || [];
      return list.map(function (m) {
        return { msgId: m.msgId, from: m.from, type: m.type, content: m.content, ts: m.ts };
      });
    },
    popSent: function (uid) {
      var key = String(uid || '');
      if (!key) return [];
      var list = state.sentByUid.get(key) || [];
      state.sentByUid.set(key, []);
      return list.map(function (m) {
        return { msgId: m.msgId, from: m.from, type: m.type, content: m.content, ts: m.ts };
      });
    },
    popMerchantSent: function () {
      var out = state.merchantSent.map(function (r) {
        return { uid: r.uid, ts: r.ts, message: r.message };
      });
      state.merchantSent = [];
      return out;
    },
    drainPendingQueue: function () {
      var out = [];
      for (;;) {
        var row = api.popPending();
        if (!row.uid) break;
        out.push(row);
      }
      return out;
    },
    drainSentQueue: function () {
      var out = [];
      state.sentByUid.forEach(function (list, uid) {
        if (list.length) out.push({ uid: uid, messages: api.popSent(uid) });
      });
      return out;
    },
    lastCsReplyTs: function (uid) {
      return state.csReplies.get(String(uid || '')) || 0;
    },
    markTransferredOut: function (uid) {
      var key = String(uid || '');
      state.pendingByUid.delete(key);
      state.claimedRows.delete(key);
      return true;
    },
    syncAiEnabled: function (enabled) {
      state.aiEnabled = enabled !== false;
      return true;
    },
    pendingSnapshot: function () {
      return api.pending();
    },
    watermark: function (uid) {
      var wm = state.watermarks.get(String(uid || ''));
      if (!wm) return null;
      return { uid: String(uid || ''), ts: wm.ts, ids: wm.ids.length, at: wm.at };
    },
    watermarkSnapshot: function () {
      var out = [];
      state.watermarks.forEach(function (wm, uid) {
        out.push({ uid: uid, ts: wm.ts, ids: wm.ids.length, at: wm.at });
      });
      return out;
    },
    clearWatermark: function (uid) {
      var key = String(uid || '');
      if (!key) return false;
      var had = state.watermarks.delete(key);
      if (had) scheduleWmPersist();
      return had;
    },
    clearSeen: function () {
      state.seen.clear();
      state.seenText.clear();
      state.seenTextAny.clear();
      return true;
    },
    conversationHistory: async function (uid, limit) {
      var key = String(uid || '');
      if (!key) return [];
      var n = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20;
      try {
        var r = await pageJson('/latitude/search/message/getMessages', {
          query: { uid: key, page: 1, page_size: n },
        });
        if (!apiOk(r)) return [];
        var rows =
          (r.data && (r.data.result && (r.data.result.messages || r.data.result.list))) ||
          (r.data && r.data.messages) ||
          [];
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          var node = normalizeNode(rows[i]);
          if (node) out.push(node.message);
        }
        return out.slice(-n);
      } catch (e) {
        fail('conversationHistory', e);
        return [];
      }
    },
    consultGoods: async function (uid) {
      try {
        var r = await pageJson('/latitude/goods/recommendGoods', { query: { uid: String(uid || '') } });
        if (!apiOk(r)) return null;
        var list = (r.data && r.data.result && (r.data.result.goodsList || r.data.result.list)) || [];
        var g = list[0] || null;
        if (!g) return null;
        return {
          goodsId: trimStr(g.goods_id || g.goodsId || ''),
          goodsName: trimStr(g.goods_name || g.goodsName || ''),
        };
      } catch (e) {
        return null;
      }
    },
    goodsContext: function (uid) {
      var row = state.pendingByUid.get(String(uid || '')) || state.claimedRows.get(String(uid || ''));
      if (!row) return { goodsTitle: '', orderId: '', orderStatus: '' };
      return { goodsTitle: row.goodsTitle || '', orderId: row.orderId || '', orderStatus: row.orderStatus || '' };
    },
    focusConversation: async function (uid) {
      var key = normUid(uid);
      if (!key) return { ok: false, reason: 'invalid_payload' };
      if (resolveActiveUid() === key) return { ok: true, already: true };
      var box = document.querySelector('.chat-item-box[data-random^="' + key + '-"]');
      if (!box) box = document.querySelector('.chat-item-box[data-random^="' + key + '"]');
      if (box) {
        try {
          box.scrollIntoView({ block: 'center' });
          clickEl(box.querySelector('.chat-item') || box);
          await sleep(500);
          return { ok: true, method: 'dom' };
        } catch (e) {}
      }
      var store = storeOf();
      if (store) {
        try {
          var conv = null;
          var lists = [
            store.state && store.state.chatList,
            store.state && store.state.todayChatList,
            store.state && store.state.searchChatList,
          ];
          for (var i = 0; i < lists.length && !conv; i++) {
            var l = lists[i];
            if (!Array.isArray(l)) continue;
            for (var j = 0; j < l.length; j++) {
              if (l[j] && l[j].userInfo && normUid(l[j].userInfo.uid) === key) {
                conv = l[j];
                break;
              }
            }
          }
          if (conv && store._mutations && store._mutations['CHAGNGE_CURRENT_USER_INFO']) {
            store.commit('CHAGNGE_CURRENT_USER_INFO', conv);
            await sleep(500);
            return { ok: true, method: 'store' };
          }
        } catch (e) {}
      }
      return { ok: false, reason: 'conversation_not_found' };
    },
    openChat: async function (uid) {
      return api.focusConversation(uid);
    },
    sendText: async function (uid, text) {
      var content = trimStr(text, 900);
      if (!content) return { ok: false, reason: 'invalid_payload' };
      state.stats.sends++;
      var startedAt = Date.now();
      var res;
      try {
        res = await uiSendText(uid, content);
      } catch (e) {
        fail('sendText.ui', e);
        return { ok: false, reason: 'send_unconfirmed', detail: String((e && e.message) || e) };
      }
      if (!res.ok) {
        return { ok: false, reason: res.reason || 'send_unconfirmed', detail: res.detail, method: 'ui' };
      }
      var confirmed = await waitForEcho(uid, content, CONF.sendConfirmMs, startedAt);
      if (!confirmed) {
        return { ok: false, reason: 'send_unconfirmed', detail: 'no_dom_or_stream_echo', method: 'ui' };
      }
      var msgId = 'ui-' + Date.now().toString(36) + '-' + hash32(content);
      pushSent(uid, { msgId: msgId, from: 'seller', type: 'text', content: content, ts: Date.now() });
      try {
        markConversation(uid, 0);
      } catch (e) {}
      emit('sent', { uid: uid || state.activeUid, message: { msgId: msgId, content: content } });
      return { ok: true, method: 'ui', msgId: msgId };
    },
    send: async function (uid, text) {
      return api.sendText(uid, text);
    },
    sendImage: async function (uid, payload) {
      state.stats.sends++;
      var base = mediaNodeCount();
      var res = await uiSendFile(payload);
      if (!res.ok) return res;
      if (!(await waitForMediaEcho(base, CONF.mediaConfirmMs))) {
        return { ok: false, reason: 'send_unconfirmed', detail: 'no_media_echo' };
      }
      pushSent(uid, {
        msgId: 'img-' + Date.now().toString(36),
        from: 'seller',
        type: 'image',
        content: res.filename,
        ts: Date.now(),
      });
      emit('sent', { uid: uid || state.activeUid, message: { type: 'image', content: res.filename } });
      return res;
    },
    sendPic: async function (uid, payload) {
      return api.sendImage(uid, payload);
    },
    sendImageBase64: async function (uid, payload) {
      var p = typeof payload === 'string' ? { mode: 'base64', payload: payload } : Object.assign({}, payload, { mode: 'base64' });
      return api.sendImage(uid, p);
    },
    sendVideo: async function (uid, payload) {
      var p = payload || {};
      var raw = trimStr(p.payload || p.url);
      if (!raw) return { ok: false, reason: 'invalid_payload' };
      state.stats.sends++;
      var base = mediaNodeCount();
      var res = await uiSendFile({
        mode: String(raw).slice(0, 5) === 'data:' ? 'dataurl' : 'url',
        payload: raw,
        filename: p.filename || 'video.mp4',
      });
      if (!res.ok) return res;
      if (!(await waitForMediaEcho(base, CONF.mediaConfirmMs))) {
        return { ok: false, reason: 'send_unconfirmed', detail: 'no_media_echo' };
      }
      pushSent(uid, {
        msgId: 'vid-' + Date.now().toString(36),
        from: 'seller',
        type: 'video',
        content: res.filename,
        ts: Date.now(),
      });
      return res;
    },
    sendCouponByName: async function (uid, name) {
      var target = trimStr(name);
      if (!target) return { ok: false, reason: 'invalid_payload' };
      var list = await pageJson('/latitude/coupon/allCouponList', { query: { uid: String(uid || '') } });
      if (!list.ok) return { ok: false, reason: 'coupon_list_failed', status: list.status };
      var d = (list.data && list.data.result) || {};
      var arr = d.allMallCouponList || d.couponList || [];
      var hit = null;
      for (var i = 0; i < arr.length; i++) {
        var desc = trimStr(arr[i].batchDesc || arr[i].batch_desc || arr[i].name || '');
        if (desc && desc === target) {
          hit = arr[i];
          break;
        }
        if (desc && target && desc.indexOf(target) >= 0) hit = hit || arr[i];
      }
      if (!hit) return { ok: false, reason: 'coupon_not_found' };
      var body = { uid: String(uid || ''), batch_id: hit.batchId || hit.batch_id, mall_id: hit.mallId || hit.mall_id };
      var r = await pageJson('/plateau/message/coupon_card/send', { method: 'POST', body: body });
      if (!apiOk(r)) return { ok: false, reason: 'send_failed', status: r.status };
      pushSent(uid, {
        msgId: 'cpn-' + Date.now().toString(36),
        from: 'seller',
        type: 'card',
        content: target,
        ts: Date.now(),
      });
      return { ok: true };
    },
    agreeModifyAddress: async function (uid) {
      return cardAction('/latitude/order/remarks/mallConfirm', { uid: String(uid || ''), type: 1 });
    },
    agreeOrderRemarks: async function (uid) {
      return cardAction('/latitude/order/remarks/mallConfirm', { uid: String(uid || ''), type: 2 });
    },
    appealCashBack: async function (uid) {
      return cardAction('/plateau/message/callback', { uid: String(uid || ''), action: 'cash_back_appeal' });
    },
    favoriteConversation: async function (uid) {
      try {
        var r = await pageJson('/plateau/chat/mark_conversation', {
          method: 'POST',
          body: { uid: String(uid || ''), mark: 1 },
        });
        return { ok: apiOk(r) };
      } catch (e) {
        return { ok: false, reason: 'send_failed' };
      }
    },
    markConversationRead: async function (uid) {
      try {
        var r = await pageJson('/plateau/chat/mark_conversation', {
          method: 'POST',
          body: { uid: String(uid || ''), mark: 0 },
        });
        return { ok: apiOk(r) };
      } catch (e) {
        return { ok: false, reason: 'send_failed' };
      }
    },
    anti: function () {
      return {
        value: pickAnti(),
        ageMs: state.anti.at ? Date.now() - state.anti.at : -1,
        path: state.anti.path,
        ttlMs: CONF.antiTtlMs,
      };
    },
    scanNow: function () {
      scanDom();
      return api.stats();
    },
    rescan: function () {
      return api.scanNow();
    },
    getMsgList: async function (uid) {
      return api.conversationHistory(uid, 20);
    },
    getChatHistory: async function (uid) {
      return api.conversationHistory(uid, 20);
    },
    dispose: function () {
      state.timers.forEach(function (t) {
        try {
          clearInterval(t);
        } catch (e) {}
      });
      state.timers = [];
      if (state.wmPersistTimer) {
        try {
          clearTimeout(state.wmPersistTimer);
        } catch (e) {}
        state.wmPersistTimer = null;
      }
      try {
        if (state.mo) state.mo.disconnect();
      } catch (e) {}
      state.eventHandlers = [];
    },
  };

  /* ------------------------------------------------------------------ *
   * 登录态巡检
   * ------------------------------------------------------------------ */
  var loginReported = false;
  function checkLogin() {
    var href = '';
    try {
      href = String(location.href || '');
    } catch (e) {}
    var loggedOut = /\/login(\/|\?|$)/.test(href) || /redirectUrl=/i.test(href);
    if (!loggedOut) {
      if (loginReported) {
        loginReported = false;
        emit('login_ok', { url: href });
      }
      return;
    }
    if (loginReported) return;
    loginReported = true;
    state.lastError = '拼多多后台未登录或会话已过期，请在店铺窗口完成登录';
    emit('need_login', { url: href });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  try {
    hookSockets();
    hookNetwork();
    loadWatermarks();
    state.activeUid = resolveActiveUid();
    addTimer(function () {
      try {
        state.activeUid = resolveActiveUid();
      } catch (e) {}
    }, 2000);

    var lastScan = 0;
    function scheduleScan() {
      var now = Date.now();
      if (now - lastScan < CONF.scanThrottleMs) return;
      lastScan = now;
      try {
        scanDom();
      } catch (e) {
        fail('scanDom.timer', e);
      }
    }
    addTimer(scheduleScan, CONF.pollMs);
    checkLogin();
    addTimer(checkLogin, 5000);
    try {
      state.mo = new MutationObserver(scheduleScan);
      state.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
    window.__pddWeb = api;
    scheduleScan();
    log('已启动 v' + VER + '，WS/DOM 双通道采集 + 持久化水位就绪');
  } catch (e) {
    state.lastError = '启动失败: ' + ((e && e.message) || e);
    window.__pddWeb = api;
    warn('启动失败', e);
  }
})();
