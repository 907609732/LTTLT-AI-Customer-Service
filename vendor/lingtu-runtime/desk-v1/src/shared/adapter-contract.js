'use strict';
/**
 * core 与 adapter 的唯一耦合点。
 * 适配器实例绑定单个店铺；方法上不再传 store，避免各平台各自解释 store 结构。
 * 契约变更需同步 src/shared/adapter-contract.md，并通知 platform-hooks。
 */
const CONTRACT_VERSION = 2;

/**
 * 接入方式：主进程据此决定窗口托管方式，不能假定每个平台都有入口 URL。
 * - webview：core 建 WebContentsView 并 loadURL(entryUrlFor)。
 * - client-inject：外部客户端已运行，core 只提供注入口，不建页面窗口。
 * - dual-hook：外部客户端 + 两条 hook（如 IM 列表与卖家 IM），同样不建页面窗口。
 */
const ACCESS_MODES = Object.freeze({
  WEBVIEW: 'webview',
  CLIENT_INJECT: 'client-inject',
  DUAL_HOOK: 'dual-hook',
});

const ACCESS_MODE_VALUES = Object.freeze(Object.values(ACCESS_MODES));

const HOSTING_BY_ACCESS_MODE = Object.freeze({
  [ACCESS_MODES.WEBVIEW]: 'webcontents-view',
  [ACCESS_MODES.CLIENT_INJECT]: 'external-client',
  [ACCESS_MODES.DUAL_HOOK]: 'external-client',
});

const METHODS = Object.freeze([
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
]);

/** id / accessMode 是实例属性，不占方法表；16 项 = 2 个属性 + 14 个方法。 */
const PROPERTIES = Object.freeze(['id', 'accessMode']);
const REQUIRED_MEMBERS = Object.freeze([...PROPERTIES, ...METHODS]);

/**
 * 平台工厂可选能力（不是适配器方法）：
 * - entryUrlFor(store)：仅 webview 接入需要；缺失表示该平台由外部客户端提供页面。
 */
const OPTIONAL_CAPABILITIES = Object.freeze(['entryUrlFor']);

const FAILURE_REASONS = Object.freeze({
  HOOK_NOT_READY: 'hook_not_ready',
  INPUT_NOT_FOUND: 'input_not_found',
  INPUT_BUSY: 'input_busy',
  SEND_UNCONFIRMED: 'send_unconfirmed',
});

const FAILURE_REASON_VALUES = Object.freeze(Object.values(FAILURE_REASONS));

function isFailureReason(value) {
  return FAILURE_REASON_VALUES.includes(value);
}

function isAccessMode(value) {
  return ACCESS_MODE_VALUES.includes(value);
}

/** 托管方式映射；未知接入方式返回 null，由调用方拒绝启动。 */
function hostingForAccessMode(mode) {
  return HOSTING_BY_ACCESS_MODE[mode] || null;
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}

/** 业务失败必须返回受控枚举；未知错误请抛出，由引擎按异常处理。 */
function fail(reason, detail = '') {
  if (!isFailureReason(reason)) {
    throw new Error(`adapter_failure_reason_invalid:${reason}`);
  }
  const result = { ok: false, reason };
  if (detail) result.detail = String(detail).slice(0, 300);
  return result;
}

function validateAdapter(adapter) {
  const missing = [];
  const invalid = [];
  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, missing: [...REQUIRED_MEMBERS], invalid: [] };
  }
  if (typeof adapter.id !== 'string' || !adapter.id.trim()) invalid.push('id');
  if (!isAccessMode(adapter.accessMode)) invalid.push('accessMode');
  for (const name of METHODS) {
    if (typeof adapter[name] !== 'function') missing.push(name);
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

function assertAdapterShape(adapter) {
  const result = validateAdapter(adapter);
  if (!result.ok) {
    const detail = [
      result.invalid.length ? `invalid: ${result.invalid.join(',')}` : '',
      result.missing.length ? `missing: ${result.missing.join(',')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const err = new Error(`adapter_contract_violation:${detail}`);
    err.code = 'adapter_contract_violation';
    err.details = result;
    throw err;
  }
  return true;
}

/** 校验适配器返回值；只认 {ok:true} 或 {ok:false, reason:<枚举>}。 */
function assertResult(result, method = 'unknown') {
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    throw new Error(`adapter_result_invalid:${method}`);
  }
  if (result.ok === false && !isFailureReason(result.reason)) {
    throw new Error(`adapter_result_reason_invalid:${method}:${result.reason}`);
  }
  return result;
}

module.exports = {
  CONTRACT_VERSION,
  ACCESS_MODES,
  ACCESS_MODE_VALUES,
  HOSTING_BY_ACCESS_MODE,
  METHODS,
  PROPERTIES,
  REQUIRED_MEMBERS,
  OPTIONAL_CAPABILITIES,
  FAILURE_REASONS,
  FAILURE_REASON_VALUES,
  isAccessMode,
  isFailureReason,
  hostingForAccessMode,
  ok,
  fail,
  validateAdapter,
  assertAdapterShape,
  assertResult,
};

