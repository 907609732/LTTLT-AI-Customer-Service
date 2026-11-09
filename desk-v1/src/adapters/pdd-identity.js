'use strict';

// Executed in the merchant page so the request uses that store's isolated session.
// Never return the account object: only the display/identity fields below cross IPC.
async function readPageIdentity(timeoutMs, refresh) {
  const blank = { authenticated: null, storeName: '', mallId: '', customerServiceName: '', customerServiceId: '' };
  const unknown = (message) => ({ ...blank, identityError: message });
  if (location.origin !== 'https://mms.pinduoduo.com') return unknown('店铺页面来源无效');
  if (/(?:^|\/)(?:login|signin|passport)(?:[/._-]|$)/i.test(location.pathname)) return { ...blank, authenticated: false };
  const text = (value, max) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
  const rejected = (data) => !data || typeof data !== 'object' || data.success === false ||
    (data.error_code !== undefined && !['0', '200'].includes(String(data.error_code))) ||
    (data.code !== undefined && !['0', '200'].includes(String(data.code)));
  const parse = (data) => {
    if (rejected(data)) return null;
    const account = data.result && typeof data.result === 'object' ? data.result : data.data && typeof data.data === 'object' ? data.data : data;
    if (rejected(account)) return null;
    const mall = account.mall && typeof account.mall === 'object' ? account.mall : account;
    const mallId = text(mall.mall_id ?? mall.mallId, 100);
    const storeName = text(mall.mall_name ?? mall.mallName, 60);
    if (!mallId && !storeName) return null;
    const identity = { authenticated: true, storeName, mallId, customerServiceName: text(account.username ?? account.user_name, 100), customerServiceId: text(account.id ?? account.cs_id, 100) };
    if (!storeName) identity.identityError = '已登录，暂未获取店铺名称，请重试';
    return identity;
  };
  // Only explicitly known account containers; do not traverse conversations/buyer data.
  const candidates = [];
  if (typeof document !== 'undefined') {
    for (const selector of ['#app', '#root']) {
      const state = document.querySelector(selector)?.__vue__?.$store?.state;
      candidates.push(state?.userInfo, state?.currentUserInfo?.userInfo);
    }
  }
  candidates.push(window.rawData, window.userInfo, window.__INITIAL_STATE__?.userInfo, window.__INITIAL_STATE__?.currentUserInfo?.userInfo);
  for (const candidate of refresh ? [] : candidates) {
    const identity = parse(candidate);
    if (identity?.storeName) return identity;
  }
  const controller = new AbortController();
  let timer;
  try {
    const response = await Promise.race([
      (async () => {
        const request = await fetch('https://mms.pinduoduo.com/chats/userinfo/realtime?get_response=true', { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
        if (request.status === 401) return { ...blank, authenticated: false };
        if (!request.ok) return unknown('店铺信息请求失败，请重试');
        const data = await request.json();
        return parse(data) || unknown('暂未获取有效店铺信息，请重试');
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('identity_timeout')); }, timeoutMs); }),
    ]);
    return response;
  } catch {
    return unknown('店铺信息获取失败或超时，请重试');
  } finally {
    clearTimeout(timer);
  }
}

function buildIdentityScript({ timeoutMs = 5000, refresh = false } = {}) {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 15000) : 5000;
  return `(${readPageIdentity.toString()})(${JSON.stringify(ms)},${refresh === true})`;
}
module.exports = { buildIdentityScript };
