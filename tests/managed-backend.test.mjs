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
 worker.running=true;backend.engine.workers.set(store.id,worker);await worker.tick();await worker.settle();await worker.tick();assert.equal(calls,1);assert.equal(sent,0);const globalIssue=['session_expired','trial_exhausted','trial_expired','daily_limit','model_unavailable'].includes(code);assert.equal(worker.running,!globalIssue);assert.equal(backend.engine.workers.size,globalIssue?0:1);if(!globalIssue){assert.equal(backend.snapshot().modelIssue,null);assert.equal(backend.snapshot().quality[0].events[0].code,code);}
});
test('disposing local own-key backend aborts its in-flight model HTTP request',async t=>{
 let entered,aborted=false;const started=new Promise(r=>{entered=r;});
 const {AiClient}=require('../desk-v1/src/main/ai-client');const client=new AiClient({getConfig:()=>({ai:{baseUrl:'http://127.0.0.1:9999',model:'fixture'}}),fetchImpl:async(_url,{signal})=>{entered();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));}});
 const {backend}=await setup(t,{modelMode:'local',aiClient:client});
 const pending=backend.engine.aiClient.complete({messages:[{role:'user',content:'fixture'}],timeoutMs:30000});pending.catch(()=>{});await started;backend.dispose();assert.equal(aborted,true);await assert.rejects(pending);
});
test('uncertain managed result remains visible across refresh/restart and requires explicit review before AI restart',async t=>{
 const {ManagedSessionError}=require('../electron/managed-session.cjs');const {backend,dir}=await setup(t,{managedChat:async()=>{throw new ManagedSessionError('request_uncertain');}});
 await assert.rejects(backend.engine.aiClient.reply({systemPrompt:'fixture',thread:[{from:'buyer',content:'fixture'}],reviewContext:{storeId:'fixture-store',uid:'fixture-buyer',buyerMessage:'fixture question'}}));
 assert.equal(backend.snapshot().modelIssue.context.storeId,'fixture-store');
 assert.equal(backend.snapshot().modelIssue.context.uid,'fixture-buyer');
 assert.equal(backend.snapshot().modelIssue.context.buyerMessage,'fixture question');
 assert.match(backend.snapshot().modelIssue.context.requestId,/^[0-9a-f-]{36}$/);
 assert.equal(backend.snapshot().modelIssue.code,'request_uncertain');assert.match(backend.snapshot().modelIssue.message,/未确认|待确认/);
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
for(const outcome of ['input_not_found','send_unconfirmed','throws','throttled','unusable_reply'])test(`managed ${outcome} after generation isolates that conversation without another model ID or duplicate send`,async t=>{
 const {StoreWorker}=require('../desk-v1/src/main/reply-engine'),{METHODS}=require('../desk-v1/src/shared/adapter-contract');const ids=[];let sends=0;
 const {backend,dir}=await setup(t,{managedChat:async payload=>{ids.push(payload.client_request_id);return {choices:[{message:{content:outcome==='unusable_reply'?'{"reply":""}':'{"reply":"fixture generated reply"}'}}]};}});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const store=backend.snapshot().stores[0];
 const row={uid:'buyer',messages:[{msgId:'one-buyer-message',from:'buyer',type:'text',content:'fixture',ts:Date.now()}]},queue=[row];
 const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>queue.shift()||null,popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),release:async()=>{queue.push(row);return {ok:true};},sendText:async()=>{sends++;if(outcome==='throws')throw Error('raw platform detail must not be retained');return {ok:false,reason:outcome};}};
 const worker=new StoreWorker({store:{...store,aiEnabled:true},adapter,aiClient:backend.engine.aiClient,getConfig:()=>({ai:{systemPrompt:'rule'},reply:{enabled:true,maxInflight:1,staleMs:180000,fallbackAfterMs:1,fallbackText:'MUST NOT SEND',perUidMinIntervalMs:0,perStorePerMinuteMax:1,sendJitterMinMs:0,sendJitterMaxMs:0}})});
 if(outcome==='throttled')worker.sendWindow.push(Date.now());worker.running=true;backend.engine.workers.set(store.id,worker);
 for(let i=0;i<3;i++){await worker.tick();await worker.settle();}
 assert.equal(ids.length,1);assert.equal(new Set(ids).size,1);assert.equal(sends,['throttled','unusable_reply'].includes(outcome)?0:1);assert.equal(worker.running,true);assert.equal(backend.snapshot().modelIssue,null);
 const record=backend.snapshot().quality[0],event=record.events[0];assert.equal(event.code,outcome==='unusable_reply'?'generation_failed':outcome==='throttled'?'delivery_blocked':['throws','send_unconfirmed'].includes(outcome)?'delivery_unconfirmed':'delivery_failed');assert.ok(!JSON.stringify(record).includes('raw platform'));
 assert.equal(record.storeId,store.id);assert.equal(record.uid,'buyer');
 if(outcome!=='unusable_reply'){assert.equal(event.buyerMessage,'fixture');assert.equal(event.reply,'fixture generated reply');}
 backend.dispose();const restored=createBackend({dataDir:dir,modelMode:'managed'});t.after(()=>restored.dispose());assert.equal(restored.snapshot().modelIssue,null);assert.deepEqual(restored.snapshot().quality[0].events,event?[event]:[]);
});

test('reviewing delivery issue focuses its original conversation without sending or clearing it',async t=>{
 let focused='',sends=0;
 const {backend}=await setup(t,{adapterFactory:()=>({focusConversation:async uid=>{focused=uid;return {ok:true};},sendText:async()=>{sends++;return {ok:true};}})});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'测试店铺'}});
 const storeId=backend.snapshot().stores[0].id;
 backend.engine.aiClient.onDeliveryFailure({reason:'send_unconfirmed',storeId,uid:'original-buyer',buyerName:'测试买家',buyerMessage:'测试问题',reply:'待核对回答'});
 backend.ingest({type:'message:in',storeId,uid:'original-buyer',from:'buyer',content:'测试问题'});
 const record=backend.snapshot().quality[0];
 await backend.execute({action:'focus-conversation',storeId,conversationId:'original-buyer'});
 assert.equal(focused,'original-buyer');assert.equal(sends,0);
 await backend.execute({action:'review-conversation',values:{id:record.id,version:record.version,status:'passed',note:'核对完成'}});
 assert.equal(backend.snapshot().quality[0].status,'passed');assert.equal(sends,0);assert.equal(backend.snapshot().modelIssue,null);
});
test('managed requests queue across conversations instead of exceeding account concurrency',async t=>{let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let active=0,max=0,calls=0;const {backend}=await setup(t,{managedChat:async()=>{calls++;active++;max=Math.max(max,active);entered();if(calls===1)await gate;active--;return {choices:[{message:{content:'ok'}}]}}});const first=backend.engine.aiClient.complete({messages:[{role:'user',content:'a'}]});await started;const second=backend.engine.aiClient.complete({messages:[{role:'user',content:'b'}]});await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);release();await Promise.all([first,second]);assert.equal(max,1);assert.equal(calls,2);});
test('busy response stops queued requests before transport and preserves the original cause',async t=>{let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let calls=0;const {ManagedSessionError}=require('../electron/managed-session.cjs');const {backend}=await setup(t,{managedChat:async()=>{calls++;entered();await gate;throw new ManagedSessionError('service_busy')}});const first=backend.engine.aiClient.complete({messages:[{role:'user',content:'a'}]});await started;const second=backend.engine.aiClient.complete({messages:[{role:'user',content:'b'}]});const results=Promise.allSettled([first,second]);release();const settled=await results;assert.ok(settled.every(r=>r.status==='rejected'));assert.equal(calls,1);assert.equal(backend.snapshot().modelIssue.code,'service_busy');});
test('a queued generation invalidated by its worker never starts transport or creates an issue',async t=>{let release,entered,valid=true,calls=0;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const {backend}=await setup(t,{managedChat:async()=>{calls++;entered();await gate;return {choices:[{message:{content:'ok'}}]}}});const first=backend.engine.aiClient.complete({messages:[{role:'user',content:'a'}]});await started;const second=backend.engine.aiClient.complete({messages:[{role:'user',content:'b'}],isCurrent:()=>valid});const done=Promise.allSettled([first,second]);valid=false;release();const results=await done;assert.equal(calls,1);assert.equal(results[1].reason.code,'queued_canceled');assert.equal(backend.snapshot().modelIssue,null);});

test('one uncertain buyer does not stop automatic replies to another buyer',async t=>{
 const {StoreWorker}=require('../desk-v1/src/main/reply-engine'),{METHODS}=require('../desk-v1/src/shared/adapter-contract');
 const {backend}=await setup(t);await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'测试店'}});const store=backend.snapshot().stores[0],sent=[];
 const rows=['a','b'].map(uid=>({uid,messages:[{msgId:uid,from:'buyer',type:'text',content:'问题'+uid,ts:Date.now()}]}));
 const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>rows.shift()||null,popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),sendText:async uid=>{sent.push(uid);return uid==='a'?{ok:false,reason:'send_unconfirmed'}:{ok:true}}};
 const worker=new StoreWorker({store:{...store,aiEnabled:true},adapter,aiClient:backend.engine.aiClient,getConfig:()=>({ai:{systemPrompt:'rule'},reply:{enabled:true,maxInflight:1,staleMs:180000,perUidMinIntervalMs:0,sendJitterMinMs:0,sendJitterMaxMs:0}})});worker.running=true;backend.engine.workers.set(store.id,worker);await worker.tick();await worker.settle();await worker.tick();await worker.settle();assert.deepEqual(sent,['a','b']);assert.equal(worker.running,true);assert.equal(backend.snapshot().modelIssue,null);assert.equal(backend.snapshot().quality.find(r=>r.uid==='a').events[0].code,'delivery_unconfirmed');
});
test('delivery review callback failure cannot release an unknown send for automatic retry',async t=>{const {StoreWorker}=require('../desk-v1/src/main/reply-engine'),{METHODS}=require('../desk-v1/src/shared/adapter-contract');let sends=0,discarded=0,released=0;const store={id:'fixture',storeName:'fixture',aiEnabled:true};let pending={uid:'buyer',messages:[{msgId:'q',from:'buyer',type:'text',content:'q',ts:Date.now()}]};const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>{const row=pending;pending=null;return row},popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),sendText:async()=>{sends++;return {ok:false,reason:'send_unconfirmed'}},discard:async()=>{discarded++;return {ok:true}},release:async()=>{released++;return {ok:true}}};const aiClient={suppressFallback:true,reply:async()=>({reply:'fixture answer'}),onDeliveryFailure(){throw Error('disk failed')}};const worker=new StoreWorker({store,adapter,aiClient,getConfig:()=>({reply:{enabled:true,maxInflight:1,staleMs:180000,sendJitterMinMs:0,sendJitterMaxMs:0},ai:{systemPrompt:'rule'}})});worker.running=true;await worker.tick();await worker.settle();await worker.tick();await worker.settle();assert.equal(sends,1);assert.equal(discarded,1);assert.equal(released,0);assert.ok(worker.manualSuppressed.has('buyer'));});
test('new buyer message resumes that buyer after an uncertain old send without replaying the old input',async t=>{const {StoreWorker}=require('../desk-v1/src/main/reply-engine'),{METHODS}=require('../desk-v1/src/shared/adapter-contract');const questions=[];let sends=0;const {backend}=await setup(t,{managedChat:async payload=>{questions.push(payload.messages.at(-1).content);return {choices:[{message:{content:'{"reply":"受控回答"}'}}]}}});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const store=backend.snapshot().stores[0],queue=[];const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>queue.shift()||null,popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),sendText:async()=>{sends++;return sends===1?{ok:false,reason:'send_unconfirmed'}:{ok:true}}};const worker=new StoreWorker({store:{...store,aiEnabled:true},adapter,aiClient:backend.engine.aiClient,getConfig:()=>({ai:{systemPrompt:'rule'},reply:{enabled:true,maxInflight:1,staleMs:180000,perUidMinIntervalMs:0,sendJitterMinMs:0,sendJitterMaxMs:0}})});worker.running=true;backend.engine.workers.set(store.id,worker);const enqueue=(id,content,ts)=>{backend.ingest({type:'message:in',storeId:store.id,uid:'buyer',from:'buyer',content,msgId:id,ts});queue.push({uid:'buyer',messages:[{msgId:id,from:'buyer',type:'text',content,ts}]})};enqueue('old','旧问题',Date.now());await worker.tick();await worker.settle();await worker.tick();await worker.settle();assert.equal(sends,1);assert.ok(worker.manualSuppressed.has('buyer'));enqueue('new','全新的问题',Date.now()+2000);await worker.tick();await worker.settle();assert.equal(sends,2);assert.equal(questions.length,2);assert.ok(questions[1].includes('全新的问题'));assert.equal(backend.snapshot().quality[0].status,'pending');assert.equal(backend.snapshot().quality[0].events[0].resolved,true);});
test('quality release never clears explicit manual takeover',()=>{const {StoreWorker}=require('../desk-v1/src/main/reply-engine');const worker=new StoreWorker({store:{id:'fixture',aiEnabled:true},adapter:{id:'fixture',accessMode:'webview',...Object.fromEntries(require('../desk-v1/src/shared/adapter-contract').METHODS.map(k=>[k,async()=>({ok:true})]))},aiClient:{reply:async()=>({reply:'fixture'})},getConfig:()=>({reply:{enabled:true}})});worker.takeOver('buyer','quality');worker.takeOver('buyer');worker.takeOver('buyer','quality');assert.equal(worker.clearManualSuppression('buyer','quality'),false);assert.ok(worker.manualSuppressed.has('buyer'));});
