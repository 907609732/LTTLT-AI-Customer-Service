'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {validateMessages}=require('../shared/multimodal.cjs');

const MESSAGES = {
  team_forbidden: '没有此团队或店铺的操作权限，请核对授权。', team_not_found: '团队记录不存在或已不可访问。', team_revision_conflict: '团队资料已变化，请刷新后重试，避免覆盖其他成员修改。', team_invalid_request: '团队操作参数不合法。', team_temporarily_unavailable: '团队服务暂时不可用，请刷新核对结果。',
  payment_not_configured: '支付尚未配置，请联系管理员。', invalid_plan: '套餐已变化，请刷新后重试。', billing_conflict: '充值订单与本次操作冲突，请刷新核对。', checkout_unavailable: '支付链接暂不可用，请勿重复付款。', billing_unavailable: '计费服务暂不可用，请稍后核对订单。',
  service_not_deployed: '当前服务接口未部署，请联系管理员核对服务版本及代理。', plans_not_configured: '管理员尚未发布充值套餐。',
  vision_unavailable:'当前模型或本店设置未启用图片识别，请转人工处理图片。',vision_invalid_input:'图片地址或数量不受支持，请在原会话检查图片。',vision_failed:'图片识别未完成，请人工检查该会话；不会自动重试。',
  session_expired: '登录已过期，请重新登录。', account_disabled: '账号已停用。',
  trial_exhausted: '试用次数已用完。', trial_expired: '试用已到期。',
  daily_limit: '今日服务试用上限已达到，请明天或联系管理员后再试。',
  service_busy: '托管服务正忙，请稍后手动重试。', rate_limited: '请求过于频繁，请稍后手动重试。',
  model_unavailable: '托管模型暂不可用，请联系管理员检查模型服务。',
  delivery_unconfirmed: '回复已生成，但发送未确认，请检查聊天记录后再继续。',
  delivery_failed: '回复已生成，但平台明确返回发送失败；不会自动重发，请检查聊天记录后再继续。',
  delivery_blocked: '回复已生成，但本机发送节奏限制阻止了发送；不会重新生成或自动发送，请核对后再继续。',
  generation_failed: '本次模型回复未能完成或无法用于发送；已暂停 AI，请核对后再继续，不会自动重新生成。',
  model_not_ready: '托管模型尚未配置完成。', request_pending: '请求仍在处理中，请勿重复发送。', request_uncertain: '请求结果尚未确认，请勿自动重试。', request_conflict: '请求标识冲突，请检查后重试。', result_expired: '请求结果已到期，请检查原请求状态。',
  offline: '暂时无法连接托管服务。', invalid_response: '托管服务返回了无效响应。',
  encryption_unavailable: '系统安全存储不可用，无法保存登录。',
  storage_unavailable: '无法安全保存登录，请稍后重试。', canceled: '操作已取消。',
  access_denied: '登录授权已拒绝。', expired_token: '登录确认码已过期。',
  authorization_pending: '等待浏览器确认。', slow_down: '等待浏览器确认。',
  invalid_request: '请求格式无效。', request_failed: '托管服务拒绝了请求。',
};
class ManagedSessionError extends Error {
  constructor(code, kind, status) {
    const known=typeof code==='string'&&Object.hasOwn(MESSAGES,code);
    super(known?MESSAGES[code]:MESSAGES.request_failed);
    this.name = 'ManagedSessionError'; this.code = known ? code : 'request_failed';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.kind = kind || (['session_expired', 'account_disabled', 'access_denied', 'expired_token'].includes(code) ? 'auth' : ['trial_exhausted', 'trial_expired', 'daily_limit'].includes(code) ? 'quota' : code === 'offline' ? 'offline' : 'service');
  }
}
const error = (code, kind, status) => new ManagedSessionError(code, kind, status);
const finite = v => Number.isSafeInteger(v) && v >= 0;
const userId = v => (Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && v.length > 0 && v.length <= 512);
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
function httpsOrigin(value) {
  const u = new URL(value);
  // Local HTTP is restricted to an explicitly configured numeric loopback and port.
  const localHttp = u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!u.port;
  if ((u.protocol !== 'https:' && !localHttp) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw error('invalid_request');
  return u.origin;
}

/** Main-process only. now() returns milliseconds; all wire/snapshot timestamps are UTC seconds. */
function createManagedSession(options = {}) {
  const origin = httpsOrigin(options.origin || 'https://api-kefu.lttlt.top');
  const portalOrigin = httpsOrigin(options.portalOrigin || 'https://account-kefu.lttlt.top');
  const { credentialFile, safeStorage, openExternal } = options;
  if (!text(credentialFile, 32768) || !path.isAbsolute(credentialFile)) throw error('invalid_request');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = () => Math.floor((options.now || Date.now)() / 1000);
  const schedule = options.setTimeout || setTimeout;
  const unschedule = options.clearTimeout || clearTimeout;
  let state = { status: 'signed_out', account: null, expiresAt: null, login: null, message: null };
  let credential = null, access = null, device = null, timer = null, epoch = 0, disposed = false, flight = null;
  const controllers = new Set();
  const snapshot = () => structuredClone(state);
  function publish(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    try { options.onChange?.(snapshot()); } catch { /* Observers cannot interrupt credential transactions. */ }
  }
  function check(e) { if (disposed || e !== epoch) throw error('canceled'); }
  function encryption() {
    try {
      if (!safeStorage?.isEncryptionAvailable?.() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw error('encryption_unavailable');
    } catch { throw error('encryption_unavailable'); }
  }
  function save(value) {
    encryption();
    const temporary = `${credentialFile}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(credentialFile), { recursive: true });
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw error('storage_unavailable');
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, credentialFile);
    } catch (e) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* Keep original credential. */ }
      if (e instanceof ManagedSessionError) throw e;
      throw error('storage_unavailable');
    }
  }
  function remove() {
    try { fs.rmSync(credentialFile, { force: true }); } catch { throw error('storage_unavailable'); }
  }
  function stop() {
    epoch++; if (timer !== null) unschedule(timer); timer = null;
    for (const c of controllers) c.abort(); controllers.clear(); device = null; access = null; flight = null;
  }
  function terminal(code) {
    stop(); credential = null;
    let message = MESSAGES[code];
    try { remove(); } catch { message = MESSAGES.storage_unavailable; }
    publish({ status: code === 'account_disabled' ? 'disabled' : 'expired', account: null, expiresAt: null, login: null, message });
  }
  function failure(e, expectedEpoch) {
    if (disposed || expectedEpoch !== epoch) return;
    if (e.code === 'session_expired' || e.code === 'account_disabled') terminal(e.code);
    else if (e.kind === 'offline') publish({ status: 'offline', message: e.message });
  }
  async function request(endpoint, { body, bearer, signal, method } = {}) {
    const controller = new AbortController(); controllers.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 20000); timeout.unref?.();
    try {
      const response = await fetchImpl(`${origin}/api/client${endpoint}`, {
        method: method || (body ? 'POST' : 'GET'), redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (Number(response.headers?.get('content-length')) > 2 * 1024 * 1024) throw error('invalid_response');
      let raw;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 2 * 1024 * 1024) { await reader.cancel(); throw error('invalid_response'); }
            chunks.push(Buffer.from(chunk.value));
          }
          raw = Buffer.concat(chunks).toString('utf8');
        } finally { reader.releaseLock(); }
      } else { raw = await response.text(); if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw error('invalid_response'); }
      // A proxy's HTML 404 is still a missing route. Never propagate its raw body.
      let data; try { data = JSON.parse(raw); } catch { throw error(response.status === 404 ? 'service_not_deployed' : response.status === 401 ? 'session_expired' : response.status >= 500 ? 'offline' : 'invalid_response', undefined, response.status); }
      if (!response.ok) {
        const candidate = typeof data?.error === 'string' ? data.error : data?.error?.code || data?.code;
        if(response.status>=500&&!['request_uncertain','model_unavailable','model_not_ready','service_busy','rate_limited','request_pending','payment_not_configured','plans_not_configured','checkout_unavailable','billing_unavailable'].includes(candidate))throw error('offline', undefined, response.status);
        throw error(response.status === 401 || candidate === 'invalid_grant' ? 'session_expired' : response.status === 404 && !MESSAGES[candidate] ? 'service_not_deployed' : candidate, undefined, response.status);
      }
      return data;
    } catch (e) {
      if (e instanceof ManagedSessionError) throw e;
      throw error(signal?.aborted || disposed ? 'canceled' : 'offline');
    } finally { clearTimeout(timeout); controllers.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  function validateBundle(b, previous) {
    if (!b || !text(b.access_token, 16384) || !text(b.refresh_token, 16384) || !userId(b.user_id) || !text(b.session_id) || b.token_type !== 'Bearer' || !finite(b.expires_at) || !finite(b.access_expires_at) || b.access_expires_at > b.expires_at || (previous && (b.user_id !== previous.userId || b.session_id !== previous.sessionId || b.expires_at !== previous.expiresAt))) throw error('invalid_response');
    if (b.expires_at <= now()) throw error('session_expired');
    return { version: 1, origin, userId: b.user_id, sessionId: b.session_id, expiresAt: b.expires_at, refreshToken: b.refresh_token, pendingOperationId: null };
  }
  function validateAccount(m) {
    if (m?.status === 'disabled') throw error('account_disabled');
    if (!m || m.user_id !== credential?.userId || m.status !== 'enabled' || !text(m.display_name) || !m.trial || !['limit', 'used', 'reserved', 'remaining', 'expires_at'].every(k => finite(m.trial[k]))) throw error('invalid_response');
    const capabilities=m.capabilities?{vision:m.capabilities.vision===true&&m.capabilities.model==='qwen3-vl-plus'&&m.capabilities.max_images===4,model:typeof m.capabilities.model==='string'?m.capabilities.model.slice(0,128):'',maxImages:4}:undefined;
    return { userId: m.user_id, displayName: m.display_name,...(capabilities?{capabilities}:{}), trial: { limit: m.trial.limit, used: m.trial.used, reserved: m.trial.reserved, remaining: m.trial.remaining, expiresAt: m.trial.expires_at } };
  }
  function later(fn, ms) { timer = schedule(fn, ms); timer?.unref?.(); }
  function autoRefresh(e) {
    if (timer !== null) unschedule(timer);
    later(async () => { if (disposed || e !== epoch) return; try { await refresh(); } catch { if (!disposed && e === epoch && credential) later(() => { void refresh().catch(() => {}); }, 60000); } }, Math.max(1000, (Math.min(access.expiresAt - 60, credential.expiresAt) - now()) * 1000));
  }
  async function synchronize(e) {
    const m = await request('/me', { bearer: access.token }); check(e);
    if (credential.expiresAt <= now()) throw error('session_expired');
    const account = validateAccount(m);
    publish({ status: 'signed_in', account, expiresAt: credential.expiresAt, login: null, message: null }); autoRefresh(e);
    return snapshot();
  }
  async function rotate(e) {
    check(e); if (!credential || credential.expiresAt <= now()) throw error('session_expired');
    if (!credential.pendingOperationId) { const next = { ...credential, pendingOperationId: randomUUID() }; save(next); credential = next; }
    const b = await request('/auth/refresh', { body: { refresh_token: credential.refreshToken, operation_id: credential.pendingOperationId } }); check(e);
    const next = validateBundle(b, credential); save(next); credential = next; access = { token: b.access_token, expiresAt: b.access_expires_at };
    // A replayed durable operation can return an old access token, but its refresh is authoritative.
    if (access.expiresAt <= now() + 5) {
      const pending = { ...credential, pendingOperationId: randomUUID() }; save(pending); credential = pending;
      const fresh = await request('/auth/refresh', { body: { refresh_token: credential.refreshToken, operation_id: credential.pendingOperationId } }); check(e);
      const replacement = validateBundle(fresh, credential); save(replacement); credential = replacement;
      access = { token: fresh.access_token, expiresAt: fresh.access_expires_at };
      if (access.expiresAt <= now()) throw error('invalid_response');
    }
    return synchronize(e);
  }
  function refresh() {
    if (disposed) return Promise.reject(error('canceled'));
    if (flight) return flight;
    const e = epoch;
    const current = rotate(e).catch(err => { failure(err, e); throw err; }).finally(() => { if (flight === current) flight = null; });
    flight = current; return current;
  }
  async function init() {
    if (disposed) throw error('canceled');
    if (credential) return snapshot();
    try {
      if (!fs.existsSync(credentialFile)) return snapshot();
      encryption();
      const stat = fs.statSync(credentialFile); if (stat.size > 65536) throw error('invalid_response');
      let stored; try { stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile))); } catch { throw error('invalid_response'); }
      if (stored.version !== 1 || stored.origin !== origin || !text(stored.refreshToken, 16384) || !userId(stored.userId) || !text(stored.sessionId) || !finite(stored.expiresAt) || (stored.pendingOperationId !== null && !text(stored.pendingOperationId, 128))) throw error('invalid_response');
      credential = stored;
      return await refresh();
    } catch (err) { if (err.kind !== 'offline' && state.status !== 'expired' && state.status !== 'disabled') publish({ status: 'signed_out', message: err.message || MESSAGES.storage_unavailable }); return snapshot(); }
  }
  async function beginLogin() {
    if (disposed) throw error('canceled'); encryption();
    stop(); credential = null; remove(); const e = epoch;
    publish({ status: 'authorizing', account: null, expiresAt: null, login: null, message: null });
    try {
      const d = await request('/auth/device/authorize', { body: {} }); check(e);
      if (!text(d.device_code, 4096) || !text(d.user_code, 64) || !finite(d.expires_in) || d.expires_in < 1 || d.expires_in > 600 || !finite(d.interval) || d.interval < 1 || d.interval > 60) throw error('invalid_response');
      const base = `${portalOrigin}/lingtu/device`;
      if (d.verification_uri !== base) throw error('invalid_response');
      let url; try { url = new URL(d.verification_uri_complete); } catch { throw error('invalid_response'); }
      if (url.origin !== portalOrigin || url.pathname !== '/lingtu/device' || url.username || url.password || url.hash || [...url.searchParams.keys()].length !== 1 || url.searchParams.get('user_code') !== d.user_code) throw error('invalid_response');
      device = { code: d.device_code, expiresAt: now() + d.expires_in, interval: d.interval };
      publish({ login: { userCode: d.user_code, expiresAt: device.expiresAt } });
      if (typeof openExternal !== 'function') throw error('invalid_request');
      await openExternal(url.href); check(e);
      later(() => poll(e), device.interval * 1000); return snapshot();
    } catch (err) { if (e === epoch && !disposed) { device = null; publish({ status: err.kind === 'offline' ? 'offline' : 'signed_out', login: null, message: err.message }); } throw err instanceof ManagedSessionError ? err : error('request_failed'); }
  }
  async function poll(e) {
    if (e !== epoch || disposed || !device) return;
    try {
      if (device.expiresAt <= now()) throw error('expired_token');
      const b = await request('/auth/device/token', { body: { device_code: device.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' } }); check(e);
      const next = validateBundle(b); save(next); credential = next; access = { token: b.access_token, expiresAt: b.access_expires_at }; device = null;
      if (access.expiresAt <= now()) await refresh(); else await synchronize(e);
    } catch (err) {
      if (e !== epoch || disposed) return;
      if (device && ['authorization_pending', 'slow_down', 'offline'].includes(err.code) && device.expiresAt > now()) {
        if (err.code === 'slow_down') device.interval += 5;
        publish({ message: err.message }); later(() => poll(e), device.interval * 1000);
      } else if (credential) { failure(err, e); }
      else { device = null; publish({ status: 'signed_out', login: null, message: err.message }); }
    }
  }
  async function cancelLogin() {
    if (!state.login && state.status !== 'authorizing') return snapshot();
    const code = device?.code; stop(); credential = null; remove();
    publish({ status: 'signed_out', account: null, expiresAt: null, login: null, message: null });
    if (code && !disposed) void request('/auth/device/cancel', { body: { device_code: code } }).catch(() => {});
    return snapshot();
  }
  async function logout() {
    const token = access?.token; stop(); credential = null; let deletionError = null;
    try { remove(); } catch (err) { deletionError = err; }
    publish({ status: 'signed_out', account: null, expiresAt: null, login: null, message: deletionError?.message || null });
    const e = epoch;
    if (token) try { await request('/auth/logout', { bearer: token, method: 'POST' }); } catch { if (e === epoch) publish({ message: '已退出本机登录；服务端撤销尚未确认。' }); }
    if (deletionError) throw deletionError;
    return snapshot();
  }
  async function chat(payload, { signal } = {}) {
    if (!payload || !text(payload.client_request_id, 128)) throw error('invalid_request');
    let messages;try{messages=validateMessages(payload.messages);}catch{throw error('invalid_request');}
    if(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'))&&!state.account?.capabilities?.vision)throw error('vision_unavailable');
    const body = { client_request_id: payload.client_request_id, messages };
    if (Buffer.byteLength(JSON.stringify(body)) > 128*1024) throw error('invalid_request');
    const e = epoch;
    try {
      if (!credential || credential.expiresAt <= now()) throw error('session_expired');
      if (!access || access.expiresAt <= now() + 30) await refresh(); check(e);
      const result = await request('/chat/completions', { body, bearer: access.token, signal }); check(e);
      if (credential.expiresAt <= now()) throw error('session_expired');
      return result;
    } catch (err) { failure(err, e); throw err; }
  }
  // Main-process service adapter reuses the session without exporting credentials.
  async function serviceRequest(endpoint, { method = 'GET', body, signal } = {}) {
    if (typeof endpoint !== 'string' || !/^\/(?:billing|team|teams)(?:\/[a-zA-Z0-9_-]{1,128})*$/.test(endpoint) || !['GET','POST','PATCH','DELETE'].includes(method) || (method === 'GET' && body !== undefined)) throw error('invalid_request');
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body)) > 128*1024) throw error('invalid_request');
    const e = epoch;
    try {
      if (disposed || !credential || credential.expiresAt <= now()) throw error('session_expired');
      if (!access || access.expiresAt <= now() + 30) await refresh(); check(e);
      const result = await request(endpoint, { method, body, bearer: access.token, signal }); check(e);
      if (credential.expiresAt <= now()) throw error('session_expired');
      return result;
    } catch (err) { failure(err, e); throw err; }
  }
  function dispose() { stop(); credential = null; disposed = true; }
  return { init, snapshot, beginLogin, cancelLogin, logout, refresh, chat, serviceRequest, dispose };
}
module.exports = { createManagedSession, ManagedSessionError };

