import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {createBackend}=require('../electron/backend.cjs');
async function setup(t,extra={}){const dir=await mkdtemp(path.join(tmpdir(),'managed-backend-'));t.after(()=>rm(dir,{recursive:true,force:true}));let client;const backend=createBackend({dataDir:dir,modelMode:'managed',managedChat:async()=>({choices:[{message:{content:'{"reply":"托管回答"}'}}]}),managerFactory:()=>({stateOf:()=>({open:true,online:true}),closeAll(){}}),adapterFactory:()=>({syncAiEnabled:async()=>{},focusConversation:async()=>({ok:true}),sendText:async()=>({ok:true})}),...extra});t.after(()=>backend.dispose());return {backend,dir};}
test('managed model calls use injected transport and never local endpoint or key',async t=>{
 let captured;const {backend}=await setup(t,{managedChat:async payload=>{captured=payload;return {choices:[{message:{content:'{"reply":"托管回答"}'}}]};}});
 const result=await backend.engine.aiClient.reply({systemPrompt:'rule',thread:[{from:'buyer',type:'text',content:'你好'}]});
 assert.equal(result.reply,'托管回答');assert.ok(captured.client_request_id);assert.equal(captured.messages.length,2);assert.equal(backend.engine.aiClient.suppressFallback,true);
});
test('training respects managed transport and blocks further requests while outcome needs review',async t=>{
 let calls=0;const {ManagedSessionError}=require('../electron/managed-session.cjs');
 const {backend}=await setup(t,{managedChat:async()=>{calls++;if(calls===1)return {choices:[{message:{content:'{"reply":"测试回答"}'}}]};throw new ManagedSessionError('request_uncertain');}});
 const input={action:'start-training',values:{question:'你好',history:[]}};
 const ok=await backend.execute(input);assert.equal(ok.data.reply,'测试回答');
 await assert.rejects(backend.execute(input));assert.equal(backend.snapshot().modelIssue.code,'request_uncertain');
 await assert.rejects(backend.execute(input),/核对/);assert.equal(calls,2);
});
test('training with an unusable managed result retains the existing review protection',async t=>{
 let calls=0;const {backend}=await setup(t,{managedChat:async()=>{calls++;return {choices:[{message:{content:'{"reply":""}'}}]}}});
 const input={action:'start-training',values:{question:'你好',history:[]}};
 await assert.rejects(backend.execute(input));assert.equal(backend.snapshot().modelIssue.code,'generation_failed');
 await assert.rejects(backend.execute(input),/核对/);assert.equal(calls,1);
});
test('disposed backend cancels pending generation and rejects stale manual send after focus',async t=>{
 let resolveFocus,sent=0;const {backend}=await setup(t,{adapterFactory:()=>({focusConversation:()=>new Promise(r=>{resolveFocus=r;}),sendText:async()=>{sent++;return {ok:true};}})});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const id=backend.snapshot().stores[0].id;
 backend.ingest({type:'message:in',storeId:id,uid:'buyer',from:'buyer',content:'fixture'});await backend.execute({action:'select-conversation',storeId:id,conversationId:'buyer'});
 const pending=backend.execute({action:'send-reply',storeId:id,conversationId:'buyer',values:{reply:'never send'}});backend.dispose();resolveFocus({ok:true});await assert.rejects(pending);assert.equal(sent,0);
});
for(const code of ['session_expired','trial_exhausted','trial_expired','daily_limit','request_pending','request_uncertain','request_conflict','result_expired','request_failed','model_unavailable','service_busy','rate_limited'])test(`managed ${code} stops workers without timed fallback or fresh-ID automatic retry`,async t=>{
 const {StoreWorker}=require('../desk-v1/src/main/reply-engine');const {METHODS}=require('../desk-v1/src/shared/adapter-contract');const {ManagedSessionError}=require('../electron/managed-session.cjs');let calls=0,sent=0;
 const {backend}=await setup(t,{managedChat:async()=>{calls++;await new Promise(r=>setTimeout(r,25));throw new ManagedSessionError(code);}});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const store=backend.snapshot().stores[0];let row={uid:'buyer',messages:[{msgId:'m1',from:'buyer',type:'text',content:'fixture',ts:Date.now()}]};
 const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>{const next=row;row=null;return next;},popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),sendText:async()=>{sent++;return {ok:true};}};
 const worker=new StoreWorker({store:{...store,aiEnabled:true},adapter,aiClient:backend.engine.aiClient,getConfig:()=>({ai:{systemPrompt:'rule'},reply:{enabled:true,maxInflight:1,staleMs:180000,fallbackAfterMs:1,fallbackText:'MUST NOT SEND',perUidMinIntervalMs:0,sendJitterMinMs:0,sendJitterMaxMs:0}})});
 worker.running=true;backend.engine.workers.set(store.id,worker);await worker.tick();await worker.settle();await worker.tick();assert.equal(calls,1);assert.equal(sent,0);assert.equal(worker.running,false);assert.equal(backend.engine.workers.size,0);
});
test('disposing local own-key backend aborts its in-flight model HTTP request',async t=>{
 let entered,aborted=false;const started=new Promise(r=>{entered=r;});
 const {AiClient}=require('../desk-v1/src/main/ai-client');const client=new AiClient({getConfig:()=>({ai:{baseUrl:'http://127.0.0.1:9999',model:'fixture'}}),fetchImpl:async(_url,{signal})=>{entered();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));}});
 const {backend}=await setup(t,{modelMode:'local',aiClient:client});
 const pending=backend.engine.aiClient.complete({messages:[{role:'user',content:'fixture'}],timeoutMs:30000});pending.catch(()=>{});await started;backend.dispose();assert.equal(aborted,true);await assert.rejects(pending);
});
test('uncertain managed result remains visible across refresh/restart and requires explicit review before AI restart',async t=>{
 const {ManagedSessionError}=require('../electron/managed-session.cjs');const {backend,dir}=await setup(t,{managedChat:async()=>{throw new ManagedSessionError('request_uncertain');}});
 await assert.rejects(backend.engine.aiClient.complete({messages:[{role:'user',content:'fixture'}]}));assert.equal(backend.snapshot().modelIssue.code,'request_uncertain');assert.match(backend.snapshot().modelIssue.message,/未确认|待确认/);
 await backend.execute({action:'refresh'});assert.equal(backend.snapshot().modelIssue.requiresReview,true);backend.dispose();
 const restored=createBackend({dataDir:dir,modelMode:'managed'});t.after(()=>restored.dispose());assert.equal(restored.snapshot().modelIssue.code,'request_uncertain');
 await restored.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const id=restored.snapshot().stores[0].id;
 await assert.rejects(restored.execute({action:'set-ai',storeId:id,values:{enabled:true}}),/核对|提示/);
 await assert.rejects(restored.execute({action:'acknowledge-model-issue'}),/确认/);await assert.rejects(restored.execute({action:'acknowledge-model-issue',values:{confirmed:true,code:'stale',at:1}}),/已更新/);await restored.execute({action:'acknowledge-model-issue',values:{confirmed:true,code:restored.snapshot().modelIssue.code,at:restored.snapshot().modelIssue.at}});assert.equal(restored.snapshot().modelIssue,null);
});
test('managed denial invalidates an AI start still awaiting adapter readiness',async t=>{
 let release,entered;const ready=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});const {METHODS}=require('../desk-v1/src/shared/adapter-contract');
 const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),ensure:async()=>{entered();await gate;return {ok:true};}};
 const {backend}=await setup(t,{adapterFactory:()=>adapter});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const id=backend.snapshot().stores[0].id;
 const pending=backend.execute({action:'set-ai',storeId:id,values:{enabled:true}});await ready;backend.stopAi();release();await assert.rejects(pending,/取消/);assert.equal(backend.engine.worker(id),null);assert.equal(backend.snapshot().stores[0].aiEnabled,false);
});
for(const outcome of ['input_not_found','send_unconfirmed','throws','throttled','unusable_reply'])test(`managed ${outcome} after generation pauses without another model ID or duplicate send`,async t=>{
 const {StoreWorker}=require('../desk-v1/src/main/reply-engine'),{METHODS}=require('../desk-v1/src/shared/adapter-contract');const ids=[];let sends=0;
 const {backend,dir}=await setup(t,{managedChat:async payload=>{ids.push(payload.client_request_id);return {choices:[{message:{content:outcome==='unusable_reply'?'{"reply":""}':'{"reply":"fixture generated reply"}'}}]};}});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const store=backend.snapshot().stores[0];
 const row={uid:'buyer',messages:[{msgId:'one-buyer-message',from:'buyer',type:'text',content:'fixture',ts:Date.now()}]},queue=[row];
 const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>queue.shift()||null,popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),release:async()=>{queue.push(row);return {ok:true};},sendText:async()=>{sends++;if(outcome==='throws')throw Error('raw platform detail must not be retained');return {ok:false,reason:outcome};}};
 const worker=new StoreWorker({store:{...store,aiEnabled:true},adapter,aiClient:backend.engine.aiClient,getConfig:()=>({ai:{systemPrompt:'rule'},reply:{enabled:true,maxInflight:1,staleMs:180000,fallbackAfterMs:1,fallbackText:'MUST NOT SEND',perUidMinIntervalMs:0,perStorePerMinuteMax:1,sendJitterMinMs:0,sendJitterMaxMs:0}})});
 if(outcome==='throttled')worker.sendWindow.push(Date.now());worker.running=true;backend.engine.workers.set(store.id,worker);
 for(let i=0;i<3;i++){await worker.tick();await worker.settle();}
 assert.equal(ids.length,1);assert.equal(new Set(ids).size,1);assert.equal(sends,['throttled','unusable_reply'].includes(outcome)?0:1);assert.equal(worker.running,false);assert.equal(backend.snapshot().modelIssue.requiresReview,true);assert.match(backend.snapshot().modelIssue.message,outcome==='unusable_reply'?/模型回复/:/回复已生成/);assert.equal(backend.snapshot().modelIssue.code,outcome==='unusable_reply'?'generation_failed':outcome==='throttled'?'delivery_blocked':['throws','send_unconfirmed'].includes(outcome)?'delivery_unconfirmed':'delivery_failed');assert.ok(!JSON.stringify(backend.snapshot().modelIssue).includes('raw platform'));
 backend.dispose();const restored=createBackend({dataDir:dir,modelMode:'managed'});t.after(()=>restored.dispose());assert.equal(restored.snapshot().modelIssue.requiresReview,true);
});
