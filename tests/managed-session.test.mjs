import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const load = () => require('../electron/managed-session.cjs');
const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from([...Buffer.from(s)].map(x => x ^ 99)), decryptString: b => Buffer.from([...b].map(x => x ^ 99)).toString() };
async function fixture(t, handler, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'managed-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const credentialFile = join(dir, 'credential');
  const calls = []; const scheduled = [];
  const options = { credentialFile, safeStorage: storage, now: () => 1000000,
    setTimeout: fn => { scheduled.push(fn); return fn; }, clearTimeout: () => {}, openExternal: async () => {},
    fetchImpl: async (url, opts) => { calls.push({ url, ...opts }); return handler(new URL(url).pathname, opts); }, ...extra };
  const session = load().createManagedSession(options); t.after(() => session.dispose());
  return { session, options, credentialFile, calls, scheduled };
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const bundle = { access_token: 'ACCESS_SECRET', refresh_token: 'REFRESH_SECRET', access_expires_at: 1900, expires_at: 2593000, user_id: 'u1', session_id: 's1', token_type: 'Bearer' };
const me = { user_id: 'u1', display_name: 'Alice', status: 'enabled', trial: { limit: 20, used: 1, reserved: 0, remaining: 19, expires_at: 605800 } };
const authorize = { device_code: 'DEVICE_SECRET', user_code: 'ABCD', verification_uri: 'https://account-kefu.lttlt.top/lingtu/device', verification_uri_complete: 'https://account-kefu.lttlt.top/lingtu/device?user_code=ABCD', expires_in: 600, interval: 5 };
async function login(f) { await f.session.beginLogin(); await f.scheduled.shift()(); }
test('safe initial state and HTTPS-only origins', async t => {
  const f = await fixture(t, () => response({}));
  assert.equal((await f.session.init()).status, 'signed_out');
  assert.throws(() => load().createManagedSession({ ...f.options, origin: 'http://evil.test' }));
});
test('device login stores encrypted refresh only and exposes sanitized account', async t => {
  const f = await fixture(t, p => response(p.endsWith('authorize') ? authorize : p.endsWith('/token') ? bundle : me));
  await login(f);
  assert.equal(f.session.snapshot().status, 'signed_in');
  assert.equal(f.session.snapshot().account.trial.remaining, 19);
  assert.ok(!JSON.stringify(f.session.snapshot()).includes('SECRET'));
  const file = await readFile(f.credentialFile);
  assert.ok(!file.toString().includes('SECRET'));
  assert.ok(!storage.decryptString(file).includes('ACCESS_SECRET'));
  assert.ok(f.calls.every(c => c.redirect === 'error'));
});
test('rejects hostile browser URL and encryption unavailability', async t => {
  const f = await fixture(t, () => response({ ...authorize, verification_uri_complete: 'https://evil.test/?user_code=ABCD' }));
  await assert.rejects(f.session.beginLogin(), { code: 'invalid_response' });
  const g = await fixture(t, () => response(authorize), { safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(g.session.beginLogin(), { code: 'encryption_unavailable' });
});
test('lost refresh response retains operation id across restart and single flights', async t => {
  let fail = false; const operations = [];
  const f = await fixture(t, (p, opts) => {
    if (p.endsWith('/refresh')) { operations.push(JSON.parse(opts.body).operation_id); if (fail) throw Error('network SECRET'); return response(bundle); }
    return response(p.endsWith('authorize') ? authorize : p.endsWith('/token') ? bundle : me);
  });
  await login(f); fail = true;
  await assert.rejects(f.session.refresh(), { kind: 'offline' });
  assert.equal(f.session.snapshot().status, 'offline'); f.session.dispose(); fail = false;
  const restored = load().createManagedSession(f.options); t.after(() => restored.dispose());
  await restored.init();
  assert.equal(operations[0], operations[1]);
  assert.equal(restored.snapshot().status, 'signed_in');
  const before = operations.length;
  await Promise.all([restored.refresh(), restored.refresh()]);
  assert.equal(operations.length, before + 1);
});
test('logout clears locally offline and late login cannot resurrect', async t => {
  let resolveToken;
  const f = await fixture(t, p => p.endsWith('authorize') ? response(authorize) : p.endsWith('/cancel') ? response({}) : new Promise(r => { resolveToken = r; }));
  await f.session.beginLogin(); const pending = f.scheduled.shift()();
  await f.session.cancelLogin(); resolveToken(response(bundle)); await pending;
  assert.equal(f.session.snapshot().status, 'signed_out');
  await f.session.logout(); assert.equal(f.session.snapshot().status, 'signed_out');
});
test('quota errors are sanitized and disable chat fallback via stable code', async t => {
  const f = await fixture(t, p => p.endsWith('/completions') ? response({ error: { code: 'trial_exhausted', message: 'SECRET' } }, 403) : response(p.endsWith('authorize') ? authorize : p.endsWith('/token') ? bundle : me));
  await login(f);
  await assert.rejects(f.session.chat({ client_request_id: 'r1', messages: [{ role: 'user', content: 'Hi' }] }), e => e instanceof load().ManagedSessionError && e.code === 'trial_exhausted' && !e.message.includes('SECRET'));
});
test('logout while offline removes encrypted credentials and reports unconfirmed revoke', async t => {
  const f = await fixture(t, p => { if (p.endsWith('/logout')) throw Error('secret network detail'); return response(p.endsWith('authorize') ? authorize : p.endsWith('/token') ? bundle : me); });
  await login(f); const result = await f.session.logout();
  assert.equal(result.status, 'signed_out'); assert.match(result.message, /尚未确认/);
  await assert.rejects(readFile(f.credentialFile), { code: 'ENOENT' });
});
test('durable recovered expired access is persisted then rotated before /me', async t => {
  let count = 0; let replay = false;
  const f = await fixture(t, (p, opts) => {
    if (p.endsWith('/refresh')) { count++; if (count === 1) throw Error('lost'); return response(count === 2 ? { ...bundle, refresh_token: 'RECOVERED', access_expires_at: 900 } : { ...bundle, refresh_token: 'FRESH' }); }
    if (p.endsWith('/me') && replay) assert.equal(JSON.parse(storage.decryptString(require('node:fs').readFileSync(f.credentialFile))).refreshToken, 'FRESH');
    return response(p.endsWith('authorize') ? authorize : p.endsWith('/token') ? bundle : me);
  });
  await login(f); await assert.rejects(f.session.refresh()); f.session.dispose(); replay = true;
  const restored = load().createManagedSession(f.options); t.after(() => restored.dispose());
  assert.equal((await restored.init()).status, 'signed_in'); assert.equal(count, 3);
});
test('absolute session deadline is rechecked after /me completes', async t => {
  let time = 1000000;
  const f = await fixture(t, p => {
    if (p.endsWith('/me')) time = bundle.expires_at * 1000;
    return response(p.endsWith('authorize') ? authorize : p.endsWith('/token') ? bundle : me);
  }, { now: () => time });
  await login(f); assert.equal(f.session.snapshot().status, 'expired');
});
test('safeStorage platform failures never expose raw secret-bearing errors', async t => {
  const f = await fixture(t, () => response(authorize), { safeStorage: { isEncryptionAvailable() { throw Error('SECRET OS data'); } } });
  await assert.rejects(f.session.beginLogin(), e => e.code === 'encryption_unavailable' && !e.message.includes('SECRET'));
});
test('device polling honors pending and slow_down without exposing device code', async t => {
  const delays = []; const callbacks = []; let polls = 0;
  const f = await fixture(t, p => {
    if (p.endsWith('/token')) { polls++; return polls < 3 ? response({ error: polls === 1 ? 'authorization_pending' : 'slow_down' }, 400) : response(bundle); }
    return response(p.endsWith('authorize') ? authorize : me);
  }, { setTimeout: (fn, ms) => { callbacks.push(fn); delays.push(ms); return fn; } });
  await f.session.beginLogin(); await callbacks.shift()(); await callbacks.shift()();
  assert.deepEqual(delays, [5000, 5000, 10000]);
  await callbacks.shift()(); assert.equal(f.session.snapshot().status, 'signed_in');
});
test('cancel during account synchronization removes newly saved credential', async t => {
  let finishMe; const f = await fixture(t, p => p.endsWith('authorize') ? response(authorize) : p.endsWith('/token') ? response(bundle) : new Promise(r => { finishMe = r; }));
  await f.session.beginLogin(); const pending = f.scheduled.shift()();
  while (!finishMe) await new Promise(r => setImmediate(r));
  await f.session.cancelLogin(); finishMe(response(me)); await pending;
  assert.equal(f.session.snapshot().status, 'signed_out');
  await assert.rejects(readFile(f.credentialFile), { code: 'ENOENT' });
});
test('accepts canonical numeric server user IDs without coercing account identity',async t=>{
 const f=await fixture(t,p=>response(p.endsWith('authorize')?authorize:p.endsWith('/token')?{...bundle,user_id:1}:{...me,user_id:1}));
 await login(f);assert.equal(f.session.snapshot().status,'signed_in');assert.equal(f.session.snapshot().account.userId,1);
});
for(const [status,code] of [[409,'request_pending'],[409,'request_uncertain'],[409,'request_conflict'],[410,'result_expired'],[410,'request_failed'],[503,'request_uncertain'],[503,'model_unavailable'],[403,'trial_expired'],[403,'trial_exhausted'],[403,'daily_limit'],[429,'service_busy'],[429,'rate_limited']])test(`preserves sanitized ${status} ${code} without retrying chat`,async t=>{
 let chats=0;const f=await fixture(t,p=>{if(p.endsWith('/completions')){chats++;return response({error:{code,message:'SECRET upstream details'}},status);}return response(p.endsWith('authorize')?authorize:p.endsWith('/token')?bundle:me);});await login(f);
 await assert.rejects(f.session.chat({client_request_id:'same-request',messages:[{role:'user',content:'fixture'}]}),e=>e.code===code&&!e.message.includes('SECRET'));
 assert.equal(chats,1);assert.equal(f.session.snapshot().status,'signed_in');assert.ok((await readFile(f.credentialFile)).length>0);
});
test('unexpected auth text in a 5xx response cannot clear encrypted credentials',async t=>{
 const f=await fixture(t,p=>response(p.endsWith('/completions')?{error:{code:'session_expired'}}:p.endsWith('authorize')?authorize:p.endsWith('/token')?bundle:me,p.endsWith('/completions')?503:200));await login(f);
 await assert.rejects(f.session.chat({client_request_id:'r',messages:[{role:'user',content:'fixture'}]}),{code:'offline'});assert.ok((await readFile(f.credentialFile)).length>0);
});
