import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
const {createManagedSession}=createRequire(import.meta.url)('../electron/managed-session.cjs');

async function sessionFixture(t,status,body){
 const dir=mkdtempSync(path.join(tmpdir(),'lingtu-session-billing-'));
 const expiry=Math.floor(Date.now()/1000)+3600;
 const credentialFile=path.join(dir,'session.enc');
 writeFileSync(credentialFile,JSON.stringify({version:1,origin:'https://api.fixture.test',userId:42,sessionId:'fixture',expiresAt:expiry,refreshToken:'fixture-refresh',pendingOperationId:null}));
 const session=createManagedSession({origin:'https://api.fixture.test',portalOrigin:'https://account.fixture.test',credentialFile,
  safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
  fetchImpl:async url=>{
   if(url.endsWith('/auth/refresh'))return new Response(JSON.stringify({user_id:42,session_id:'fixture',token_type:'Bearer',refresh_token:'fixture-refresh-2',access_token:'fixture-access',expires_at:expiry,access_expires_at:expiry-60}));
   if(url.endsWith('/me'))return new Response(JSON.stringify({user_id:42,display_name:'Fixture',status:'enabled',trial:{limit:10,used:0,reserved:0,remaining:10,expires_at:expiry}}));
   return new Response(body,{status});
  }});
 t.after(()=>{session.dispose();const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('lingtu-session-billing-'));rmSync(target,{recursive:true,force:true});});
 await session.init();assert.equal(session.snapshot().status,'signed_in');return session;
}
test('billing preserves an unconfigured merchant separately from network failure',async t=>{
 const session=await sessionFixture(t,503,'{"error":"payment_not_configured"}');
 await assert.rejects(session.serviceRequest('/billing'),{code:'payment_not_configured',status:503});
 assert.equal(session.snapshot().status,'signed_in');
});
test('plain proxy 404 identifies an undeployed route without leaking response text',async t=>{
 const session=await sessionFixture(t,404,'<html>private upstream details</html>');
 await assert.rejects(session.serviceRequest('/billing'),e=>e.code==='service_not_deployed'&&e.status===404&&!e.message.includes('private'));
 assert.equal(session.snapshot().status,'signed_in');
});
test('billing conflict and login expiry keep HTTP status for the desktop boundary',async t=>{
 const conflict=await sessionFixture(t,409,'{"error":"billing_conflict"}');
 await assert.rejects(conflict.serviceRequest('/billing/orders',{method:'POST',body:{}}),{code:'billing_conflict',status:409});
 const expired=await sessionFixture(t,401,'{"error":"unauthorized"}');
 await assert.rejects(expired.serviceRequest('/billing'),{code:'session_expired',status:401});
 assert.equal(expired.snapshot().status,'expired');
});
