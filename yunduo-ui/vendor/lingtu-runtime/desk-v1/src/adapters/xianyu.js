'use strict';
/**
 * desk-v1 · 闲鱼适配器骨架（V1 仅网页版 xianyu）
 *
 * 契约：src/shared/adapter-contract.md / adapter-contract.js（CONTRACT_VERSION = 2）
 *   - accessMode = 'webview'（D-14）：V1 只做 https://www.goofish.com/im 单入口，
 *     core 负责建 WebContentsView、loadURL 并注入页面 hook。
 *   - 平台 id 只有 'xianyu'；卖家工作台 seller.goofish.com 与 dual-hook 形态
 *     属于 V1.5，本适配器不声明、不接收 'xianyu-seller'。
 *   - ensure() 在 hook 未注入时必须返回 hook_not_ready；不能抛异常。
 *
 * 当前状态：SKELETON / NOT IMPLEMENTED。
 *   - 读取/发送方法统一返回 hook_not_ready；popPending() 返回 null、popMerchantSent() 返回 []。
 *   - release()/discard() 在 uid 合法时幂等返回 ok（当前无 claim，空操作是真实的）。
 *
 * 现有实现事实（只读，仅作未来接入参考）：
 *   - 闲鱼网页版（www.goofish.com/im）注入 yunduo-xy-im-list-hook.js
 *     （适配器 id: "xianyu"）。
 *   - 全局名 __XY_IM_LIST__（另有 __XY_KF__ 兼容别名），状态 __XY_IM_LIST_STATE__。
 *   - 卖家工作台（seller.goofish.com/#/im）的独立 hook __XY_SELLER_IM__
 *     不在 V1 范围内；V1.5 若启用需重新评估 accessMode 与跨入口去重。
 *
 * 未来接入时应实现：
 *   - 通过 shop preload 或 executeJavaScript 读取 hook 全局，调用其
 *     getPending/popPending/release/discard/getMessages/send/sendImage。
 *   - 发送走页面 IM SDK（现有实现 msg.sendMessage，不是 UI 注入），返回 msgId；
 *     发送确认需再用消息流/历史核验，不能只看 SDK resolve。
 *   - 自发送回环：用 msgId 精确匹配 + 8s 文本兜底（契约 v2 §4）。
 *   - 页面重载：按 uid 持久化 msgId 水位，避免把历史会话整体重放进 pending。
 *
 * 本文件不写死服务端地址；页面入口由 ENTRY_URL / entryUrlFor() 提供。
 */

const contract = require('../shared/adapter-contract');

const { ok, fail } = contract;

const PLATFORM_ID = 'xianyu';
const PLATFORM_NAME = '闲鱼网页版（xianyu）';
const ENTRY_URL = 'https://www.goofish.com/im';
const ACCESS_MODE = contract.ACCESS_MODES.WEBVIEW;
const SUPPORTED_PLATFORMS = Object.freeze([PLATFORM_ID]);

/** V1 只注入网页版这一条 hook；卖家工作台 hook 留到 V1.5。 */
const HOOK_GLOBAL = '__XY_IM_LIST__';
const HOOK_FALLBACKS = Object.freeze(['__XY_KF__']);
const HOOK_GLOBAL_BY_PLATFORM = Object.freeze({ [PLATFORM_ID]: HOOK_GLOBAL });
const HOOK_FALLBACKS_BY_PLATFORM = Object.freeze({ [PLATFORM_ID]: HOOK_FALLBACKS });

/** 骨架阶段的统一失败：hook 桥未实现，不是页面 DOM 异常。 */
const SKELETON_DETAIL = 'xianyu_hook_bridge_not_implemented';

function unsupportedCapability(method) {
  const err = new Error(`${PLATFORM_ID}:${method}:unsupported_in_skeleton`);
  err.code = 'unsupported_capability';
  return err;
}

/** webview 接入的必填入口；core 通过平台工厂拿到同一常量。 */
function entryUrlFor() {
  return ENTRY_URL;
}

class XianyuAdapter {
  constructor({ store, logger, config, xianyuHook } = {}) {
    const platformId = String(store && store.platform ? store.platform : PLATFORM_ID);
    if (!SUPPORTED_PLATFORMS.includes(platformId)) {
      throw new Error(`unsupported_platform:${platformId}`);
    }

    this.id = platformId;
    this.accessMode = ACCESS_MODE;
    this.platform = platformId;
    this.platformName = PLATFORM_NAME;
    this.entryUrl = ENTRY_URL;
    this.store = store || null;
    this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
    this.config = config || {};

    // 未来由 core/preload 注入的页面 hook 访问器；骨架阶段为 null。
    this.hook = xianyuHook || null;
    this.hookGlobal = HOOK_GLOBAL;
    this.hookFallbacks = HOOK_FALLBACKS;

    this.lastFailure = null;
  }

  supports(platformId) {
    return String(platformId || '') === PLATFORM_ID;
  }

  /** 与平台工厂同名的可选能力：V1 只服务网页版单入口。 */
  entryUrlFor() {
    return ENTRY_URL;
  }

  /* ------------------------------------------------------------------ *
   * 契约：ensure / preparePending / pendingSnapshot / conversationHistory
   * ------------------------------------------------------------------ */
  async ensure() {
    if (this.hook && typeof this.hook.ensure === 'function') {
      // 骨架不伪造 hook；接上真实访问器后由它返回真实状态。
      throw unsupportedCapability('ensure');
    }
    return this._notReady('ensure');
  }

  async preparePending() {
    return this._notReady('preparePending');
  }

  async popPending() {
    // 当前没有 hook 产出 pending；返回 null 比伪造一条记录更诚实。
    return null;
  }

  async pendingSnapshot() {
    return this._notReady('pendingSnapshot');
  }

  async conversationHistory(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    return this._notReady('conversationHistory');
  }

  /* ------------------------------------------------------------------ *
   * 契约：sendText / sendImage / sendVideo
   * 未接入 hook = 未发送，返回 hook_not_ready；不得返回 send_unconfirmed。
   * ------------------------------------------------------------------ */
  async sendText(uid, text) {
    if (!uid) throw new TypeError('sendText: uid 不能为空');
    if (!String(text == null ? '' : text).trim()) throw new TypeError('sendText: text 不能为空');
    return this._notReady('sendText');
  }

  async sendImage(uid, payload) {
    if (!uid) throw new TypeError('sendImage: uid 不能为空');
    this._assertMediaPayload(payload, 'sendImage');
    return this._notReady('sendImage');
  }

  async sendVideo(uid, payload) {
    if (!uid) throw new TypeError('sendVideo: uid 不能为空');
    this._assertMediaPayload(payload, 'sendVideo');
    // 现有实现两端 hook 只实现文本/图片；视频是否支持 UNVERIFIED。
    return this._notReady('sendVideo');
  }

  /* ------------------------------------------------------------------ *
   * 契约：release / discard / popMerchantSent / syncAiEnabled / focusConversation
   * ------------------------------------------------------------------ */
  async release(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    // 没有 claim 可归还，幂等空操作。
    return ok({ released: false });
  }

  async discard(uid, opts = {}) {
    if (!uid) return fail('input_not_found', 'uid_required');
    return ok({ beforeTs: Number(opts && opts.beforeTs) || 0 });
  }

  async popMerchantSent() {
    return [];
  }

  async syncAiEnabled() {
    return this._notReady('syncAiEnabled');
  }

  async focusConversation(uid) {
    if (!uid) return fail('input_not_found', 'uid_required');
    return this._notReady('focusConversation');
  }

  /* ------------------------------------------------------------------ *
   * 扩展：诊断（core 不依赖）
   * ------------------------------------------------------------------ */
  status() {
    return {
      id: this.id,
      accessMode: this.accessMode,
      entryUrl: this.entryUrl,
      implemented: false,
      hookGlobal: this.hookGlobal,
      hookFallbacks: [...this.hookFallbacks],
      reason: SKELETON_DETAIL,
      lastFailure: this.lastFailure,
    };
  }

  _notReady(method, detail = SKELETON_DETAIL) {
    this.lastFailure = { method, reason: 'hook_not_ready', detail, at: Date.now() };
    return fail('hook_not_ready', detail);
  }

  _assertMediaPayload(payload, method) {
    const p = payload || {};
    if (p.base64 || p.url || p.dataUrl || p.payload) return;
    throw new TypeError(`${method}: payload 需要 url 或 base64`);
  }
}

module.exports = {
  XianyuAdapter,
  PLATFORM_ID,
  PLATFORM_NAME,
  ENTRY_URL,
  ACCESS_MODE,
  SUPPORTED_PLATFORMS,
  HOOK_GLOBAL_BY_PLATFORM,
  HOOK_FALLBACKS_BY_PLATFORM,
  entryUrlFor,
};

