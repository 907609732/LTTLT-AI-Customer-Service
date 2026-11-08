'use strict';
/**
 * desk-v1 · pdd-web 适配器（Adapter Contract v2）
 *
 * 对齐：src/shared/adapter-contract.md / adapter-contract.js（CONTRACT_VERSION = 2）
 *   - 实例绑定单店，方法不接收 store。
 *   - accessMode = 'webview'：core 建 WebContentsView 并注入页面 hook。
 *   - 契约方法只返回 {ok:true} 或 {ok:false, reason:<4 个枚举之一>}；未知异常直接 throw。
 *   - 队列语义由页面 hook 的三表保证：popPending 认领 → release 归还 / discard 丢弃。
 *
 * 工厂入口在 src/adapters/index.js：createAdapter(store, deps)。
 * deps = { logger, config(只读快照), webContentsProvider(), secrets:{get,has}, dataDir }
 *
 * 平台实现细节（契约不关心）：
 *   - hook 全局名默认 window.__pddWeb；ensure() 自己负责注入与版本握手。
 *   - 发送主通道是页面 UI 注入；anti-content 只观测缓存，不生成签名。
 */

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../shared/adapter-contract');

const { ok, fail } = contract;

const PLATFORM_ID = 'pdd-web';
const PLATFORM_NAME = '拼多多商家后台（pdd-web）';
const ENTRY_URL = 'https://mms.pinduoduo.com/chat-merchant/index.html';
const HOOK_PATH = path.join(__dirname, '..', 'injections', 'pdd-web-hook.js');
const DEFAULT_HOOK_GLOBAL = '__pddWeb';
const VER_RE = /__PDD_WEB_VER\s*=\s*(\d+)/;
const VER_FALLBACK_RE = /\bvar\s+VER\s*=\s*(\d+)\s*;/;

const DEFAULT_TIMEOUTS = Object.freeze({
  ensure: 15000,
  read: 5000,
  prepare: 6000,
  popPending: 8000,
  send: 25000,
  sendMedia: 40000,
  sendVideo: 90000,
  history: 12000,
  card: 20000,
});

function versionOf(source) {
  const text = String(source || '');
  const m = VER_RE.exec(text) || VER_FALLBACK_RE.exec(text);
  return m ? Number(m[1]) : 0;
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || 'hook 调用'}超时（${ms}ms）`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeFrom(from) {
  const v = String(from || '').toLowerCase();
  if (v === 'buyer' || v === 'seller' || v === 'system') return v;
  return 'system';
}

function toMessage(raw) {
  const m = raw || {};
  const ts = Number(m.ts) || 0;
  return {
    msgId: String(m.msgId || `ts:${ts}`),
    from: normalizeFrom(m.from),
    type: String(m.type || 'text'),
    content: String(m.content == null ? '' : m.content),
    ts,
  };
}

function sanitizeRow(raw) {
  const row = raw || {};
  return {
    uid: String(row.uid),
    messages: (Array.isArray(row.messages) ? row.messages : [])
      .map(toMessage)
      .sort((a, b) => a.ts - b.ts),
    ...(row.username ? { username: String(row.username) } : {}),
    ...(row.goodsTitle ? { goodsTitle: String(row.goodsTitle) } : {}),
    ...(row.orderId ? { orderId: String(row.orderId) } : {}),
    claimedAt: Number(row.claimedAt) || Date.now(),
  };
}

class PddWebAdapter {
  constructor({ store, logger, config, getWebContents, webContentsProvider, injector } = {}) {
    this.id = PLATFORM_ID;
    this.accessMode = 'webview';
    this.platform = PLATFORM_ID;
    this.platformName = PLATFORM_NAME;
    this.store = store || null;
    this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
    this.config = config || {};
    this.injector = injector || null;

    this.hookGlobal = this.config.adapter?.hookGlobal || DEFAULT_HOOK_GLOBAL;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(this.config.adapter?.timeouts || {}) };
    this.maxInflight = this.config.reply?.maxInflight ?? 6;
    this.lastFailure = null;

    if (typeof getWebContents === 'function') this.provider = getWebContents;
    else if (typeof webContentsProvider === 'function') this.provider = () => webContentsProvider();
    else this.provider = null;

    this._hookCache = { mtime: 0, source: '', version: 0 };
  }

  /* ------------------------------------------------------------------ *
   * 契约 1/15：平台标识
   * ------------------------------------------------------------------ */
  supports(platformId) {
    return String(platformId || '').toLowerCase() === PLATFORM_ID;
  }

  /* ------------------------------------------------------------------ *
   * 内部：页面 / hook 访问
   * ------------------------------------------------------------------ */
  _wc() {
    let wc = null;
    try {
      wc = this.provider ? this.provider() : null;
    } catch (err) {
      const e = new Error(`pdd-web 页面不可用：${err?.message || err}`);
      e.reason = 'hook_not_ready';
      throw e;
    }
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
      const e = new Error('pdd-web 页面已销毁或未创建');
      e.reason = 'hook_not_ready';
      throw e;
    }
    return wc;
  }

  _hookSource() {
    const st = fs.statSync(HOOK_PATH);
    if (st.mtimeMs !== this._hookCache.mtime) {
      const source = fs.readFileSync(HOOK_PATH, 'utf8');
      const version = versionOf(source);
      if (!version) throw new Error(`pdd-web hook 缺少版本声明：${HOOK_PATH}`);
      this._hookCache = { mtime: st.mtimeMs, source, version };
    }
    return this._hookCache;
  }

  _buildExpr(method, args) {
    const parts = (args || []).map((a) => JSON.stringify(a === undefined ? null : a));
    return `(() => {
      const h = window[${JSON.stringify(this.hookGlobal)}];
      if (!h) throw new Error('pdd-web hook 未就绪');
      return h.${method}(${parts.join(', ')});
    })()`;
  }

  _mapReason(err) {
    if (!err) return null;
    if (err.reason && contract.isFailureReason(err.reason)) return err.reason;
    const msg = String(err.message || err);
    if (err.reason === 'hook_not_ready' || /hook 未就绪|未注入|页面已销毁|isDestroyed|destroyed|超时|timeout/i.test(msg)) {
      return 'hook_not_ready';
    }
    if (/input_not_found|conversation_not_found|会话不存在|输入框不存在/i.test(msg)) return 'input_not_found';
    if (/input_busy|输入框.*占用|editor_busy/i.test(msg)) return 'input_busy';
    if (/send_unconfirmed|发送未确认/i.test(msg)) return 'send_unconfirmed';
    return null;
  }

  _failOrThrow(method, err) {
    const reason = this._mapReason(err);
    const detail = String((err && (err.message || err)) || err || '').slice(0, 300);
    this.lastFailure = { method, reason, detail, at: Date.now() };
    if (!reason) {
      // 契约要求：未知异常直接抛，不伪装成业务失败
      throw err;
    }
    try {
      this.logger.warn(`[pdd-web] ${method} 失败（${reason}）：${detail}`);
    } catch (e) {}
    return fail(reason, detail);
  }

  async _probeVersion(wc) {
    const expr = `(window[${JSON.stringify(this.hookGlobal)}] && window[${JSON.stringify(
      this.hookGlobal,
    )}].ver) || 0`;
    const value = await withTimeout(wc.executeJavaScript(expr, true), this.timeouts.read, 'hook 探测');
    return Number(value) || 0;
  }

  async _callHook(method, args, { label, timeoutMs } = {}) {
    const wc = this._wc();
    const expr = this._buildExpr(method, args);
    const ms = timeoutMs || this.timeouts.read;
    const name = label || method;
    try {
      if (this.injector && typeof this.injector.call === 'function') {
        return await withTimeout(
          Promise.resolve(this.injector.call(wc, expr, { label: name, timeoutMs: ms })),
          ms,
          name,
        );
      }
      return await withTimeout(wc.executeJavaScript(expr, true), ms, name);
    } catch (err) {
      const reason = this._mapReason(err);
      const wrapped = new Error(`pdd-web.${name} 调用失败：${err?.message || err}`);
      // 页面上下文调用失败统一按「hook 未就绪」交给引擎重试；未知业务异常仍由上层抛
      wrapped.reason = reason || 'hook_not_ready';
      wrapped.cause = err;
      throw wrapped;
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 2/15：ensure
   * ------------------------------------------------------------------ */
  async ensure() {
    try {
      const wc = this._wc();
      const hook = this._hookSource();
      let version = await this._probeVersion(wc);
      if (version !== hook.version) {
        await withTimeout(wc.executeJavaScript(hook.source, true), this.timeouts.ensure, 'hook 注入');
        version = await this._probeVersion(wc);
        if (version !== hook.version) {
          return this._failOrThrow(
            'ensure',
            new Error(`hook 注入未生效（期望 v${hook.version}，实际 v${version}）`),
          );
        }
        try {
          this.logger.info?.(`[pdd-web] hook 已注入 v${hook.version}`);
        } catch (e) {}
      }
      return ok();
    } catch (err) {
      return this._failOrThrow('ensure', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 3/15：preparePending（只刷新视图，不认领）
   * ------------------------------------------------------------------ */
  async preparePending() {
    try {
      await this._callHook('scanNow', [], { label: 'preparePending', timeoutMs: this.timeouts.prepare });
      return ok();
    } catch (err) {
      return this._failOrThrow('preparePending', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 4/15：popPending → PendingRow | null
   * 契约 5/15：pendingSnapshot → { ok, count, uids }
   * ------------------------------------------------------------------ */
  async popPending() {
    let raw;
    try {
      raw = await this._callHook('popPending', [], {
        label: 'popPending',
        timeoutMs: this.timeouts.popPending,
      });
    } catch (err) {
      throw err; // popPending 一般不失败；页面不可用按异常抛给引擎
    }
    if (!raw || !raw.uid) return null;
    return sanitizeRow(raw);
  }

  async pendingSnapshot() {
    try {
      const raw = await this._callHook('pendingSnapshot', [], {
        label: 'pendingSnapshot',
        timeoutMs: this.timeouts.read,
      });
      const pending = raw && typeof raw === 'object' ? raw : {};
      const uids = Object.keys(pending).filter((uid) => !!uid);
      return ok({ count: uids.length, uids });
    } catch (err) {
      return this._failOrThrow('pendingSnapshot', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 6/15：conversationHistory
   * ------------------------------------------------------------------ */
  async conversationHistory(uid, opts = {}) {
    if (!uid) return fail('input_not_found', 'uid_required');
    const limit = Number(opts && opts.limit) > 0 ? Math.min(Number(opts.limit), 100) : 20;
    try {
      const list = await this._callHook('conversationHistory', [String(uid), limit], {
        label: 'conversationHistory',
        timeoutMs: this.timeouts.history,
      });
      const messages = (Array.isArray(list) ? list : []).map(toMessage).sort((a, b) => a.ts - b.ts);
      return ok({ messages: messages.slice(-limit) });
    } catch (err) {
      return this._failOrThrow('conversationHistory', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 7/15、8/15、9/15：发送（UI 注入优先，不在内部重试）
   * ------------------------------------------------------------------ */
  /** 发送类超时属于「结果未知」：按 send_unconfirmed 处理，禁止自动重发 */
  _sendFailOrThrow(method, err) {
    const detail = String((err && (err.message || err)) || err || '');
    if (/超时|timeout/i.test(detail)) return fail('send_unconfirmed', `发送结果未知：${detail}`);
    return this._failOrThrow(method, err);
  }

  async sendText(uid, text, opts = {}) {
    if (!uid) throw new TypeError('sendText: uid 不能为空');
    const content = String(text == null ? '' : text).trim();
    if (!content) throw new TypeError('sendText: text 不能为空');
    try {
      const raw = await this._callHook('sendText', [String(uid), content], {
        label: 'sendText',
        timeoutMs: Number(opts && opts.timeoutMs) || this.timeouts.send,
      });
      if (!raw || raw.ok !== true) {
        const reason = raw && raw.reason;
        if (contract.isFailureReason(reason)) return fail(reason, raw.detail);
        throw new Error(`sendText 未返回受控结果：${reason || 'unknown'}`);
      }
      return raw.msgId ? ok({ msgId: String(raw.msgId) }) : ok();
    } catch (err) {
      return this._sendFailOrThrow('sendText', err);
    }
  }

  async sendImage(uid, payload, opts = {}) {
    if (!uid) throw new TypeError('sendImage: uid 不能为空');
    const normalized = this._mediaPayload(payload, 'sendImage');
    try {
      const raw = await this._callHook('sendImage', [String(uid), normalized], {
        label: 'sendImage',
        timeoutMs: this.timeouts.sendMedia,
      });
      return this._mediaResult('sendImage', raw);
    } catch (err) {
      return this._sendFailOrThrow('sendImage', err);
    }
  }

  async sendVideo(uid, payload, opts = {}) {
    if (!uid) throw new TypeError('sendVideo: uid 不能为空');
    const normalized = this._mediaPayload(payload, 'sendVideo');
    try {
      const raw = await this._callHook('sendVideo', [String(uid), normalized], {
        label: 'sendVideo',
        timeoutMs: this.timeouts.sendVideo,
      });
      return this._mediaResult('sendVideo', raw);
    } catch (err) {
      return this._sendFailOrThrow('sendVideo', err);
    }
  }

  _mediaPayload(payload, method) {
    const p = payload || {};
    if (p.base64) {
      return { mode: 'base64', payload: String(p.base64), filename: p.filename || 'image.png', mime: p.mime };
    }
    if (p.url) {
      return { mode: 'url', payload: String(p.url), filename: p.filename || 'image.png', mime: p.mime };
    }
    if (p.dataUrl || p.payload) {
      const raw = String(p.dataUrl || p.payload);
      return {
        mode: raw.startsWith('data:') ? 'dataurl' : 'url',
        payload: raw,
        filename: p.filename || 'image.png',
        mime: p.mime,
      };
    }
    throw new TypeError(`${method}: payload 需要 url 或 base64`);
  }

  _mediaResult(method, raw) {
    if (!raw || raw.ok !== true) {
      const reason = raw && raw.reason;
      if (contract.isFailureReason(reason)) return fail(reason, raw.detail);
      throw new Error(`${method} 未返回受控结果：${reason || 'unknown'}`);
    }
    return raw.msgId ? ok({ msgId: String(raw.msgId) }) : ok();
  }

  /* ------------------------------------------------------------------ *
   * 契约 10/15：release（认领归还，幂等）
   * ------------------------------------------------------------------ */
  async release(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const released = await this._callHook('releasePendingClaim', [String(uid)], {
        label: 'release',
        timeoutMs: this.timeouts.read,
      });
      return ok({ released: released === true });
    } catch (err) {
      return this._failOrThrow('release', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 11/15：discard（支持 beforeTs 清理积压）
   * ------------------------------------------------------------------ */
  async discard(uid, opts = {}) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      await this._callHook('discardClaim', [String(uid)], {
        label: 'discard',
        timeoutMs: this.timeouts.read,
      });
      const beforeTs = Number(opts && opts.beforeTs) || 0;
      if (beforeTs > 0) {
        await this._callHook('discardBefore', [String(uid), beforeTs], {
          label: 'discard.beforeTs',
          timeoutMs: this.timeouts.read,
        });
      }
      return ok();
    } catch (err) {
      return this._failOrThrow('discard', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 12/15：popMerchantSent → MerchantSentRow[]
   * 返回后 hook 侧已清空该批次。
   * ------------------------------------------------------------------ */
  async popMerchantSent() {
    const raw = await this._callHook('popMerchantSent', [], {
      label: 'popMerchantSent',
      timeoutMs: this.timeouts.read,
    });
    const rows = Array.isArray(raw) ? raw : [];
    return rows
      .filter((r) => r && r.uid && r.message)
      .map((r) => ({ uid: String(r.uid), message: toMessage(r.message) }));
  }

  /* ------------------------------------------------------------------ *
   * 契约 13/15：syncAiEnabled
   * ------------------------------------------------------------------ */
  async syncAiEnabled(enabled) {
    try {
      await this._callHook('syncAiEnabled', [!!enabled], {
        label: 'syncAiEnabled',
        timeoutMs: this.timeouts.read,
      });
      return ok();
    } catch (err) {
      return this._failOrThrow('syncAiEnabled', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 契约 14/15：focusConversation
   * ------------------------------------------------------------------ */
  async focusConversation(uid, opts = {}) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const raw = await this._callHook('focusConversation', [String(uid), { raise: !!opts.raise }], {
        label: 'focusConversation',
        timeoutMs: this.timeouts.card,
      });
      if (raw && raw.ok === false) {
        return fail('input_not_found', raw.reason || 'conversation_not_found');
      }
      return ok();
    } catch (err) {
      return this._failOrThrow('focusConversation', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 允许的扩展（core 不依赖）
   * ------------------------------------------------------------------ */
  async probe() {
    try {
      const version = await this._probeVersion(this._wc());
      return ok({ version });
    } catch (err) {
      return this._failOrThrow('probe', err);
    }
  }

  async stats() {
    try {
      return ok({ stats: (await this._callHook('stats', [], { timeoutMs: this.timeouts.read })) || null });
    } catch (err) {
      return this._failOrThrow('stats', err);
    }
  }

  async selfTest() {
    try {
      return ok({ selfTest: (await this._callHook('selfTest', [], { timeoutMs: this.timeouts.read })) || null });
    } catch (err) {
      return this._failOrThrow('selfTest', err);
    }
  }

  async anti() {
    try {
      const anti = await this._callHook('anti', [], { timeoutMs: this.timeouts.read });
      return ok({ anti: anti || { value: '', ageMs: -1 } });
    } catch (err) {
      return this._failOrThrow('anti', err);
    }
  }

  async popSent(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const messages = await this._callHook('popSent', [String(uid)], { timeoutMs: this.timeouts.read });
      return ok({ messages: (Array.isArray(messages) ? messages : []).map(toMessage) });
    } catch (err) {
      return this._failOrThrow('popSent', err);
    }
  }

  /**
   * 非契约扩展（与 stats / popSent 同级）：只读消息事件出口。
   * 接口与 electron-core、抖店桥接固定一致：
   *   drainEvents({ sinceSeq }) -> { ok, seq, events:[{seq,uid,username,from,type,content,msgId,ts,goodsTitle}] }
   * 不清 pending、不影响 claim/sent；缺省 sinceSeq 时 hook 返回缓冲内最后 200 条。
   */
  async drainEvents(params = {}) {
    const rawSince = params ? params.sinceSeq : undefined;
    const hasSince =
      rawSince !== undefined && rawSince !== null && rawSince !== '' && Number.isFinite(Number(rawSince));
    const args = hasSince ? [{ sinceSeq: Math.max(0, Number(rawSince)) }] : [];
    try {
      const raw = await this._callHook('drainEvents', args, {
        label: 'drainEvents',
        timeoutMs: this.timeouts.read,
      });
      if (!raw || raw.ok !== true) {
        const err = new Error(`drainEvents 未返回受控结果：${(raw && raw.reason) || 'unknown'}`);
        err.reason = 'hook_not_ready';
        return this._failOrThrow('drainEvents', err);
      }
      return ok({
        seq: Number(raw.seq) || 0,
        events: Array.isArray(raw.events) ? raw.events : [],
      });
    } catch (err) {
      return this._failOrThrow('drainEvents', err);
    }
  }

  async lastCsReplyTs(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const ts = await this._callHook('lastCsReplyTs', [String(uid)], { timeoutMs: this.timeouts.read });
      return ok({ ts: Number(ts) || 0 });
    } catch (err) {
      return this._failOrThrow('lastCsReplyTs', err);
    }
  }

  async markTransferredOut(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      await this._callHook('markTransferredOut', [String(uid)], { timeoutMs: this.timeouts.read });
      return ok();
    } catch (err) {
      return this._failOrThrow('markTransferredOut', err);
    }
  }

  async consultGoods(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const goods = await this._callHook('consultGoods', [String(uid)], { timeoutMs: this.timeouts.history });
      return ok({ goods: goods || null });
    } catch (err) {
      return this._failOrThrow('consultGoods', err);
    }
  }

  async goodsContext(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const context = await this._callHook('goodsContext', [String(uid)], { timeoutMs: this.timeouts.read });
      return ok({ context: context || { goodsTitle: '', orderId: '', orderStatus: '' } });
    } catch (err) {
      return this._failOrThrow('goodsContext', err);
    }
  }

  async sendCouponByName(uid, name) {
    if (!uid || !name) throw new TypeError('sendCouponByName: uid/name 不能为空');
    try {
      const raw = await this._callHook('sendCouponByName', [String(uid), String(name)], {
        timeoutMs: this.timeouts.card,
      });
      return raw && raw.ok === true ? ok() : { ok: false, reason: (raw && raw.reason) || 'send_unconfirmed' };
    } catch (err) {
      return this._failOrThrow('sendCouponByName', err);
    }
  }

  async agreeModifyAddress(uid) {
    return this._card('agreeModifyAddress', uid);
  }

  async agreeOrderRemarks(uid) {
    return this._card('agreeOrderRemarks', uid);
  }

  async appealCashBack(uid) {
    return this._card('appealCashBack', uid);
  }

  async favoriteConversation(uid) {
    return this._card('favoriteConversation', uid);
  }

  async _card(method, uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    try {
      const raw = await this._callHook(method, [String(uid)], { timeoutMs: this.timeouts.card });
      return raw && raw.ok === true ? ok() : { ok: false, reason: (raw && raw.reason) || 'send_unconfirmed' };
    } catch (err) {
      return this._failOrThrow(method, err);
    }
  }

  async releaseResources() {
    return ok();
  }
}

module.exports = {
  PddWebAdapter,
  PLATFORM_ID,
  PLATFORM_NAME,
  ENTRY_URL,
  HOOK_PATH,
  versionOf,
};
