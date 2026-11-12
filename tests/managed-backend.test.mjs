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
for(const outcome of ['input_not_found','send_unconfirmed','throws','unusable_reply'])test(`managed ${outcome} after generation isolates that conversation without another model ID or duplicate send`,async t=>{
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

for(const gate of ['uid_interval','store_rate'])test(`managed ${gate} waits without quality hold or repeated generation`,async t=>{
 const {StoreWorker}=require('../desk-v1/src/main/reply-engine'),{METHODS}=require('../desk-v1/src/shared/adapter-contract');let calls=0,sends=0,clock=Date.now();const {backend}=await setup(t,{managedChat:async()=>{calls++;return {choices:[{message:{content:'{"reply":"answer"}'}}]}}});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'fixture'}});const store=backend.snapshot().stores[0];const row={uid:'buyer',messages:[{msgId:'fresh',from:'buyer',type:'text',content:'question',ts:clock}]},queue=[row];const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>queue.shift()||null,popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),release:async()=>{queue.push(row);return {ok:true}},sendText:async()=>{sends++;return {ok:true}}};const worker=new StoreWorker({store:{...store,aiEnabled:true},adapter,aiClient:backend.engine.aiClient,now:()=>clock,getConfig:()=>({reply:{enabled:true,maxInflight:1,staleMs:180000,perUidMinIntervalMs:60000,perStorePerMinuteMax:1,sendJitterMinMs:0,sendJitterMaxMs:0}})});worker.running=true;backend.engine.workers.set(store.id,worker);if(gate==='uid_interval')worker.lastSentAt.set('buyer',clock);else worker.sendWindow.push(clock);for(let i=0;i<3;i++){await worker.tick();await worker.settle()}assert.equal(calls,0);assert.equal(sends,0);assert.equal(worker.manualSuppressed.size,0);assert.equal(backend.snapshot().quality.length,0);clock+=60001;await worker.tick();await worker.settle();assert.equal(calls,1);assert.equal(sends,1);
});

test('product knowledge reaches managed reception and training only for its store',async t=>{
 const calls=[];const {backend}=await setup(t,{managedChat:async payload=>{calls.push(payload.messages);return {choices:[{message:{content:'{"reply":"测试"}'}}]};}});
 for(const name of ['甲店','乙店'])await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:name}});
 const [a,b]=backend.snapshot().stores;
 await backend.execute({action:'save-product',storeId:a.id,values:{productId:'1',title:'智能门锁',description:'仅甲店支持 NFC'}});
 const thread=[{from:'buyer',type:'text',content:'门锁支持 NFC 吗'}];
 await backend.engine.aiClient.reply({systemPrompt:'规则',thread,reviewContext:{storeId:a.id}});
 assert.match(calls.at(-1)[1].content,/仅甲店支持 NFC/);
 await backend.engine.aiClient.reply({systemPrompt:'规则',thread,reviewContext:{storeId:b.id}});
 assert.doesNotMatch(calls.at(-1)[1].content,/仅甲店支持 NFC/);
 await backend.execute({action:'start-training',storeId:a.id,values:{question:'门锁支持 NFC 吗',history:[]}});
 assert.match(calls.at(-1)[1].content,/仅甲店支持 NFC/);
 await assert.rejects(backend.execute({action:'list-products',storeId:'missing'}),/有效店铺/);
});

test('intent binding reaches managed replies and training without leaking other stores',async t=>{
 let messages;const {backend}=await setup(t,{managedChat:async payload=>{messages=payload.messages;return {choices:[{message:{content:'{"reply":"测试"}'}}]};}});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'意图测试'}});const id=backend.snapshot().stores[0].id;
 await backend.execute({action:'save-intent-pack',values:{name:'发货包',enabled:true,storeIds:[id],productIds:[],entries:[{question:'何时发货',keywords:['发货'],answer:'本店48小时发货',enabled:true}]}});
 await backend.execute({action:'start-training',storeId:id,values:{question:'何时发货',history:[]}});assert.match(messages[1].content,/本店48小时发货/);
 await assert.rejects(backend.execute({action:'save-intent-pack',values:{name:'坏绑定',enabled:true,storeIds:['missing'],productIds:[],entries:[{question:'发货',keywords:[],answer:'错误',enabled:true}]}}),/有效店铺/);
});

test('商品专用意图在训练中必须指定有效本店商品',async t=>{
 let messages;const {backend}=await setup(t,{managedChat:async payload=>{messages=payload.messages;return {choices:[{message:{content:'{"reply":"测试"}'}}]};}});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'测试'}});const id=backend.snapshot().stores[0].id;
 await backend.execute({action:'save-product',storeId:id,values:{productId:'sku',title:'型号专用门锁'}});
 await backend.execute({action:'save-intent-pack',values:{name:'专用',enabled:true,storeIds:[id],productIds:['sku'],entries:[{question:'安装方法',keywords:['安装'],answer:'专用安装方法ABC',enabled:true}]}});
 await backend.execute({action:'start-training',storeId:id,values:{question:'安装方法',history:[],productId:'sku'}});assert.match(messages[1].content,/专用安装方法ABC/);
 await assert.rejects(backend.execute({action:'start-training',storeId:id,values:{question:'安装方法',history:[],productId:'missing'}}),/商品/);
});

test('correction learning validates conversation version, records source and is idempotent',async t=>{
 const {backend}=await setup(t);await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'纠错店'}});const id=backend.snapshot().stores[0].id;backend.ingest({type:'message:in',storeId:id,uid:'buyer',from:'buyer',content:'何时发货',msgId:'q',ts:Date.now()});const row=backend.snapshot().quality[0];const message=backend.snapshot().conversations[0].messages[0];
 const command={action:'learn-conversation-correction',storeId:id,conversationId:'buyer',values:{recordId:row.id,version:row.version,question:message.content,messageTs:message.ts,answer:'48小时内发货',confirmed:true}};
 await assert.rejects(backend.execute({...command,conversationId:'wrong'}),/会话/);await assert.rejects(backend.execute({...command,values:{...command.values,version:0}}),/更新/);await assert.rejects(backend.execute({...command,values:{...command.values,confirmed:false}}),/确认/);
 await backend.execute(command);await backend.execute(command);const packs=(await backend.execute({action:'list-intent-packs'})).data.packs;assert.equal(packs.length,1);assert.equal(packs[0].source.uid,'buyer');assert.equal(packs[0].source.recordId,row.id);assert.deepEqual(packs[0].storeIds,[id]);assert.equal(backend.snapshot().conversations[0].messages.length,1);assert.equal(backend.snapshot().stores[0].aiEnabled,false);
});

test('store-bound rule profiles drive both workers and training without enabling reception',async t=>{
 let messages;const {backend}=await setup(t,{managedChat:async p=>{messages=p.messages;return {choices:[{message:{content:'{"reply":"测试"}'}}]};}});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'规则店'}});const id=backend.snapshot().stores[0].id;const saved=await backend.execute({action:'save-model-profile',values:{name:'规则方案',prompt:'当前店铺独有规则ABC',maxReplyChars:100}});const list=await backend.execute({action:'list-model-profiles'});await backend.execute({action:'bind-model-profile',storeId:id,values:{profileId:saved.data.id,revision:list.data.revision}});
 assert.equal(backend.engine.getConfig(id).ai.systemPrompt,'当前店铺独有规则ABC');await backend.execute({action:'start-training',storeId:id,values:{question:'你好',history:[]}});assert.match(messages[0].content,/当前店铺独有规则ABC/);assert.equal(backend.snapshot().stores[0].aiEnabled,false);
});

test('welcome settings persist per store and actual workers append welcome once in the real send path',async t=>{
 const {METHODS}=require('../desk-v1/src/shared/adapter-contract');let queue=[],sent=[];const adapter={id:'fixture',accessMode:'webview',...Object.fromEntries(METHODS.map(k=>[k,async()=>({ok:true})])),popPending:async()=>queue.shift()||null,popMerchantSent:async()=>[],conversationHistory:async()=>({ok:true,messages:[]}),sendText:async(uid,text)=>{sent.push(text);return {ok:true};}};
 const {backend}=await setup(t,{adapterFactory:()=>adapter});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'欢迎店'}});const id=backend.snapshot().stores[0].id;
 await backend.execute({action:'save-welcome',storeId:id,values:{text:'欢迎光临',enabled:true,version:0}});assert.equal(backend.snapshot().welcomeByStore[id].enabled,true);
 const ts=Date.now();backend.ingest({type:'message:in',storeId:id,uid:'new',from:'buyer',content:'你好',ts});queue.push({uid:'new',messages:[{from:'buyer',type:'text',content:'你好',ts,msgId:'first'}]});await backend.execute({action:'set-ai',storeId:id,values:{enabled:true}});const worker=backend.engine.worker(id);worker.getConfig=()=>({ai:{systemPrompt:'rule'},reply:{enabled:true,perUidMinIntervalMs:0,sendJitterMinMs:0,sendJitterMaxMs:0,fallbackAfterMs:0}});await worker.tick();await worker.settle();assert.deepEqual(sent,['欢迎光临\n托管回答']);
 queue.push({uid:'new',messages:[{from:'buyer',type:'text',content:'第二问',ts:Date.now()+1,msgId:'second'}]});await worker.tick();await worker.settle();assert.equal(sent[1],'托管回答');await assert.rejects(backend.execute({action:'save-welcome',storeId:'missing',values:{text:'x',enabled:true,version:0}}),/有效店铺/);
});

test('managed image reception requires store opt-in and actual server capability',async t=>{let captured;const {backend}=await setup(t,{managedCapabilities:()=>({vision:true,model:'qwen3-vl-plus',maxImages:4}),managedChat:async p=>{captured=p.messages;return {choices:[{message:{content:'{"reply":"这是图片中的门锁"}'}}]};}});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'识图店'}});const id=backend.snapshot().stores[0].id;await backend.execute({action:'save-vision-settings',storeId:id,values:{enabled:true,version:0}});assert.equal(backend.snapshot().visionByStore[id].enabled,true);const thread=[{from:'buyer',type:'image',content:'https://images.example.com/lock.png'}];await backend.engine.aiClient.reply({thread,reviewContext:{storeId:id}});assert.equal(captured[1].content.at(-1).image_url.url,'https://images.example.com/lock.png');await assert.rejects(backend.engine.aiClient.reply({thread,reviewContext:{storeId:'other'}}),{code:'vision_unavailable'});const other=await setup(t);await other.backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'未支持店'}});await assert.rejects(other.backend.execute({action:'save-vision-settings',storeId:other.backend.snapshot().stores[0].id,values:{enabled:true,version:0}}),/识图|图片/);});

test('training sends selected-store images through the same opted-in model without buyer delivery',async t=>{let messages;const {backend}=await setup(t,{managedCapabilities:()=>({vision:true,model:'qwen3-vl-plus',maxImages:4}),managedChat:async p=>{messages=p.messages;return {choices:[{message:{content:'{"reply":"识图测试结果"}'}}]};}});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'训练识图'}});const id=backend.snapshot().stores[0].id;await backend.execute({action:'save-vision-settings',storeId:id,values:{enabled:true,version:0}});const result=await backend.execute({action:'start-training',storeId:id,values:{question:'这是什么',history:[],images:['https://images.example.com/a.png']}});assert.equal(result.data.reply,'识图测试结果');assert.equal(messages[1].content.at(-1).type,'image_url');assert.equal(backend.snapshot().stores[0].aiEnabled,false);await assert.rejects(backend.execute({action:'start-training',values:{question:'这是什么',history:[],images:['https://images.example.com/a.png']}}),/店铺/);});

test('message identity enrichment avoids duplicate AI echo while retaining repeated buyer messages',async t=>{const {backend}=await setup(t);await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'消息元数据'}});const id=backend.snapshot().stores[0].id,ts=Date.now();backend.ingest({type:'reply:sent',storeId:id,uid:'u',text:'已回复',ts});backend.ingest({type:'message:in',storeId:id,uid:'u',from:'seller',content:'已回复',ts:ts+1,msgId:'seller-id',messageType:'text'});let c=backend.snapshot().conversations[0];assert.equal(c.messages.length,1);assert.equal(c.messages[0].msgId,'seller-id');for(const msgId of ['buyer-1','buyer-2'])backend.ingest({type:'message:in',storeId:id,uid:'u',from:'buyer',content:'同一句问题',ts:ts+2,msgId,messageType:'text'});assert.equal(backend.snapshot().conversations[0].messages.length,3);});

test('conversation-product capture previews first and confirms against store scope and revision',async t=>{const {backend}=await setup(t,{adapterFactory:()=>({consultGoods:async()=>({ok:true,goods:{goodsId:'goods-1',goodsName:'明确会话商品',source:'conversation-message',observedAt:123,messageId:'msg-product'}}),syncAiEnabled:async()=>{}})});await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'采集店'}});const storeId=backend.snapshot().stores[0].id;backend.ingest({type:'message:in',storeId,uid:'buyer',from:'buyer',content:'商品咨询',ts:Date.now()});const preview=await backend.execute({action:'preview-consulted-product',storeId,conversationId:'buyer'});assert.equal((await backend.execute({action:'list-products',storeId})).data.total,0);await assert.rejects(backend.execute({action:'confirm-consulted-product',storeId,conversationId:'wrong',values:{token:preview.data.token,confirmed:true}}),/会话|店铺/);await backend.execute({action:'confirm-consulted-product',storeId,conversationId:'buyer',values:{token:preview.data.token,confirmed:true}});const row=(await backend.execute({action:'list-products',storeId})).data.items[0];assert.equal(row.productId,'goods-1');assert.equal(row.source.kind,'conversation');assert.equal(row.source.messageId,'msg-product');await assert.rejects(backend.execute({action:'confirm-consulted-product',storeId,conversationId:'buyer',values:{token:preview.data.token,confirmed:true}}),/过期|已使用/);});

test('product capture rejects recommendation guesses, offline stores and stale previews without overwriting manual knowledge',async t=>{
 let online=true,goods={goodsId:'g',goodsName:'消息商品',source:'recommendation',observedAt:123,messageId:'m'};
 const {backend}=await setup(t,{managerFactory:()=>({stateOf:()=>({open:true,online}),closeAll(){}}),adapterFactory:()=>({consultGoods:async()=>({ok:true,goods}),syncAiEnabled:async()=>{}})});
 await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'采集保护店'}});const storeId=backend.snapshot().stores[0].id;
 backend.ingest({type:'message:in',storeId,uid:'buyer',from:'buyer',content:'问商品',ts:Date.now()});
 const preview=()=>backend.execute({action:'preview-consulted-product',storeId,conversationId:'buyer'});
 await assert.rejects(preview(),/明确|商品/);goods={...goods,source:'conversation-message'};online=false;await assert.rejects(preview(),/登录|在线/);online=true;
 const old=(await backend.execute({action:'save-product',storeId,values:{productId:'g',title:'人工标题',code:'code',description:'人工完整说明',enabled:false,skus:[{skuId:'s',attributes:'黑色',stock:7}]}})).data;
 const first=await preview();await backend.execute({action:'save-product',storeId,values:{...old,description:'更新说明'}});
 await assert.rejects(backend.execute({action:'confirm-consulted-product',storeId,conversationId:'buyer',values:{token:first.data.token,confirmed:true}}),/更新|重新预览/);
 const current=await preview();await assert.rejects(backend.execute({action:'confirm-consulted-product',storeId,conversationId:'buyer',values:{token:current.data.token,confirmed:false}}),/确认/);
 await backend.execute({action:'confirm-consulted-product',storeId,conversationId:'buyer',values:{token:current.data.token,confirmed:true}});
 const row=(await backend.execute({action:'list-products',storeId})).data.items[0];assert.equal(row.title,'消息商品');assert.equal(row.description,'更新说明');assert.equal(row.code,'code');assert.equal(row.skus[0].stock,7);assert.equal(row.enabled,false);assert.equal(backend.snapshot().stores[0].aiEnabled,false);
});

test('product JSON IPC round-trips SKU data only into the chosen store and selected product reaches model context',async t=>{
 let messages;const {backend}=await setup(t,{managedChat:async p=>{messages=p.messages;return {choices:[{message:{content:'{"reply":"测试"}'}}]};}});
 for(const storeName of ['源店','目标店'])await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName}});const [a,b]=backend.snapshot().stores;
 await backend.execute({action:'save-product',storeId:a.id,values:{productId:'g',title:'隔离门锁',code:'CODE',skus:[{skuId:'red',attributes:'红色',stock:2}]}});
 const json=(await backend.execute({action:'export-products',storeId:a.id,values:{format:'json'}})).data.json;assert.equal(typeof json,'string');
 const preview=(await backend.execute({action:'preview-product-import',storeId:b.id,values:{format:'json',json}})).data;
 await backend.execute({action:'import-products',storeId:b.id,values:{format:'json',json,revision:preview.revision,mode:'skip',confirmed:true}});
 assert.equal((await backend.execute({action:'list-products',storeId:b.id})).data.items[0].skus[0].stock,2);
 await backend.execute({action:'start-training',storeId:b.id,values:{question:'有现货吗',productId:'g',history:[]}});assert.match(messages[1].content,/CODE/);assert.match(messages[1].content,/红色/);assert.match(messages[1].content,/参考库存|非实时/);
});

test('correction IPC appends to the explicitly chosen eligible pack and preserves conversation protections',async t=>{
 const {backend}=await setup(t);await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'指定纠错店'}});const storeId=backend.snapshot().stores[0].id;
 const target=(await backend.execute({action:'save-intent-pack',values:{name:'指定知识包',enabled:true,storeIds:[storeId],productIds:[],entries:[{question:'原条目',keywords:[],answer:'原答案',enabled:true}]}})).data;
 backend.ingest({type:'message:in',storeId,uid:'buyer',from:'buyer',content:'保修多久',ts:123});const record=backend.snapshot().quality[0];
 const command={action:'learn-conversation-correction',storeId,conversationId:'buyer',values:{targetPackId:target.id,targetVersion:target.version,recordId:record.id,version:record.version,question:'保修多久',messageTs:123,answer:'人工核对答案',confirmed:true}};
 await assert.rejects(backend.execute({...command,values:{...command.values,targetPackId:undefined}}),/知识包|版本/);
 await assert.rejects(backend.execute({...command,values:{...command.values,targetVersion:undefined}}),/知识包|版本/);
 await backend.execute(command);await backend.execute(command);const packs=(await backend.execute({action:'list-intent-packs'})).data.packs;assert.equal(packs.length,1);assert.equal(packs[0].id,target.id);assert.equal(packs[0].entries.length,2);assert.equal(packs[0].corrections[0].source.uid,'buyer');assert.equal(backend.snapshot().conversations[0].messages.length,1);assert.equal(backend.snapshot().quality[0].status,'pending');assert.equal(backend.snapshot().stores[0].aiEnabled,false);
});
