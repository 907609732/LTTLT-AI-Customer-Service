/* eslint-disable */
/**
 * desk-v1 · 抖店（飞鸽客服页）注入桥 v1
 *
 * 注入位置：抖店客户端 IM 容器页（脚本由本机桥接服务提供）。
 * 该页是「容器页」；本脚本有两种运行模式：
 *
 *   1) 容器模式：页面上有 <webview>，但没有 __workbench__。
 *      - 发现 src 含 im.jinritemai.com / darenim.jinritemai.com 的 webview；
 *      - 把本脚本自身源码 executeJavaScript 注入到每个 IM webview；
 *      - 在容器页暴露 window.__deskDoudianBridge.call(method, params)，按店铺路由；
 *      - 可选：通过 ?ws=ws://127.0.0.1:<port> 或 window.__DESK_V1_DOUDIAN_WS__
 *        连接本机 RPC 服务（地址由外部注入，脚本不写死远端地址）。
 *
 *   2) 页面模式：当前就是飞鸽 IM 页（有 __workbench__.workbenchOptions.extra.im）。
 *      - 订阅 im.message$ / im._messagesUpsert$ 采集；
 *      - DOM 兜底扫描；
 *      - 发送走页面自身 im.sendText(uid, text, {'p:check_Send': mark})，
 *        不逆向任何签名；是否成功以「消息流/DOM 回显」确认；
 *      - 三表队列 pendingByUid / claimedRows / sentByUid，失败可归还；
 *      - 按 msgId 持久化水位，页面重载不把历史整体重放进 pending；
 *      - self-send 8s TTL 去重。
 *
 * 版本标记：window.__DESK_DOUDIAN_VER
 * 页面全局：window.__deskDoudian；容器/页面统一 RPC：window.__deskDoudianBridge
 *
 * 已知 UNVERIFIED（需真店确认）：
 *   - 飞鸽 message$ 事件字段名与回显时机；
 *   - 发送后服务端回推是否带 msgId；
 *   - 图片上传 webpack 模块 'doImageXUpload' 是否仍存在；
 *   - DOM 兜底选择器（真实页面 class 名未知，使用宽松选择器）。
 */
(function () {
  'use strict';

  var VER = 1;
  window.__DESK_DOUDIAN_VER = VER;

  var PAGE_GLOBAL = '__deskDoudian';
  var BRIDGE_GLOBAL = '__deskDoudianBridge';
  var PREV = window[PAGE_GLOBAL];
  if (PREV && PREV.ver === VER && window[BRIDGE_GLOBAL]) return;
  if (PREV && typeof PREV.dispose === 'function') {
    try { PREV.dispose(); } catch (e) {}
  }

  var LOG_PREFIX = '%c[DOUDIAN-BRIDGE]';
  var LOG_STYLE = 'color:#ff5b36;font-weight:600';
  var CONF = {
    selfSendTtlMs: 8000,
    textDedupeMs: 180000,
    crossDedupeMs: 20000,
    replaySlackMs: 60000,
    bootstrapGraceMs: 60000,
    seenMax: 2000,
    watermarkMaxIds: 300,
    pollMs: 1200,
    scanThrottleMs: 800,
    sendConfirmMs: 3000,
    mediaConfirmMs: 5000,
    pendingTailMax: 30,
    sentTailMax: 50,
    merchantSentMax: 200,
    historyMax: 80,
    eventsMax: 500,
    eventsReturnMax: 200,
    webviewScanMs: 1500,
    wsReconnectMs: 3000,
    // 容器目标健康检查：真机证据要求在子页 reload / target 失效后自愈。
    containerHealthMs: 12000,
    containerHealthMinGapMs: 5000,
    containerRouteDebounceMs: 300,
    containerRecoverMinGapMs: 1500,
    containerDetachedTtlMs: 300000,
    containerMaxTargets: 12,
    containerMaxReinject: 1,
  };
  var WM_KEY = '__desk_doudian_hook_watermark_v1';

  function isImPage() {
    try {
      var host = String(location.hostname || '');
      if (/^(im|darenim)\.jinritemai\.com$/i.test(host)) return true;
    } catch (e) {}
    try {
      var wb = window.__workbench__;
      return !!(wb && wb.workbenchOptions && wb.workbenchOptions.extra && wb.workbenchOptions.extra.im);
    } catch (e2) {}
    return false;
  }

  /* ================================================================== *
   * 页面模式
   * ================================================================== */
  function installPageMode() {
    var state = {
      ver: VER,
      mode: 'page',
      activeUid: '',
      shopId: '',
      aiEnabled: true,
      convCache: [],
      pendingByUid: new Map(),
      claimedRows: new Map(),
      sentByUid: new Map(),
      merchantSent: [],
      // 消息事件环形缓冲：给主进程「新消息事件」出口用，与 pending/claim 完全解耦。
      events: [],
      eventSeq: 0,
      historyByUid: new Map(),
      ccodeByUid: new Map(),
      seen: new Map(),
      seenText: new Map(),
      seenTextAny: new Map(),
      csReplies: new Map(),
      selfSends: [],
      lastEcho: null,
      lastImageEcho: null,
      watermarks: new Map(),
      wmPersistTimer: null,
      timers: [],
      subscriptions: [],
      eventHandlers: [],
      logs: [],
      lastError: '',
      armed: false,
      bootAt: Date.now(),
      stats: {
        frames: 0,
        live: 0,
        ingested: 0,
        watermarked: 0,
        replayed: 0,
        domScans: 0,
        domNodes: 0,
        domLeaf: 0,
        domSeen: 0,
        domNoUid: 0,
        sends: 0,
        imageSends: 0,
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
        args.unshift('%c[DOUDIAN-BRIDGE]', 'color:#ff9f0a;font-weight:600');
        console.warn.apply(console, args);
      } catch (e) {}
    }
    function fail(where, err) {
      var msg = (err && (err.stack || err.message)) || String(err);
      state.lastError = where + ': ' + msg;
      warn(where, msg);
    }
    function sleep(ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
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
    function normUid(u) {
      return String(u == null ? '' : u).trim().replace(/@goofish$/i, '');
    }
    function parseJson(v) {
      if (v && typeof v === 'object') return v;
      if (typeof v !== 'string') return null;
      var s = v.trim();
      if (!s) return null;
      try { return JSON.parse(s); } catch (e) { return null; }
    }
    function addTimer(fn, ms) {
      var t = setInterval(fn, ms);
      state.timers.push(t);
      return t;
    }
    function emit(kind, data) {
      try { window.postMessage({ __deskDoudian: 1, kind: kind, data: data }, '*'); } catch (e) {}
      for (var i = 0; i < state.eventHandlers.length; i++) {
        try { state.eventHandlers[i]({ kind: kind, data: data }); } catch (e) { fail('emit.handler', e); }
      }
    }
    /**
     * 把一条「真正新进的消息」写入事件环形缓冲。
     * 只做只读出口，不清 pending、不影响 claim；content 保留原文（最长 2000 字符）。
     */
    function pushEvent(uid, username, m) {
      if (!uid || !m) return null;
      state.eventSeq += 1;
      var content = m.content == null ? '' : String(m.content);
      var ev = {
        seq: state.eventSeq,
        uid: String(uid),
        username: String(username == null ? '' : username).trim(),
        from: m.from === 'seller' ? 'seller' : 'buyer',
        type: m.type || 'text',
        content: content.length > 2000 ? content.slice(0, 2000) : content,
        msgId: m.msgId || '',
        ts: Number(m.ts) || Date.now(),
        goodsTitle: String(m.goodsTitle == null ? '' : m.goodsTitle).trim(),
      };
      state.events.push(ev);
      if (state.events.length > CONF.eventsMax) {
        state.events.splice(0, state.events.length - CONF.eventsMax);
      }
      return ev;
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
    function imApi() {
      try {
        var wb = window.__workbench__;
        var extra = wb && wb.workbenchOptions && wb.workbenchOptions.extra;
        return (extra && extra.im) || null;
      } catch (e) {
        return null;
      }
    }
    function workbenchExtra() {
      try {
        var wb = window.__workbench__;
        return (wb && wb.workbenchOptions && wb.workbenchOptions.extra) || null;
      } catch (e) {
        return null;
      }
    }

    /* ---------------------------------------------------------------- *
     * 持久化水位
     * ---------------------------------------------------------------- */
    function wmStorage() {
      try { if (window.localStorage) return window.localStorage; } catch (e) {}
      try { if (window.sessionStorage) return window.sessionStorage; } catch (e2) {}
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
      if (!m.ts) return true;
      if (wm.ts && m.ts < wm.ts - CONF.replaySlackMs) return true;
      return false;
    }
    function isBootstrapHistory(uid, m) {
      if (state.watermarks.has(uid)) return false;
      if (!m.ts) return true;
      return m.ts < state.bootAt - CONF.bootstrapGraceMs;
    }
    function absorb(uid, m) {
      markSeen(m.msgId);
      noteWatermark(uid, m);
    }

    /* ---------------------------------------------------------------- *
     * self-send 8s TTL
     * ---------------------------------------------------------------- */
    function noteSelfSend(uid, content) {
      var now = Date.now();
      state.selfSends = state.selfSends.filter(function (r) { return now - r.ts < CONF.selfSendTtlMs; });
      state.selfSends.push({ uid: normUid(uid || ''), text: trimStr(content, 500), ts: now });
      if (state.selfSends.length > 50) state.selfSends = state.selfSends.slice(-50);
    }
    function isSelfEcho(uid, m) {
      if (!m || !m.content) return false;
      var now = Date.now();
      state.selfSends = state.selfSends.filter(function (r) { return now - r.ts < CONF.selfSendTtlMs; });
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

    /* ---------------------------------------------------------------- *
     * 归一化
     * ---------------------------------------------------------------- */
    var IMAGE_TYPES = /^(file_image|image|img)$/i;
    var VIDEO_TYPES = /^(video|short_video)$/i;
    var SYSTEM_TEXT_RE = /^(客服.+接入|.+将该会话转移给.+|从历史会话发起会话|您超时未回复，系统关闭会话|\[系统消息\]|对方正在输入|已读|未读)$/;

    function mergeExt(a, b) {
      var out = {};
      var i;
      if (a && typeof a === 'object') for (i in a) out[i] = a[i];
      if (b && typeof b === 'object') for (i in b) out[i] = b[i];
      return out;
    }
    function firstUrl(obj, depth) {
      if (obj == null || depth > 5) return '';
      if (typeof obj === 'string') {
        var m = obj.match(/https?:\/\/[^\s"'<>\\]+/i);
        return m ? m[0].replace(/[),.;]+$/, '') : '';
      }
      if (typeof obj !== 'object') return '';
      for (var k in obj) {
        if (depth === 0 && !/image|url|cover|thumb|render|pic|video/i.test(k)) continue;
        var v = firstUrl(obj[k], depth + 1);
        if (v) return v;
      }
      return '';
    }
    function goodsOf(e, ext) {
      var sd = parseJson(e.static_data) || parseJson(ext.static_data) || {};
      var sale = Array.isArray(sd.sale_goods) ? sd.sale_goods[0] || {} : {};
      return {
        goodsId: trimStr(e.goods_id || sale.product_id || ''),
        goodsTitle: trimStr(
          sale.product_name_two_lines || sale.product_name || sd.product_name ||
            (sd.b_good && sd.b_good.product_name) || '',
        ),
        orderId: trimStr(e.order_id || sd.order_id || ''),
        orderStatus: trimStr(sd.order_status || sd.tag_content || ''),
      };
    }
    function pickUid(e, ext, convId, from) {
      var head = String(convId || '').split(':')[0] || '';
      var candidates = from === 'seller'
        ? [ext.security_receiver_id, head, e.receiver, e.sender]
        : [e.sender, e.securitySender, ext.security_pigeon_uid, ext.security_sender_id, head];
      for (var i = 0; i < candidates.length; i++) {
        var v = String(candidates[i] == null ? '' : candidates[i]).trim();
        if (!v) continue;
        if (v.indexOf(':') >= 0) v = v.split(':')[0];
        return v;
      }
      return '';
    }
    function normalizeMessage(raw) {
      var e = parseJson(raw);
      if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
      if (e.isRecalled === true || e.visible === false) return null;
      var ext = mergeExt(parseJson(e.originExt), parseJson(e.ext));
      var convId = trimStr(e.bizConversationId || e.conversationId || ext.security_biz_conversation_id || '');
      var bizType = trimStr(
        e.conversationBizType != null ? e.conversationBizType
          : e.pigeonBizType != null ? e.pigeonBizType
            : e.bizType != null ? e.bizType
              : ext.PIGEON_BIZ_TYPE != null ? ext.PIGEON_BIZ_TYPE : ext.biz_type,
      );
      if (bizType === '1009' || convId.indexOf('::1009:') >= 0) {
        return { system: true, uid: '', message: null, ccode: convId };
      }
      var senderRole = trimStr(e.senderRole || ext.sender_role || ext.im_sender_role || '');
      var bizSender = trimStr(ext.biz_sender || '');
      var bizInfo = parseJson(ext.biz_sender_info) || {};
      var bizRole = trimStr(bizInfo.biz_role_type || bizInfo.role_type || bizInfo.biz_role || '');
      var from = '';
      if (e.isFromMe === true) from = 'seller';
      else if (senderRole === '2' || senderRole === '3' || senderRole === '4') from = 'seller';
      else if (bizRole === 'CurrentServer' || bizRole === 'cs' || bizSender === 'robot') from = 'seller';
      else if (senderRole === '1' || bizRole === 'Buyer' || e.isFromMe === false) from = 'buyer';
      else from = 'buyer';
      var uid = pickUid(e, ext, convId, from);
      if (!uid && from === 'seller') uid = state.activeUid;
      if (!uid) return null;

      var msgType = trimStr(e.pigeonMsgType || ext.type || '');
      var rawContent = typeof e.content === 'string' ? e.content : '';
      var hint = trimStr(ext.hint_content || ext.customer_hint || '');
      var text = trimStr(rawContent || hint);
      var type = 'text';
      var content = text;
      if (IMAGE_TYPES.test(msgType) || text === '[图片]' || text === '用户发送了图片') {
        type = 'image';
        content = firstUrl(ext) || firstUrl(e.content) || text || '用户发送了图片';
      } else if (VIDEO_TYPES.test(msgType) || text === '[视频]' || text === '用户发送了视频') {
        type = 'video';
        content = firstUrl(ext) || firstUrl(e.content) || text || '用户发送了视频';
      } else if (!text) {
        var goods = goodsOf(e, ext);
        if (goods.goodsTitle || goods.orderId) {
          type = goods.orderId ? 'order' : 'card';
          content = goods.orderId
            ? ['[订单卡片]', goods.goodsTitle, goods.orderStatus].filter(Boolean).join(' ')
            : goods.goodsTitle;
        } else {
          var anyUrl = firstUrl(ext);
          if (!anyUrl) return null;
          type = /\.(mp4|mov|m3u8)(\?|$)/i.test(anyUrl) ? 'video' : 'image';
          content = anyUrl;
        }
      }
      if (!content) return null;
      if (SYSTEM_TEXT_RE.test(content)) return { system: true, uid: uid, message: null, ccode: convId };

      var ts = Number(e.createTime) || Date.parse(e.createdAt) || 0;
      if (!isFinite(ts) || ts <= 0) ts = Date.now();
      else if (ts < 1e12) ts = ts * 1000;
      var msgId = trimStr(e.serverId || e.clientId || ext['s:client_message_id'] || '');
      if (!msgId) msgId = 'h-' + hash32(uid + '|' + ts + '|' + content);
      var goods = goodsOf(e, ext);
      return {
        system: false,
        uid: uid,
        ccode: convId,
        username: trimStr(ext.nickname || ext.uname || ''),
        message: {
          msgId: msgId,
          from: from,
          type: type,
          content: content,
          ts: ts,
          goodsId: goods.goodsId,
          goodsTitle: goods.goodsTitle,
          orderId: goods.orderId,
          orderStatus: goods.orderStatus,
        },
      };
    }

    var MSG_KEYS = ['content', 'senderRole', 'sender_role', 'serverId', 'clientId', 'pigeonMsgType', 'conversationId', 'bizConversationId'];
    function looksLikeMessage(o) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
      var hits = 0;
      for (var i = 0; i < MSG_KEYS.length; i++) if (o[MSG_KEYS[i]] !== undefined) hits++;
      return hits >= 2;
    }
    function collectMessages(payload) {
      var queue = [payload];
      var visited = 0;
      while (queue.length && visited < 3000) {
        var cur = queue.shift();
        visited++;
        if (!cur || typeof cur !== 'object') continue;
        if (looksLikeMessage(cur)) {
          try {
            var norm = normalizeMessage(cur);
            if (norm && !norm.system) ingestMessage(norm);
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

    /* ---------------------------------------------------------------- *
     * 三表
     * ---------------------------------------------------------------- */
    function emptyRow() {
      return { uid: '', username: '', ccode: '', messages: [], firstAt: 0, lastAt: 0 };
    }
    function rowFor(uid) {
      var row = state.pendingByUid.get(uid);
      if (row) return row;
      row = emptyRow();
      row.uid = uid;
      row.firstAt = Date.now();
      state.pendingByUid.set(uid, row);
      return row;
    }
    function noteHistory(uid, m) {
      if (!uid || !m) return;
      var list = state.historyByUid.get(uid) || [];
      if (list.some(function (x) { return x.msgId === m.msgId; })) return;
      list.push({ msgId: m.msgId, from: m.from, type: m.type, content: m.content, ts: m.ts });
      if (list.length > CONF.historyMax) list = list.slice(-CONF.historyMax);
      state.historyByUid.set(uid, list);
    }
    function ingestMessage(norm) {
      if (!norm || norm.system || !norm.uid) return;
      var uid = norm.uid;
      var m = norm.message;
      if (!m || !m.content) return;
      state.stats.live++;
      state.activeUid = state.activeUid || uid;
      if (norm.ccode) state.ccodeByUid.set(uid, norm.ccode);

      if (isReplayByWatermark(uid, m)) {
        state.stats.replayed++;
        absorb(uid, m);
        return;
      }
      if (isBootstrapHistory(uid, m)) {
        absorb(uid, m);
        return;
      }
      if (isSelfEcho(uid, m)) {
        state.lastEcho = { uid: uid, text: trimStr(m.content, 500), msgId: m.msgId, at: Date.now() };
        if (m.type === 'image') state.lastImageEcho = { uid: uid, msgId: m.msgId, at: Date.now() };
        if (m.from === 'seller') noteHistory(uid, m);
        absorb(uid, m);
        return;
      }
      if (markSeen(m.msgId)) {
        noteWatermark(uid, m);
        return;
      }

      var tkey = uid + '|' + m.from + '|' + trimStr(m.content, 200);
      var seenAt = state.seenText.get(tkey);
      if (seenAt && Date.now() - seenAt < CONF.textDedupeMs) {
        noteWatermark(uid, m);
        return;
      }
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
      noteHistory(uid, m);

      if (m.from === 'seller') {
        var list = state.sentByUid.get(uid) || [];
        list.push(m);
        if (list.length > CONF.sentTailMax) list = list.slice(-CONF.sentTailMax);
        state.sentByUid.set(uid, list);
        state.merchantSent.push({ uid: uid, message: m, ts: Date.now() });
        if (state.merchantSent.length > CONF.merchantSentMax) {
          state.merchantSent.splice(0, state.merchantSent.length - CONF.merchantSentMax);
        }
        state.csReplies.set(uid, Date.now());
        var pending = state.pendingByUid.get(uid);
        if (pending) pending.selfRepliedAt = Date.now();
        state.lastEcho = { uid: uid, text: trimStr(m.content, 500), msgId: m.msgId, at: Date.now() };
        if (m.type === 'image') state.lastImageEcho = { uid: uid, msgId: m.msgId, at: Date.now() };
        noteWatermark(uid, m);
        pushEvent(uid, norm.username, m);
        emit('message', { uid: uid, message: m, username: norm.username });
        return;
      }

      var row = rowFor(uid);
      if (norm.username) row.username = norm.username;
      if (norm.ccode) row.ccode = norm.ccode;
      if (m.goodsTitle && !row.goodsTitle) row.goodsTitle = m.goodsTitle;
      if (m.orderId && !row.orderId) row.orderId = m.orderId;
      if (m.orderStatus && !row.orderStatus) row.orderStatus = m.orderStatus;
      row.messages.push(m);
      if (row.messages.length > CONF.pendingTailMax) row.messages = row.messages.slice(-CONF.pendingTailMax);
      row.lastAt = Date.now();
      noteWatermark(uid, m);
      pushEvent(uid, row.username, m);
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
      if (state.merchantSent.length > CONF.merchantSentMax) {
        state.merchantSent.splice(0, state.merchantSent.length - CONF.merchantSentMax);
      }
      state.csReplies.set(u, Date.now());
      noteHistory(u, message);
      noteWatermark(u, message);
      var row = state.pendingByUid.get(u);
      pushEvent(u, row ? row.username : '', message);
    }

    /* ---------------------------------------------------------------- *
     * 订阅与采集
     * ---------------------------------------------------------------- */
    function safeSubscribe(obs, tag) {
      if (!obs || typeof obs.subscribe !== 'function') return false;
      try {
        var sub = obs.subscribe(function (e) {
          state.stats.frames++;
          try {
            collectMessages(e && e.value !== undefined ? e.value : e);
          } catch (err) {
            fail('subscribe.' + tag, err);
          }
        });
        state.subscriptions.push(sub);
        log('已订阅 ' + tag);
        return true;
      } catch (e) {
        fail('subscribe.' + tag, e);
        return false;
      }
    }
    function arm() {
      if (state.armed) return true;
      var imc = imApi();
      if (!imc) return false;
      var ok = safeSubscribe(imc.message$, 'message$');
      var ok2 = safeSubscribe(imc._messagesUpsert$, '_messagesUpsert$');
      if (ok || ok2) {
        state.armed = true;
        return true;
      }
      return false;
    }
    function refreshShopId() {
      if (state.shopId) return Promise.resolve(state.shopId);
      var extra = workbenchExtra();
      if (!extra || typeof extra.get !== 'function') return Promise.resolve('');
      return Promise.resolve(
        extra
          .get('/backstage/currentuser', { params: { _pms: 1, biz_type: 4 } })
          .then(function (res) {
            var data = (res && res.data) || res || {};
            var id = data.ShopId || data.shop_id || data.shopId || '';
            if (id) {
              state.shopId = String(id);
              try { window.__dyShopId = state.shopId; } catch (e) {}
            }
            return state.shopId;
          })
          .catch(function () { return ''; }),
      );
    }

    /* ---------------------------------------------------------------- *
     * 当前会话 / DOM 兜底
     * ---------------------------------------------------------------- */
    function resolveActiveUid() {
      try {
        var info = window.ss && window.ss.instance && window.ss.instance.conversationsInfo;
        var conv = info && info.currentConversation;
        if (conv) {
          var cid = String(conv.bizConversationId || conv.conversationId || '');
          var u = conv.securityReceiverId || conv.security_receiver_id || conv.buyerId || conv.uid || cid.split(':')[0];
          if (u) return normUid(u);
        }
      } catch (e) {}
      return state.activeUid || '';
    }
    var PANEL_SELECTORS = [
      '[class*="message-list"]',
      '[class*="messageList"]',
      '[class*="chat-content"]',
      '[class*="chatContent"]',
      '[class*="msg-list"]',
      '[class*="msgList"]',
      '#message-list',
      '#message-panel',
    ];
    var NODE_SELECTORS =
      '[class*="message-item"],[class*="msg-item"],[class*="bubble"],[class*="message-content"],[class*="msg-content"],[class*="text-content"]';
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
    /** DOM 兜底是否具备采集条件（只探测，不产生副作用）。 */
    function domObservable() {
      try {
        return !!document.querySelector(NODE_SELECTORS) && !!findPanel();
      } catch (e) {
        return false;
      }
    }
    function timeNear(el) {
      try {
        var item = el.closest ? el.closest('[class*="message-item"],[class*="msg-item"],li') : null;
        var scope = [item, item && item.previousElementSibling];
        for (var i = 0; i < scope.length; i++) {
          var s = scope[i];
          if (!s || !s.querySelectorAll) continue;
          var list = s.querySelectorAll('time,[class*="time"],[class*="Time"]');
          for (var j = 0; j < list.length; j++) {
            var txt = trimStr(list[j].textContent || '', 60);
            var m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(txt);
            if (m) {
              var d = new Date();
              d.setHours(+m[1], +m[2], +m[3] || 0, 0);
              if (d.getTime() > Date.now() + 60000) d.setDate(d.getDate() - 1);
              return d.getTime();
            }
          }
        }
      } catch (e) {}
      return 0;
    }
    function scanDom() {
      if (!document.querySelector(NODE_SELECTORS)) return false;
      var panel = findPanel();
      if (!panel) return false;
      state.stats.domScans++;
      var pr;
      try { pr = panel.getBoundingClientRect(); } catch (e) { return false; }
      if (!pr || pr.width < 50) return false;
      var mid = pr.left + pr.width / 2;
      var uid = resolveActiveUid();
      var nodes = panel.querySelectorAll(NODE_SELECTORS);
      state.stats.domNodes += nodes.length;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.querySelector(NODE_SELECTORS)) continue;
        var text = trimStr(el.innerText || el.textContent || '', 500);
        if (!text) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
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
        var mine = false;
        try {
          var item = el.closest ? el.closest('[class*="message-item"],[class*="msg-item"],li') : null;
          mine = !!(
            (item && /(right|self|mine|isFromMe|fromMe)/i.test(String(item.className || ''))) ||
            /(right|self|mine|isFromMe|fromMe)/i.test(String(el.className || ''))
          );
          if (!mine) mine = r.left + r.width / 2 > mid;
        } catch (e) {}
        var ts = timeNear(el);
        if (!ts && i >= nodes.length - 3) ts = Date.now();
        try {
          ingestMessage({
            system: false,
            uid: uid,
            ccode: state.ccodeByUid.get(uid) || '',
            username: '',
            message: {
              msgId: key,
              from: mine ? 'seller' : 'buyer',
              type: /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?|$)/i.test(text) ? 'image' : 'text',
              content: text,
              ts: ts,
            },
          });
        } catch (e) {
          fail('scanDom.ingest', e);
        }
      }
      return true;
    }

    /* ---------------------------------------------------------------- *
     * 发送
     * ---------------------------------------------------------------- */
    async function waitForEcho(uid, text, timeoutMs, since) {
      var target = trimStr(text, 500);
      var key = normUid(uid || '');
      var from = Number(since) || Date.now();
      var deadline = Date.now() + (timeoutMs || CONF.sendConfirmMs);
      while (Date.now() < deadline) {
        var e = state.lastEcho;
        if (e && e.text === target && e.at >= from && (!key || !e.uid || e.uid === key)) return e;
        await sleep(80);
      }
      return null;
    }
    async function sendText(uid, text, opts) {
      var content = trimStr(text, 900);
      if (!content) return { ok: false, reason: 'send_unconfirmed', detail: 'empty_text' };
      var key = normUid(uid || '');
      if (!key) return { ok: false, reason: 'input_not_found', detail: 'uid_required' };
      var imc = imApi();
      if (!imc || typeof imc.sendText !== 'function') {
        return { ok: false, reason: 'hook_not_ready', detail: 'im.sendText_unavailable' };
      }
      var expectedShop = trimStr(opts && opts.expectedShopId);
      if (expectedShop) {
        var shop = state.shopId || trimStr(window.__dyShopId);
        if (!shop) await refreshShopId();
        shop = state.shopId || trimStr(window.__dyShopId);
        if (shop && shop !== expectedShop) {
          return { ok: false, reason: 'input_not_found', detail: 'shop_mismatch:' + shop };
        }
      }
      state.stats.sends++;
      var startedAt = Date.now();
      var mark =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + hash32(content);
      // 点击/调用前登记 self-send：页面回显可能比函数返回更早
      noteSelfSend(key, content);
      try {
        await imc.sendText(key, content, { 'p:check_Send': mark });
      } catch (err) {
        fail('sendText.im', err);
        // 调用抛错不代表没发出去：按契约返回“结果未知”，不得自动重发。
        return { ok: false, reason: 'send_unconfirmed', detail: String((err && err.message) || err) };
      }
      var echo = await waitForEcho(key, content, opts && opts.confirmMs, startedAt);
      if (!echo) {
        return { ok: false, reason: 'send_unconfirmed', detail: 'no_message_echo' };
      }
      var msgId = echo.msgId || 'out:' + Date.now();
      pushSent(key, { msgId: msgId, from: 'seller', type: 'text', content: content, ts: Date.now() });
      emit('sent', { uid: key, message: { msgId: msgId, content: content } });
      return { ok: true, msgId: msgId, method: 'im.sendText' };
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
    async function fileOf(payload) {
      var p = payload || {};
      var raw = trimStr(p.payload || p.dataUrl || p.url);
      var mode = p.mode || (raw.slice(0, 5) === 'data:' ? 'dataurl' : 'url');
      var filename = trimStr(p.filename) || 'image.png';
      if (mode === 'base64') {
        var blob = dataUrlToBlob('data:' + (p.mime || 'image/png') + ';base64,' + raw);
        return new File([blob], filename, { type: blob.type });
      }
      if (mode === 'dataurl') {
        var blob2 = dataUrlToBlob(raw);
        return new File([blob2], filename, { type: p.mime || blob2.type });
      }
      var res = await fetch(raw, { credentials: 'omit' });
      if (!res.ok) throw new Error('image_download_failed:' + res.status);
      var b3 = await res.blob();
      return new File([b3], filename, { type: p.mime || b3.type });
    }
    function findImageUploader() {
      try {
        if (typeof window.__dyUploadImage === 'function') return window.__dyUploadImage;
        var chunkName = Object.prototype.hasOwnProperty.call(window, 'masterWebpackJsonp')
          ? 'masterWebpackJsonp'
          : Object.keys(window).find(function (k) { return k.indexOf('@ecom-vmok/pigeon-im-pc') === 0; });
        if (!chunkName || !window[chunkName] || typeof window[chunkName].push !== 'function') return null;
        var found = null;
        var chunk = window[chunkName];
        var processChunk = function (modules) {
          var table = modules && modules.m;
          if (!table) return;
          var ids = Object.keys(table);
          for (var i = 0; i < ids.length; i++) {
            if (String(table[ids[i]]).indexOf('doImageXUpload') < 0) continue;
            var exported = modules(ids[i]);
            if (exported && typeof exported.iP === 'function') found = exported.iP;
          }
        };
        chunk.push([[Symbol('desk-v1-image')], {}, processChunk]);
        chunk.pop();
        if (typeof found === 'function') window.__dyUploadImage = found;
        return found;
      } catch (e) {
        fail('findImageUploader', e);
        return null;
      }
    }
    function imageMeta(file) {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        var done = function (result) {
          try { URL.revokeObjectURL(url); } catch (e) {}
          resolve(result);
        };
        img.onload = function () { done({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 }); };
        img.onerror = function () { done({ width: 0, height: 0 }); };
        img.src = url;
      });
    }
    async function sendImage(uid, payload, opts) {
      var key = normUid(uid || '');
      if (!key) return { ok: false, reason: 'input_not_found', detail: 'uid_required' };
      var imc = imApi();
      if (!imc || typeof imc._sendMsg !== 'function') {
        return { ok: false, reason: 'hook_not_ready', detail: 'im._sendMsg_unavailable' };
      }
      var upload = findImageUploader();
      if (typeof upload !== 'function') {
        return { ok: false, reason: 'hook_not_ready', detail: 'image_uploader_unavailable_UNVERIFIED' };
      }
      state.stats.imageSends++;
      var startedAt = Date.now();
      try {
        var file = await fileOf(payload);
        var uploaded = await upload(file);
        var uri = uploaded && (uploaded.uri || uploaded.url || uploaded.imageUrl);
        if (!uri) return { ok: false, reason: 'send_unconfirmed', detail: 'image_upload_no_uri' };
        var meta = await imageMeta(file);
        var uuid =
          typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        await imc._sendMsg(key, {
          content: '[图片]',
          type: 'file_image',
          ext: {
            imageUrl: uri,
            imageWidth: meta.width,
            imageHeight: meta.height,
            imageFormat: String(file.type || '').indexOf('png') >= 0 ? 'png' : 'jpeg',
            tag_valid: '1',
            uuid: uuid,
          },
        });
      } catch (err) {
        return { ok: false, reason: 'send_unconfirmed', detail: String((err && err.message) || err) };
      }
      // 图片回显确认 UNVERIFIED：message$ 回推 file_image，或会话区新增 img 节点。
      var base = document.querySelectorAll('img').length;
      var confirmed = false;
      var deadline = Date.now() + CONF.mediaConfirmMs;
      while (Date.now() < deadline) {
        var echo = state.lastImageEcho;
        if (echo && echo.at >= startedAt && (!key || !echo.uid || echo.uid === key)) {
          confirmed = true;
          break;
        }
        if (document.querySelectorAll('img').length > base) {
          confirmed = true;
          break;
        }
        await sleep(150);
      }
      if (!confirmed) {
        return { ok: false, reason: 'send_unconfirmed', detail: 'no_image_echo_UNVERIFIED' };
      }
      var msgId = 'img:' + Date.now();
      pushSent(key, { msgId: msgId, from: 'seller', type: 'image', content: trimStr(payload && payload.filename) || 'image', ts: Date.now() });
      return { ok: true, msgId: msgId, method: 'im._sendMsg', unverified: true };
    }

    async function focusConversation(uid, opts) {
      var key = normUid(uid || '');
      if (!key) return { ok: false, reason: 'input_not_found', detail: 'uid_required' };
      var imc = imApi();
      if (!imc || typeof imc.chatWithUid !== 'function') {
        return { ok: false, reason: 'hook_not_ready', detail: 'im.chatWithUid_unavailable' };
      }
      try {
        await imc.chatWithUid(key);
        await sleep(400);
        return { ok: true, method: 'chatWithUid' };
      } catch (e) {
        return { ok: false, reason: 'input_not_found', detail: String((e && e.message) || e) };
      }
    }
    async function conversationHistory(uid, limit) {
      var key = normUid(uid || '');
      if (!key) return [];
      var n = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20;
      var cached = (state.historyByUid.get(key) || []).slice(-n);
      // 尝试页面 IM 拉历史（同类实现），失败就返回已采集缓存。UNVERIFIED。
      try {
        var imc = imApi();
        var core = imc && imc.pigeonIM && (imc.pigeonIM.coreIM || imc.pigeonIM._coreIM);
        var ccode = state.ccodeByUid.get(key) || '';
        if (core && typeof core.pullMessagesByConversation === 'function' && ccode) {
          var rows = await core.pullMessagesByConversation({ conversationId: ccode, cursor: 0, limit: n });
          if (Array.isArray(rows)) {
            var out = [];
            for (var i = 0; i < rows.length; i++) {
              var norm = normalizeMessage(rows[i]);
              if (norm && !norm.system && norm.message) out.push(norm.message);
            }
            if (out.length) {
              out.sort(function (a, b) { return a.ts - b.ts; });
              return out.slice(-n);
            }
          }
        }
      } catch (e) {
        fail('conversationHistory.pull', e);
      }
      return cached;
    }

    /* ---------------------------------------------------------------- *
     * 对外 API
     * ---------------------------------------------------------------- */
    var api = {
      ver: VER,
      global: PAGE_GLOBAL,
      mode: 'page',
      get lastError() { return state.lastError; },
      logs: function () { return state.logs.slice(); },
      stats: function () {
        return {
          ver: VER,
          mode: 'page',
          armed: state.armed,
          collection: state.armed ? 'store' : (domObservable() ? 'dom' : 'none'),
          frames: state.stats.frames,
          live: state.stats.live,
          ingested: state.stats.ingested,
          watermarked: state.stats.watermarked,
          replayed: state.stats.replayed,
          domScans: state.stats.domScans,
          domNodes: state.stats.domNodes,
          domLeaf: state.stats.domLeaf,
          domSeen: state.stats.domSeen,
          domNoUid: state.stats.domNoUid,
          sends: state.stats.sends,
          imageSends: state.stats.imageSends,
          pending: state.pendingByUid.size,
          claimed: state.claimedRows.size,
          watermarkUids: state.watermarks.size,
          activeUid: resolveActiveUid(),
          shopId: state.shopId || trimStr(window.__dyShopId),
          aiEnabled: state.aiEnabled,
          hasIm: !!imApi(),
          hasSendText: !!(imApi() && typeof imApi().sendText === 'function'),
          hasChatWithUid: !!(imApi() && typeof imApi().chatWithUid === 'function'),
          startedAt: state.stats.startedAt,
        };
      },
      selfTest: function () {
        var imc = imApi();
        return {
          mode: 'page',
          collection: state.armed ? 'store' : (domObservable() ? 'dom' : 'none'),
          hasIm: !!imc,
          hasMessage$: !!(imc && imc.message$ && typeof imc.message$.subscribe === 'function'),
          hasUpsert$: !!(imc && imc._messagesUpsert$ && typeof imc._messagesUpsert$.subscribe === 'function'),
          hasSendText: !!(imc && typeof imc.sendText === 'function'),
          hasChatWithUid: !!(imc && typeof imc.chatWithUid === 'function'),
          armed: state.armed,
          activeUid: resolveActiveUid(),
          shopId: state.shopId || trimStr(window.__dyShopId),
          watermarkUids: state.watermarks.size,
          panel: !!findPanel(),
        };
      },
      onMsg: function (fn) {
        if (typeof fn === 'function') state.eventHandlers.push(fn);
        return function () {
          var i = state.eventHandlers.indexOf(fn);
          if (i >= 0) state.eventHandlers.splice(i, 1);
        };
      },
      enable: function () {
        var armed = arm();
        var extra = workbenchExtra();
        if (extra && typeof extra.get === 'function') refreshShopId();
        return armed;
      },
      pending: function () {
        var out = {};
        state.pendingByUid.forEach(function (row, uid) {
          out[uid] = {
            uid: uid,
            username: row.username,
            ccode: row.ccode,
            goodsTitle: row.goodsTitle || '',
            orderId: row.orderId || '',
            orderStatus: row.orderStatus || '',
            messages: row.messages.slice(),
          };
        });
        return out;
      },
      pendingSnapshot: function () {
        return api.pending();
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
          ccode: best.ccode || '',
          goodsTitle: best.goodsTitle || '',
          orderId: best.orderId || '',
          orderStatus: best.orderStatus || '',
          messages: best.messages.slice(),
          claimedAt: best.claimAt,
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
        row.messages = row.messages.filter(function (m) { return !m.ts || m.ts >= ts; });
        if (!row.messages.length) state.pendingByUid.delete(key);
        return true;
      },
      sent: function (uid) {
        return (state.sentByUid.get(String(uid || '')) || []).map(function (m) {
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
      /**
       * 只读事件出口：返回 seq > sinceSeq 的新消息事件。
       * 缺省 sinceSeq 时从 0 开始但最多返回缓冲内最后 200 条。
       * 不清 pending、不影响 claim。
       */
      drainEvents: function (params) {
        var p = params || {};
        var raw = p.sinceSeq;
        var hasSince =
          raw !== undefined && raw !== null && raw !== '' && isFinite(Number(raw));
        var since = hasSince ? Math.max(0, Number(raw)) : 0;
        var events = state.events.filter(function (e) { return e.seq > since; });
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
      popMerchantSent: function () {
        var out = state.merchantSent.map(function (r) {
          return { uid: r.uid, ts: r.ts, message: r.message };
        });
        state.merchantSent = [];
        return out;
      },
      lastCsReplyTs: function (uid) {
        return state.csReplies.get(String(uid || '')) || 0;
      },
      syncAiEnabled: function (enabled) {
        state.aiEnabled = enabled !== false;
        return true;
      },
      scanNow: function () {
        arm();
        try { scanDom(); } catch (e) { fail('scanNow.dom', e); }
        return api.stats();
      },
      rescan: function () { return api.scanNow(); },
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
      sendText: sendText,
      send: function (uid, text) { return sendText(uid, text); },
      sendImage: sendImage,
      sendVideo: async function () {
        return { ok: false, reason: 'hook_not_ready', detail: 'video_not_implemented_UNVERIFIED' };
      },
      conversationHistory: conversationHistory,
      getChatHistory: function (uid) { return conversationHistory(uid, 20); },
      focusConversation: focusConversation,
      openChat: function (uid) { return focusConversation(uid); },
      dispose: function () {
        state.timers.forEach(function (t) { try { clearInterval(t); } catch (e) {} });
        state.timers = [];
        if (state.wmPersistTimer) {
          try { clearTimeout(state.wmPersistTimer); } catch (e) {}
          state.wmPersistTimer = null;
        }
        state.subscriptions.forEach(function (s) {
          try { if (s && typeof s.unsubscribe === 'function') s.unsubscribe(); } catch (e) {}
        });
        state.subscriptions = [];
        state.eventHandlers = [];
      },
    };

    /* ---------------------------------------------------------------- *
     * RPC 统一入口（容器模式与页面模式共用）
     * ---------------------------------------------------------------- */
    async function dispatch(method, params) {
      var p = params || {};
      switch (method) {
        case 'ensure': {
          var armed = arm();
          await refreshShopId();
          // 就绪 = 能采集：message$ 订阅成功（store），或 DOM 兜底面板存在（dom），
          // 或队列已收到消息。不要因为 message$ 不可用就把仍能 DOM 采集的店铺判死。
          var collection = armed ? 'store' : domObservable() ? 'dom' : state.pendingByUid.size > 0 ? 'store' : 'none';
          var shopId = state.shopId || trimStr(window.__dyShopId);
          if (collection !== 'none') {
            return { ok: true, mode: 'page', armed: armed, collection: collection, shopId: shopId };
          }
          return { ok: false, reason: 'hook_not_ready', detail: 'message_observable_unavailable', collection: 'none', shopId: shopId };
        }
        case 'preparePending':
          arm();
          try { scanDom(); } catch (e) { fail('preparePending.dom', e); }
          return { ok: true };
        case 'popPending':
          return api.popPending();
        case 'pendingSnapshot':
          return { ok: true, count: state.pendingByUid.size, uids: Array.from(state.pendingByUid.keys()) };
        case 'conversationHistory':
          return conversationHistory(p.uid, p.limit);
        case 'sendText':
          return sendText(p.uid, p.text, p);
        case 'sendImage':
          return sendImage(p.uid, p.payload, p);
        case 'release':
          return { ok: true, released: api.releasePendingClaim(p.uid) };
        case 'discard':
          api.discardClaim(p.uid);
          if (Number(p.beforeTs) > 0) api.discardBefore(p.uid, p.beforeTs);
          return { ok: true };
        case 'popMerchantSent':
          return api.popMerchantSent();
        case 'popSent':
          return api.popSent(p.uid);
        case 'drainEvents':
          return api.drainEvents(p);
        case 'syncAiEnabled':
          api.syncAiEnabled(p.enabled);
          return { ok: true };
        case 'focusConversation':
          return focusConversation(p.uid, p);
        case 'stats':
          return api.stats();
        case 'selfTest':
          return api.selfTest();
        case 'scanNow':
          return api.scanNow();
        default:
          return { ok: false, reason: 'hook_not_ready', detail: 'unknown_method:' + method };
      }
    }

    var bridge = {
      ver: VER,
      mode: 'page',
      call: function (method, params) {
        return Promise.resolve()
          .then(function () { return dispatch(method, params); })
          .catch(function (err) {
            fail('rpc.' + method, err);
            return { ok: false, reason: 'hook_not_ready', detail: String((err && err.message) || err) };
          });
      },
    };

    window[PAGE_GLOBAL] = api;
    window[BRIDGE_GLOBAL] = bridge;

    /* ---------------------------------------------------------------- *
     * 启动
     * ---------------------------------------------------------------- */
    try {
      loadWatermarks();
      arm();
      try { state.activeUid = resolveActiveUid(); } catch (e) {}
      if (workbenchExtra() && typeof workbenchExtra().get === 'function') refreshShopId();
      var lastScan = 0;
      addTimer(function () {
        var now = Date.now();
        if (now - lastScan < CONF.scanThrottleMs) return;
        lastScan = now;
        try {
          if (!state.armed) arm();
          scanDom();
        } catch (e) {
          fail('scanDom.timer', e);
        }
      }, CONF.pollMs);
      try {
        state.mo = new MutationObserver(function () {
          try { scanDom(); } catch (e) {}
        });
        state.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
      api.scanNow();
      log('已启动 v' + VER + '，message$ + DOM 双通道采集 + 持久化水位');
    } catch (e) {
      state.lastError = '启动失败: ' + ((e && e.message) || e);
      warn('启动失败', e);
    }
    return api;
  }

  /* ================================================================== *
   * 容器模式
   * ================================================================== */
  function installContainerMode() {
    var SCRIPT_SRC = '';
    try {
      SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
    } catch (e) {}

    var state = {
      ver: VER,
      mode: 'container',
      source: '',
      sourceAt: 0,
      // 目标记录（不是裸 webview 元素）：
      //   {el,key,attached,stale,bridgePresent,injectedAt,lastOkAt,lastProbeAt,
      //    injections,reinjects,failures,injecting,destroyed}
      // bridge_missing / 路由切换 / 页面 reload 后必须能定位到同一个 el 重新注入，
      // 因此记录挂在元素 expando 上，缓存移除后还能通过 discover 复用。
      targets: [],
      webviewFound: false,
      lastCollection: { at: 0, source: 'none', shopId: '', page: null },
      timer: null,
      healthTimer: null,
      ws: null,
      wsUrl: '',
      wsTimer: null,
      lastError: '',
      routeTimer: null,
      routeWatchBound: false,
      routeListener: null,
      historyWrapped: false,
      origPushState: null,
      origReplaceState: null,
      stats: {
        webviews: 0,
        injected: 0,
        reinjects: 0,
        healthProbes: 0,
        calls: 0,
        lastReinjectAt: 0,
        lastReinjectReason: '',
        startedAt: Date.now(),
      },
    };

    function log() {
      try {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('%c[DOUDIAN-BRIDGE/CONTAINER]', 'color:#ff5b36;font-weight:600');
        console.log.apply(console, args);
      } catch (e) {}
    }
    function warn() {
      try {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('%c[DOUDIAN-BRIDGE/CONTAINER]', 'color:#ff9f0a;font-weight:600');
        console.warn.apply(console, args);
      } catch (e) {}
    }
    function fail(where, err) {
      state.lastError = where + ': ' + ((err && (err.stack || err.message)) || err);
      warn(where, err);
    }
    function parseJson(v) {
      if (v && typeof v === 'object') return v;
      if (typeof v !== 'string') return null;
      try { return JSON.parse(v); } catch (e) { return null; }
    }
    function isImWebviewSrc(el) {
      var src = '';
      try { src = String(el.src || el.getAttribute('src') || ''); } catch (e) {}
      return src.indexOf('im.jinritemai.com') >= 0 || src.indexOf('darenim.jinritemai.com') >= 0;
    }
    function targetKey(el, index) {
      try {
        if (el.__deskDoudianKey) return el.__deskDoudianKey;
      } catch (e) {}
      var raw = '';
      try {
        raw =
          el.getAttribute('data-id') ||
          el.getAttribute('data-webview-key') ||
          el.id ||
          el.getAttribute('partition') ||
          el.getAttribute('src') ||
          '';
      } catch (e2) {}
      var key = raw ? String(raw).slice(-48) : 'webview-' + (index + 1);
      try { el.__deskDoudianKey = key; } catch (e3) {}
      return key;
    }
    function recordOf(el) {
      try {
        return (el && el.__deskDoudianTarget) || null;
      } catch (e) {
        return null;
      }
    }
    function bindTargetEvents(rec) {
      if (!rec || rec.navBound) return;
      var el = rec.el;
      if (!el || typeof el.addEventListener !== 'function') return;
      rec.navBound = true;
      try {
        // 子页 reload / 站内跳转：旧 target 里的 bridge 一定没了，主动作废。
        el.addEventListener('did-navigate', function () {
          invalidateTarget(rec, 'did-navigate');
          scheduleRecover(rec, 'did-navigate', 350);
        });
        el.addEventListener('did-navigate-in-page', function () {
          invalidateTarget(rec, 'did-navigate-in-page');
          scheduleRecover(rec, 'did-navigate-in-page', 350);
        });
        // 新页面 ready 时重新握手，bridge 缺失就注入。
        el.addEventListener('dom-ready', function () {
          scheduleRecover(rec, 'dom-ready', 200);
        });
        el.addEventListener('destroyed', function () {
          dropTarget(rec, 'destroyed');
        });
      } catch (e) {
        fail('bindTargetEvents', e);
      }
    }
    function createRecord(el, index) {
      var rec = {
        el: el,
        key: targetKey(el, index),
        attached: true,
        stale: false,
        bridgePresent: false,
        injectedAt: 0,
        lastOkAt: 0,
        lastProbeAt: 0,
        lastRecoverAt: 0,
        injections: 0,
        reinjects: 0,
        failures: 0,
        injecting: false,
        destroyed: false,
        navBound: false,
      };
      try { el.__deskDoudianTarget = rec; } catch (e) {}
      bindTargetEvents(rec);
      return rec;
    }
    function invalidateTarget(rec, reason) {
      if (!rec || rec.destroyed) return;
      rec.stale = true;
      rec.bridgePresent = false;
      rec.injectedAt = 0;
      rec.lastStaleReason = String(reason || '');
    }
    function detachTarget(rec) {
      var i = state.targets.indexOf(rec);
      if (i >= 0) state.targets.splice(i, 1);
    }
    function dropTarget(rec, reason) {
      if (!rec) return;
      rec.destroyed = true;
      rec.bridgePresent = false;
      rec.stale = true;
      rec.lastStaleReason = String(reason || 'destroyed');
      detachTarget(rec);
    }
    function discover() {
      var found = [];
      try {
        var list = document.getElementsByTagName('webview');
        for (var i = 0; i < list.length; i++) {
          if (isImWebviewSrc(list[i])) found.push(list[i]);
        }
      } catch (e) {}
      // webviewFound 只反映「本轮 DOM 查找」；缓存 targets 只用于继续采集与排障。
      state.webviewFound = found.length > 0;
      state.stats.webviews = found.length;

      var out = [];
      for (var j = 0; j < found.length && out.length < CONF.containerMaxTargets; j++) {
        var rec = recordOf(found[j]);
        if (!rec || rec.destroyed) rec = createRecord(found[j], j);
        rec.attached = true;
        out.push(rec);
      }
      var cached = state.targets || [];
      var now = Date.now();
      for (var k = 0; k < cached.length && out.length < CONF.containerMaxTargets; k++) {
        var t = cached[k];
        if (!t || !t.el || t.destroyed || out.indexOf(t) >= 0) continue;
        // 元素可能已从文档移除（真机切视图时容器会重建 DOM）。
        // 只要 bridge 还在、或最近仍能成功调用，就继续复用，避免误判 hook_not_ready。
        var stillUseful =
          t.bridgePresent === true || (t.lastOkAt > 0 && now - t.lastOkAt < CONF.containerDetachedTtlMs);
        if (!stillUseful) continue;
        t.attached = false;
        out.push(t);
      }
      state.targets = out;
      return out;
    }
    /** 统一的容器诊断字段：core/排障只看这一层即可。 */
    function targetDiag() {
      return state.targets.map(function (rec) {
        return {
          webviewKey: rec.key,
          bridgePresent: rec.bridgePresent === true,
          lastOkAt: Number(rec.lastOkAt) || 0,
          reinjects: Number(rec.reinjects) || 0,
          attached: rec.attached === true,
          stale: rec.stale === true,
          lastProbeAt: Number(rec.lastProbeAt) || 0,
          failures: Number(rec.failures) || 0,
          staleReason: rec.lastStaleReason || '',
        };
      });
    }
    function diag(extra) {
      var injectedTargets = 0;
      for (var i = 0; i < state.targets.length; i++) {
        if (state.targets[i].bridgePresent === true) injectedTargets++;
      }
      var base = {
        ver: VER,
        mode: 'container',
        webviewFound: state.webviewFound === true,
        webviewCount: state.stats.webviews,
        // 兼容旧调用方：targetCount 是可加总的数字；targets 是排障明细数组。
        targetCount: state.targets.length,
        targets: targetDiag(),
        injectedTargets: injectedTargets,
        reinjects: state.stats.reinjects,
        healthProbes: state.stats.healthProbes,
        lastReinjectAt: state.stats.lastReinjectAt,
        lastReinjectReason: state.stats.lastReinjectReason,
        ws: state.ws ? 1 : 0,
      };
      if (extra) {
        for (var k in extra) base[k] = extra[k];
      }
      return base;
    }
    function isUsableRow(row) {
      return !!row && typeof row === 'object' && row.ok !== false;
    }
    /**
     * 采集可用性判定（不依赖 webview 是否还挂在 DOM 上）：
     *   - armed（message$ / _messagesUpsert$ 订阅成功）        → store
     *   - pending > 0 / frames > 0 / ingested > 0              → store
     *   - domScans > 0（DOM 兜底扫描成功过）                    → dom
     *   - hasIm / hasMessage$（页面 IM 对象存在）               → store
     * page-mode 的 stats() 是纯诊断对象、没有 ok 字段，这里按内容判定。
     */
    function collectionOf(row) {
      if (!row || typeof row !== 'object' || row.ok === false) return '';
      if (row.armed === true) return 'store';
      var pending = Number(row.pending);
      var frames = Number(row.frames);
      var ingested = Number(row.ingested);
      var domScans = Number(row.domScans);
      if (pending > 0 || frames > 0 || ingested > 0) return 'store';
      if (domScans > 0) return 'dom';
      if (row.hasIm === true || row.hasMessage$ === true) return 'store';
      return '';
    }
    function rememberCollection(source, shopId, page) {
      state.lastCollection = {
        at: Date.now(),
        source: source || 'none',
        shopId: String(shopId || ''),
        page: page || null,
      };
    }
    /**
     * 重新注入所需的源码地址（不写死任何远端地址）：
     *   1) 当前 <script src>（服务端会在响应体内联一次性 token）；
     *   2) 已注入的 ws 地址反推 http 同源脚本地址（容器被 executeJavaScript 注入时 SCRIPT_SRC 为空）。
     */
    function sourceUrls() {
      var out = [];
      if (SCRIPT_SRC) out.push(SCRIPT_SRC);
      try {
        var ws = window.__DESK_V1_DOUDIAN_WS__ ? String(window.__DESK_V1_DOUDIAN_WS__) : '';
        if (ws) {
          var u = new URL(ws);
          var token = u.searchParams.get('token');
          var url = u.origin + '/doudian-bridge.js' + (token ? '?token=' + encodeURIComponent(token) : '');
          if (out.indexOf(url) < 0) out.push(url);
        }
      } catch (e) {}
      return out;
    }
    async function loadSource() {
      var now = Date.now();
      if (state.source && now - state.sourceAt < 10000) return state.source;
      if (window.__DESK_DOUDIAN_BRIDGE_SOURCE__) {
        state.source = String(window.__DESK_DOUDIAN_BRIDGE_SOURCE__);
        state.sourceAt = now;
        return state.source;
      }
      var urls = sourceUrls();
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = await fetch(urls[i], { credentials: 'omit' });
          if (res.ok) {
            state.source = await res.text();
            state.sourceAt = now;
            return state.source;
          }
        } catch (e) {
          fail('loadSource', e);
        }
      }
      return '';
    }
    /**
     * 握手表达式：版本标记 + bridge 全局。
     * 注意 `/*desk-v1-handshake*\/` 是离线 fixture 识别探针的稳定标记，
     * 真机页面只是普通注释，不影响执行。
     */
    function handshakeExpr() {
      return `(function () { /*desk-v1-handshake*/
        var b = window.__deskDoudianBridge;
        return {
          ver: Number(window.__DESK_DOUDIAN_VER) || 0,
          marker: Number(window.__DESK_DOUDIAN_VER) === ${VER},
          bridge: !!(b && typeof b.call === 'function'),
          mode: (window.__deskDoudian && window.__deskDoudian.mode) || ''
        };
      })()`;
    }
    async function probeTarget(rec) {
      if (!rec || !rec.el || rec.destroyed) return false;
      state.stats.healthProbes++;
      try {
        var hs = await rec.el.executeJavaScript(handshakeExpr(), true);
        rec.lastProbeAt = Date.now();
        rec.bridgePresent = !!(hs && hs.bridge === true);
        if (rec.bridgePresent) {
          rec.stale = false;
          rec.lastOkAt = Date.now();
          rec.failures = 0;
        }
        return rec.bridgePresent;
      } catch (e) {
        rec.lastProbeAt = Date.now();
        rec.bridgePresent = false;
        fail('probe', e);
        return false;
      }
    }
    /**
     * 确保目标已注入。force=true 表示页面已确认失效（bridge_missing / reload / 路由切换），
     * 不做“看起来已注入”的短路，直接重下发源码并重新握手。
     */
    async function ensureInjected(rec, force) {
      if (!rec || !rec.el || rec.destroyed) return false;
      if (rec.injecting) return rec.bridgePresent === true;
      if (!force && rec.bridgePresent === true && rec.stale !== true) return true;
      if (!force) {
        // 新发现的 target 或状态未知：先握手，避免对已注入页面重复下发源码。
        var present = await probeTarget(rec);
        if (present) return true;
      }
      var source = await loadSource();
      if (!source) return false;
      rec.injecting = true;
      try {
        await rec.el.executeJavaScript(source, true);
        rec.injections = (rec.injections || 0) + 1;
        rec.reinjects = rec.injections > 1 ? rec.injections - 1 : 0;
        state.stats.injected++;
        if (rec.injections > 1) {
          state.stats.reinjects++;
          state.stats.lastReinjectAt = Date.now();
          state.stats.lastReinjectReason = rec.lastStaleReason || '';
        }
        var hs = await rec.el.executeJavaScript(handshakeExpr(), true);
        rec.lastProbeAt = Date.now();
        if (hs && hs.bridge === true) {
          rec.bridgePresent = true;
          rec.stale = false;
          rec.injectedAt = Date.now();
          rec.lastOkAt = Date.now();
          rec.failures = 0;
          return true;
        }
        rec.bridgePresent = false;
        rec.failures++;
        return false;
      } catch (e) {
        fail('inject', e);
        rec.bridgePresent = false;
        rec.failures++;
        return false;
      } finally {
        rec.injecting = false;
      }
    }
    /**
     * 目标失效后的恢复：标记 stale → 从缓存移除 → 重新 discover → 重新注入 → 重新握手。
     * 元素已不在 DOM 时仍直接对原元素重注入（owner 可能只是切了视图，guest 还活着）。
     */
    async function recoverTarget(rec, reason) {
      if (!rec || !rec.el || rec.destroyed) return false;
      var now = Date.now();
      invalidateTarget(rec, reason);
      detachTarget(rec);
      discover();
      var again = recordOf(rec.el) || rec;
      var minGap = CONF.containerRecoverMinGapMs;
      if (again.lastRecoverAt && now - again.lastRecoverAt < minGap && again.bridgePresent !== true) {
        return false;
      }
      again.lastRecoverAt = now;
      var ok = await ensureInjected(again, true);
      if (ok) {
        if (state.targets.indexOf(again) < 0 && state.targets.length < CONF.containerMaxTargets) {
          state.targets.push(again);
        }
        log('已恢复 target=' + again.key + ' reason=' + reason + ' reinjects=' + again.reinjects);
      } else {
        warn('恢复失败 target=' + again.key + ' reason=' + reason + ' injections=' + again.injections);
      }
      return ok;
    }
    function scheduleRecover(rec, reason, delayMs) {
      setTimeout(function () {
        recoverTarget(rec, reason).catch(function (e) {
          fail('recover.' + reason, e);
        });
      }, Number(delayMs) > 0 ? Number(delayMs) : 250);
    }
    function isBridgeMissing(row) {
      if (!row || typeof row !== 'object') return false;
      if (row.ok !== false) return false;
      var text = String(row.detail || '') + ' ' + String(row.reason || '');
      return /bridge_missing|bridge_not_installed|bridge_undefined/i.test(text);
    }
    function callExpr(method, params) {
      return `(async () => {
        const b = window.__deskDoudianBridge;
        if (!b || typeof b.call !== 'function') return { ok: false, reason: 'hook_not_ready', detail: 'bridge_missing' };
        return await b.call(${JSON.stringify(method)}, ${JSON.stringify(params || {})});
      })()`;
    }
    /**
     * 转发单次调用。任何 bridge_missing / 执行失败都会触发一次“失效→重注入→重试”，
     * 重试后仍失败则返回明确的 bridge_missing + reinjectAttempts，供 core 排障区分
     * 「页面没恢复」与「页面在但业务失败」。
     */
    async function callWebview(rec, method, params, opts) {
      var maxReinject = opts && Number(opts.maxReinject) >= 0 ? Number(opts.maxReinject) : CONF.containerMaxReinject;
      var attempts = 0;
      for (;;) {
        var raw;
        try {
          raw = await rec.el.executeJavaScript(callExpr(method, params), true);
        } catch (e) {
          var execDetail = 'execute_failed:' + String((e && e.message) || e);
          if (attempts >= maxReinject) {
            return { ok: false, reason: 'hook_not_ready', detail: execDetail, reinjectAttempts: attempts };
          }
          attempts++;
          var recovered = await recoverTarget(rec, 'execute_failed');
          if (!recovered) {
            return { ok: false, reason: 'hook_not_ready', detail: execDetail, reinjectAttempts: attempts };
          }
          continue;
        }
        var row = typeof raw === 'string' ? parseJson(raw) : raw;
        row = row || { ok: false, reason: 'hook_not_ready', detail: 'empty_result' };
        if (isBridgeMissing(row)) {
          if (attempts >= maxReinject) {
            return {
              ok: false,
              reason: 'hook_not_ready',
              detail: 'bridge_missing',
              reinjectAttempts: attempts,
              reinjectFailed: true,
            };
          }
          attempts++;
          var okNow = await recoverTarget(rec, 'bridge_missing');
          if (!okNow) {
            return {
              ok: false,
              reason: 'hook_not_ready',
              detail: 'bridge_missing',
              reinjectAttempts: attempts,
              reinjectFailed: true,
            };
          }
          continue;
        }
        if (row && row.ok !== false) rec.lastOkAt = Date.now();
        if (attempts > 0 && row && typeof row === 'object') {
          row.reinjectAttempts = attempts;
          row.reinjected = true;
        }
        return row;
      }
    }
    /** 定期健康检查：不看 <webview> 是否在 DOM，只看页面里的 bridge 是否还活着。 */
    function healthCheck() {
      var list = state.targets.slice();
      var now = Date.now();
      for (var i = 0; i < list.length; i++) {
        (function (rec) {
          if (!rec || rec.destroyed || rec.injecting) return;
          if (now - (rec.lastProbeAt || 0) < CONF.containerHealthMinGapMs) return;
          probeTarget(rec)
            .then(function (present) {
              if (present) return null;
              return recoverTarget(rec, 'health_probe');
            })
            .catch(function (e) {
              fail('health', e);
            });
        })(list[i]);
      }
    }
    /**
     * 容器页 SPA 路由变化：IM 子页可能被整体替换，旧 target 主动作废。
     * 这里只做“标记 + 重注入”，不做页面导航，避免改变容器行为。
     */
    function onContainerRoute(reason) {
      if (state.routeTimer) return;
      state.routeTimer = setTimeout(function () {
        state.routeTimer = null;
        var list = state.targets.slice();
        for (var i = 0; i < list.length; i++) invalidateTarget(list[i], reason);
        discover();
        var next = state.targets.slice();
        for (var j = 0; j < next.length; j++) {
          (function (rec) {
            recoverTarget(rec, reason).catch(function (e) {
              fail('route.recover', e);
            });
          })(next[j]);
        }
      }, CONF.containerRouteDebounceMs);
    }
    function watchContainerRoute() {
      if (state.routeWatchBound) return;
      state.routeWatchBound = true;
      try {
        window.addEventListener('hashchange', function () { onContainerRoute('container_hashchange'); });
        window.addEventListener('popstate', function () { onContainerRoute('container_popstate'); });
        state.origPushState = window.history && window.history.pushState;
        state.origReplaceState = window.history && window.history.replaceState;
        if (typeof state.origPushState === 'function') {
          window.history.pushState = function () {
            var ret = state.origPushState.apply(window.history, arguments);
            try { onContainerRoute('container_pushState'); } catch (e) {}
            return ret;
          };
        }
        if (typeof state.origReplaceState === 'function') {
          window.history.replaceState = function () {
            var ret = state.origReplaceState.apply(window.history, arguments);
            try { onContainerRoute('container_replaceState'); } catch (e) {}
            return ret;
          };
        }
        state.historyWrapped = true;
      } catch (e) {
        fail('watchContainerRoute', e);
      }
    }
    /**
     * 采集探针：页面 ensure 失败时用它确认「队列/采集是否仍然可用」。
     * 这是修复 im_webview_not_ready 误判的核心：
     * 只要 pendingSnapshot 能工作、stats 显示已 armed / 有采集计数，就视为就绪。
     */
    async function probeCollection(wv) {
      if (!(await ensureInjected(wv))) return null;
      var stats = null;
      try {
        stats = await callWebview(wv, 'stats', {});
      } catch (e) {
        fail('probe.stats', e);
      }
      var source = collectionOf(stats);
      if (source) {
        return { source: source, shopId: (stats && stats.shopId) || '', page: stats, via: 'stats' };
      }
      var st = null;
      try {
        st = await callWebview(wv, 'selfTest', {});
      } catch (e2) {
        fail('probe.selfTest', e2);
      }
      source = collectionOf(st);
      if (source) {
        return { source: source, shopId: (st && st.shopId) || '', page: st, via: 'selfTest' };
      }
      // 队列可达（即使当前为空）说明页面 hook 已安装；只有 count>0 才算「采集可用」。
      try {
        var snap = await callWebview(wv, 'pendingSnapshot', {});
        if (snap && snap.ok !== false && Number(snap.count) > 0) {
          return { source: 'store', shopId: '', page: snap, via: 'pendingSnapshot' };
        }
      } catch (e3) {
        fail('probe.pendingSnapshot', e3);
      }
      return null;
    }
    async function ensureAll(list, p) {
      var attempted = 0;
      var ready = false;
      var armed = false;
      var collection = '';
      var shop = '';
      var via = '';
      var lastFail = null;
      for (var i = 0; i < list.length; i++) {
        if (!(await ensureInjected(list[i]))) {
          lastFail = { detail: 'bridge_missing', reinjectAttempts: list[i].reinjects || 0 };
          continue;
        }
        attempted++;
        var r = null;
        try {
          r = await callWebview(list[i], 'ensure', p);
        } catch (e) {
          fail('ensure.webview', e);
        }
        if (r && r.ok === true) {
          ready = true;
          armed = r.armed !== false;
          collection = r.collection || (armed ? 'store' : '');
          shop = r.shopId || shop;
          via = 'ensure';
          rememberCollection(collection || 'store', shop, r);
          continue;
        }
        if (isBridgeMissing(r)) lastFail = r;
        // 页面 ensure 说未就绪：用采集探针复核，避免 DOM 兜底已能采集却整体判死。
        var probe = await probeCollection(list[i]);
        if (probe) {
          ready = true;
          armed = false;
          collection = probe.source;
          shop = probe.shopId || shop;
          via = probe.via;
          rememberCollection(probe.source, shop, probe.page);
        }
      }
      if (ready) {
        return diag({
          ok: true,
          shopId: shop,
          armed: armed,
          collection: collection || 'store',
          via: via || 'probe',
        });
      }
      if (lastFail) {
        return diag({
          ok: false,
          reason: 'hook_not_ready',
          detail: 'bridge_missing',
          reinjectAttempts: Number(lastFail.reinjectAttempts) || 0,
          collection: 'none',
        });
      }
      return diag({
        ok: false,
        reason: 'hook_not_ready',
        detail: attempted ? 'im_webview_not_ready' : 'no_im_webview',
        collection: 'none',
      });
    }
    async function collectStats(list) {
      var page = null;
      var lastFail = null;
      for (var i = 0; i < list.length; i++) {
        if (!(await ensureInjected(list[i]))) {
          lastFail = { detail: 'bridge_missing', reinjectAttempts: list[i].reinjects || 0 };
          continue;
        }
        try {
          var r = await callWebview(list[i], 'stats', {});
          if (isUsableRow(r)) {
            page = r;
            break;
          }
          if (isBridgeMissing(r)) lastFail = r;
        } catch (e) {
          fail('stats.webview', e);
        }
      }
      if (!page) {
        if (lastFail) {
          return diag({
            ok: false,
            reason: 'hook_not_ready',
            detail: 'bridge_missing',
            reinjectAttempts: Number(lastFail.reinjectAttempts) || 0,
            collection: 'none',
          });
        }
        return diag({ ok: false, reason: 'hook_not_ready', detail: 'im_webview_not_ready', collection: 'none' });
      }
      var source = collectionOf(page) || 'none';
      rememberCollection(source, page.shopId, page);
      return diag({
        ok: true,
        collection: source,
        armed: page.armed === true,
        pending: Number(page.pending) || 0,
        ingested: Number(page.ingested) || 0,
        domScans: Number(page.domScans) || 0,
        shopId: page.shopId || '',
        page: page,
      });
    }
    async function collectSelfTest(list) {
      var page = null;
      var lastFail = null;
      for (var i = 0; i < list.length; i++) {
        if (!(await ensureInjected(list[i]))) {
          lastFail = { detail: 'bridge_missing', reinjectAttempts: list[i].reinjects || 0 };
          continue;
        }
        try {
          var r = await callWebview(list[i], 'selfTest', {});
          if (isUsableRow(r)) {
            page = r;
            break;
          }
          if (isBridgeMissing(r)) lastFail = r;
        } catch (e) {
          fail('selfTest.webview', e);
        }
      }
      if (!page) {
        if (lastFail) {
          return diag({
            ok: false,
            reason: 'hook_not_ready',
            detail: 'bridge_missing',
            reinjectAttempts: Number(lastFail.reinjectAttempts) || 0,
            collection: 'none',
          });
        }
        return diag({ ok: false, reason: 'hook_not_ready', detail: 'im_webview_not_ready', collection: 'none' });
      }
      var source = collectionOf(page) || 'none';
      rememberCollection(source, page.shopId, page);
      return diag({
        ok: true,
        collection: source,
        armed: page.armed === true,
        shopId: page.shopId || '',
        page: page,
        selfTest: page,
      });
    }
    async function scanAll(list) {
      // 语义：触发一次采集扫描。没有子 webview 可扫时是 no-op，不是整体失败；
      // 有缓存目标（webviewFound:false）时仍继续扫，保证不影响已能采集的店铺。
      if (!list.length) {
        return diag({ ok: true, scanned: 0, skipped: 'no_im_webview', collection: 'none' });
      }
      var scanned = 0;
      var page = null;
      var lastErr = '';
      var lastMissing = null;
      for (var i = 0; i < list.length; i++) {
        if (!(await ensureInjected(list[i]))) {
          lastMissing = { reinjectAttempts: list[i].reinjects || 0 };
          continue;
        }
        try {
          var r = await callWebview(list[i], 'scanNow', {});
          if (isUsableRow(r)) {
            scanned++;
            page = r;
          } else if (isBridgeMissing(r)) {
            lastMissing = r;
            lastErr = 'bridge_missing';
          } else {
            lastErr = String((r && (r.detail || r.reason)) || 'scan_failed');
          }
        } catch (e) {
          lastErr = String((e && e.message) || e);
        }
      }
      if (!scanned) {
        if (lastMissing) {
          return diag({
            ok: false,
            reason: 'hook_not_ready',
            detail: 'bridge_missing',
            reinjectAttempts: Number(lastMissing.reinjectAttempts) || 0,
            collection: 'none',
          });
        }
        return diag({ ok: false, reason: 'hook_not_ready', detail: lastErr || 'im_webview_not_ready', collection: 'none' });
      }
      var source = collectionOf(page) || state.lastCollection.source || 'none';
      rememberCollection(source, page && page.shopId, page);
      return diag({ ok: true, scanned: scanned, collection: source, page: page });
    }
    async function routeAll(list, method, p) {
      var mismatch = 0;
      var attempted = 0;
      var lastFail = null;
      for (var j = 0; j < list.length; j++) {
        if (!(await ensureInjected(list[j]))) {
          lastFail = {
            ok: false,
            reason: 'hook_not_ready',
            detail: 'bridge_missing',
            reinjectAttempts: list[j].reinjects || 0,
          };
          continue;
        }
        attempted++;
        var row = null;
        try {
          row = await callWebview(list[j], method, p);
        } catch (e) {
          lastFail = { ok: false, reason: 'hook_not_ready', detail: String((e && e.message) || e) };
          continue;
        }
        if (!row || row.ok !== false) {
          // 成功（含 popPending 的裸行、数组、以及 stats/selfTest 这类无 ok 的诊断对象）
          if (!row) return { ok: true };
          if (Array.isArray(row)) return row;
          if (typeof row !== 'object') return { ok: true, page: row };
          if (row.ok === true) return row;
          if (row.uid !== undefined) return Object.assign({ ok: true }, row);
          return Object.assign({ ok: true }, row);
        }
        // 页面明确失败：店铺不匹配时继续尝试下一个 webview；其它失败必须原样透传，
        // 不能再被末尾统一改写成 hook_not_ready（sendText 的 4 个枚举会被吞掉）。
        if (/shop_mismatch|mismatch/i.test(String(row.detail || row.reason || ''))) {
          mismatch++;
          continue;
        }
        lastFail = row;
        if (row.reason !== 'hook_not_ready') return row;
      }
      if (method === 'sendText' && mismatch && !lastFail) {
        return { ok: false, reason: 'input_not_found', detail: '未找到这家店的客服页' };
      }
      if (lastFail) return lastFail;
      return diag({
        ok: false,
        reason: 'hook_not_ready',
        detail: attempted ? 'im_webview_not_ready' : 'no_im_webview',
        collection: 'none',
      });
    }
    async function dispatch(method, params) {
      var p = params || {};
      state.stats.calls++;
      var list = discover();
      if (method === 'scanNow') return scanAll(list);
      if (!list.length) {
        return diag({ ok: false, reason: 'hook_not_ready', detail: 'no_im_webview', collection: 'none' });
      }
      if (method === 'ensure') return ensureAll(list, p);
      if (method === 'stats') return collectStats(list);
      if (method === 'selfTest') return collectSelfTest(list);
      return routeAll(list, method, p);
    }

    var bridge = {
      ver: VER,
      mode: 'container',
      call: function (method, params) {
        return Promise.resolve()
          .then(function () { return dispatch(method, params); })
          .catch(function (err) {
            fail('rpc.' + method, err);
            return diag({ ok: false, reason: 'hook_not_ready', detail: String((err && err.message) || err), collection: 'none' });
          });
      },
      stats: function () {
        return diag({
          ok: true,
          webviews: state.stats.webviews,
          injected: state.stats.injected,
          reinjects: state.stats.reinjects,
          healthProbes: state.stats.healthProbes,
          calls: state.stats.calls,
          lastReinjectAt: state.stats.lastReinjectAt,
          lastReinjectReason: state.stats.lastReinjectReason,
          collection: state.lastCollection.source,
          collectionShopId: state.lastCollection.shopId,
          lastError: state.lastError,
        });
      },
      // 测试/集成用：直接取 IM 页里的 hook 对象
      callPage: function (method, params) {
        return dispatch(method, params);
      },
      dispose: function () {
        if (state.timer) {
          try { clearInterval(state.timer); } catch (e) {}
          state.timer = null;
        }
        if (state.healthTimer) {
          try { clearInterval(state.healthTimer); } catch (e) {}
          state.healthTimer = null;
        }
        if (state.routeTimer) {
          try { clearTimeout(state.routeTimer); } catch (e) {}
          state.routeTimer = null;
        }
        if (state.wsTimer) {
          try { clearTimeout(state.wsTimer); } catch (e) {}
          state.wsTimer = null;
        }
        if (state.ws) {
          try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
          state.ws = null;
        }
        try {
          if (state.historyWrapped) {
            if (state.origPushState) window.history.pushState = state.origPushState;
            if (state.origReplaceState) window.history.replaceState = state.origReplaceState;
          }
        } catch (e2) {}
        state.routeWatchBound = false;
        state.historyWrapped = false;
        for (var i = 0; i < state.targets.length; i++) {
          try { state.targets[i].destroyed = true; } catch (e3) {}
        }
        state.targets = [];
      },
    };
    window[BRIDGE_GLOBAL] = bridge;

    function wsUrlFromConfig() {
      try {
        if (window.__DESK_V1_DOUDIAN_WS__) return String(window.__DESK_V1_DOUDIAN_WS__);
        if (SCRIPT_SRC) {
          var u = new URL(SCRIPT_SRC);
          var ws = u.searchParams.get('ws');
          if (ws) return ws;
        }
      } catch (e) {}
      return '';
    }
    function connectWs() {
      var url = wsUrlFromConfig();
      if (!url || typeof WebSocket !== 'function') return;
      state.wsUrl = url;
      try {
        var ws = new WebSocket(url);
        state.ws = ws;
        ws.onopen = function () {
          try { ws.send(JSON.stringify({ type: 'hi', role: 'doudian-container', ver: VER })); } catch (e) {}
          log('RPC 已连接 ' + url);
        };
        ws.onmessage = function (ev) {
          var msg = parseJson(ev && ev.data);
          if (!msg || !msg.id) return;
          dispatch(msg.method, msg.params).then(function (result) {
            try {
              ws.send(JSON.stringify({ id: msg.id, ok: result && result.ok !== false, result: result }));
            } catch (e) {}
          });
        };
        ws.onclose = function () {
          state.ws = null;
          if (state.wsTimer) return;
          state.wsTimer = setTimeout(function () {
            state.wsTimer = null;
            connectWs();
          }, CONF.wsReconnectMs);
        };
        ws.onerror = function () {};
      } catch (e) {
        fail('connectWs', e);
      }
    }

    try {
      discover();
      state.timer = setInterval(function () {
        try {
          var list = discover();
          for (var i = 0; i < list.length; i++) ensureInjected(list[i]);
        } catch (e) {
          fail('scanWebviews', e);
        }
      }, CONF.webviewScanMs);
      // 10~15s 轻量探针：不依赖 <webview> 是否还在 DOM，只看页面里的 bridge 是否活着。
      state.healthTimer = setInterval(function () {
        try { healthCheck(); } catch (e) { fail('healthCheck', e); }
      }, CONF.containerHealthMs);
      watchContainerRoute();
      connectWs();
      log('容器模式已启动 v' + VER + '（目标健康检查 ' + CONF.containerHealthMs + 'ms）');
    } catch (e) {
      state.lastError = '容器模式启动失败: ' + ((e && e.message) || e);
      warn('启动失败', e);
    }
    return bridge;
  }

  /* ================================================================== *
   * 入口
   * ================================================================== */
  try {
    if (isImPage()) installPageMode();
    else installContainerMode();
  } catch (e) {
    try {
      window.__DESK_DOUDIAN_VER = VER;
      console.error('[DOUDIAN-BRIDGE] 启动失败', e);
    } catch (e2) {}
  }
})();
