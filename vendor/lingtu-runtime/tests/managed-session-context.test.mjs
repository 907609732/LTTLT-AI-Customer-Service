import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
const {createManagedSession}=createRequire(import.meta.url)('../electron/managed-session.cjs');

const policy={
 default_model:'fixture-model',
 models:[{id:'fixture-model',name:'Fixture'}],
 max_tokens:512,
 policy_version:4,
 runtime_context:{enabled:true,retrieval_budget:2600,retrieval_order:['binding','canonical','store','template']},
 learning:{enabled:true,vision_enabled:true,allowed_sources:['pdd_detail_text','pdd_detail_image'],max_calls_per_product:20,max_output_tokens:4096,requires_review:true,video_mode:'disabled',asr_mode:'disabled'}
};

async function sessionFixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'lingtu-session-context-'));
 const expiry=Math.floor(Date.now()/1000)+3600;
 const credentialFile=path.join(dir,'session.enc');
 writeFileSync(credentialFile,JSON.stringify({version:1,origin:'https://api.fixture.test',userId:42,sessionId:'fixture',expiresAt:expiry,refreshToken:'fixture-refresh',pendingOperationId:null}));
 const calls=[];
 const session=createManagedSession({origin:'https://api.fixture.test',portalOrigin:'https://account.fixture.test',credentialFile,
  safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
  fetchImpl:async (url,init={})=>{
   const body=typeof init.body==='string'?JSON.parse(init.body):null;
   calls.push({url:String(url),method:init.method||'GET',body,bearer:new Headers(init.headers).get('Authorization')});
   if(String(url).endsWith('/auth/refresh'))return new Response(JSON.stringify({user_id:42,session_id:'fixture',token_type:'Bearer',refresh_token:'fixture-refresh-2',access_token:'fixture-access',expires_at:expiry,access_expires_at:expiry-60}));
   if(String(url).endsWith('/me'))return new Response(JSON.stringify({user_id:42,display_name:'Fixture',status:'enabled',trial:{limit:10,used:0,reserved:0,remaining:10,expires_at:expiry}}));
   if(String(url).endsWith('/api/client/config'))return new Response(JSON.stringify(policy));
   if(String(url).endsWith('/chat/completions'))return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
   if(String(url).endsWith('/billing'))return new Response(JSON.stringify({plans:[]}));
   return new Response('{}');
  }});
 t.after(()=>{session.dispose();const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('lingtu-session-context-'));rmSync(target,{recursive:true,force:true});});
 await session.init();assert.equal(session.snapshot().status,'signed_in');return {session,calls};
}

test('config uses only the fixed authenticated GET endpoint and never the business adapter',async t=>{
 const {session,calls}=await sessionFixture(t);
 const result=await session.config();
 assert.deepEqual(result,policy);
 const configCalls=calls.filter(call=>call.url.endsWith('/api/client/config'));
 assert.equal(configCalls.length,1);
 assert.equal(configCalls[0].url,'https://api.fixture.test/api/client/config');
 assert.equal(configCalls[0].method,'GET');
 assert.equal(configCalls[0].body,null);
 assert.equal(configCalls[0].bearer,'Bearer fixture-access');
 const before=calls.length;
 await assert.rejects(session.serviceRequest('/config'),{code:'invalid_request'});
 await assert.rejects(session.serviceRequest('/admin/config'),{code:'invalid_request'});
 assert.equal(calls.length,before);
 await assert.doesNotReject(session.serviceRequest('/billing'));
});

test('chat forwards only typed purpose, version and source and strips arbitrary output claims',async t=>{
 const {session,calls}=await sessionFixture(t);
 const messages=[{role:'user',content:'详情页文字与图片'}];
 await session.chat({client_request_id:'learning-1',messages,purpose:'learning',policy_version:4,learning_source:'pdd_detail_text',max_tokens:8192,model:'forged',extra:{x:1}});
 const body=calls.at(-1).body;
 assert.deepEqual(body,{client_request_id:'learning-1',messages,purpose:'learning',policy_version:4,learning_source:'pdd_detail_text'});
 const before=calls.length;
 for(const payload of [
  {client_request_id:'bad-purpose',messages,purpose:'admin'},
  {client_request_id:'bad-version',messages,purpose:'learning',policy_version:-1},
  {client_request_id:'bad-version-type',messages,purpose:'learning',policy_version:1.5},
  {client_request_id:'bad-source',messages,purpose:'learning',learning_source:'pdd_detail_video'},
  {client_request_id:'source-without-purpose',messages,learning_source:'pdd_detail_text'},
  {client_request_id:'source-with-reply',messages,purpose:'reply',learning_source:'pdd_detail_text'}
 ]) await assert.rejects(session.chat(payload),{code:'invalid_request'});
 assert.equal(calls.length,before);
});

test('legacy chat body stays byte-compatible and omits new fields',async t=>{
 const {session,calls}=await sessionFixture(t);
 const messages=[{role:'user',content:'物流不动了'}];
 await session.chat({client_request_id:'legacy-1',messages});
 assert.deepEqual(calls.at(-1).body,{client_request_id:'legacy-1',messages});
 assert.equal(JSON.stringify(calls.at(-1).body),JSON.stringify({client_request_id:'legacy-1',messages}));
});
