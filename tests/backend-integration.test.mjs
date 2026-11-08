import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('collection failure and recovery appear in actual store status',async()=>{
 const {create}=setup(),b=create();await b.execute({action:'add-store',values:{storeName:'采集状态',platform:'pdd-web'}});const id=b.snapshot().stores[0].id;
 b.ingest({type:'collection:lost',storeId:id,reasonText:'采集连接中断'});assert.equal(b.snapshot().stores[0].runtime.collectionError,'采集连接中断');
 b.ingest({type:'collection:resumed',storeId:id});assert.equal(b.snapshot().stores[0].runtime.collectionError,'');b.dispose();
});
test('closing during open does not restart collection after completion',async()=>{
 const {dir}=setup();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let open=false;
 const b=require('../electron/backend.cjs').createBackend({dataDir:dir,adapterFactory:()=>({drainEvents:async()=>({events:[],seq:0})}),managerFactory:()=>({open:async()=>{entered();await gate;open=true},close(){open=false},stateOf:()=>({open,online:open}),closeAll(){open=false}})});
 await b.execute({action:'add-store',values:{storeName:'打开竞态',platform:'pdd-web'}});const id=b.snapshot().stores[0].id;
 const pending=b.execute({action:'open-store',storeId:id});await started;await b.execute({action:'close-store',storeId:id});release();await pending.catch(()=>{});
 assert.equal(b.snapshot().stores[0].runtime.open,false);assert.equal(b.monitor.watchers.has(id),false);b.dispose();
});
test('handoff survives seller echo and only explicit manual reply clears it',async()=>{
 const {create}=setup(),b=create();await b.execute({action:'add-store',values:{storeName:'预警店铺',platform:'pdd-web'}});const id=b.snapshot().stores[0].id;
 const event={type:'message:in',storeId:id,uid:'buyer',from:'buyer',content:'投诉',ts:1,msgId:'m1'};b.ingest(event);b.ingest({type:'reply:transfer',storeId:id,uid:'buyer'});
 b.ingest({...event,from:'seller',content:'正在转人工',ts:2,msgId:'m2'});assert.equal(b.snapshot().conversations[0].status,'handoff');b.ingest(event);assert.equal(b.snapshot().conversations[0].status,'handoff');b.ingest({...event,from:'seller',content:'正在转人工',ts:3,msgId:'m2',manual:true});assert.equal(b.snapshot().conversations[0].status,'replied');b.dispose();
});
test('disable while AI starts cannot revive a worker',async()=>{
 const {dir}=setup();let release,entered;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const methods=['popMerchantSent','preparePending','pendingSnapshot','conversationHistory','sendText','sendImage','sendVideo','release','discard','syncAiEnabled','focusConversation'];
 const adapter={id:'test',accessMode:'webview',supports:()=>true,...Object.fromEntries(methods.map(k=>[k,async()=>({ok:true})])),popPending:async()=>null,ensure:async()=>{entered();await gate;return {ok:true}}};
 const b=require('../electron/backend.cjs').createBackend({dataDir:dir,adapterFactory:()=>adapter,managerFactory:()=>({stateOf:()=>({open:true,online:true}),closeAll(){}})});
 await b.execute({action:'add-store',values:{storeName:'竞态',platform:'pdd-web'}});
 await b.execute({action:'save-model-settings',values:{baseUrl:'http://127.0.0.1:9999/v1',model:'test'}});
 const id=b.snapshot().stores[0].id;
 const enabling=b.execute({action:'set-ai',storeId:id,values:{enabled:true}});
 await started;await b.execute({action:'set-ai',storeId:id,values:{enabled:false}});release();await enabling.catch(()=>{});
 assert.equal(b.snapshot().stores[0].aiEnabled,false);assert.equal(b.engine.worker(id),null);b.dispose();
});
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-backend-'));return {dir,create:()=>require('../electron/backend.cjs').createBackend({dataDir:dir})};}
test('real stores and config survive restart while AI resets off',async()=>{const {create}=setup();let b=create();const a=await b.execute({action:'add-store',values:{storeName:'接线测试',platform:'pdd-web'}});assert.equal(a.status,'ok');await b.execute({action:'save-config',screenId:'UX17',values:{prompt:'真实保存的规则'}});const id=b.snapshot().stores[0].id;assert.equal(b.snapshot().stores[0].aiEnabled,false);b.dispose();b=create();assert.equal(b.snapshot().stores[0].id,id);assert.equal(b.snapshot().config.ai.systemPrompt,'真实保存的规则');assert.equal(b.snapshot().config.reply.enabled,false);b.dispose();});
test('unsupported operations and fake conversation sends reject honestly',async()=>{const {create}=setup();const b=create();await assert.rejects(()=>b.execute({action:'save-tasks',values:{items:[]}}),/尚未接入/);await assert.rejects(()=>b.execute({action:'send-reply',storeId:'fake',conversationId:'fake',values:{reply:'不可发送'}}),/店铺/);await assert.rejects(()=>b.execute({action:'add-store',values:{storeName:'未支持',platform:'xianyu-web'}}),/平台/);b.dispose();});
test('selection and bounded message history persist and route exact manual sends',async()=>{const {dir}=setup();const sent=[];const methods=['ensure','preparePending','popPending','pendingSnapshot','conversationHistory','sendText','sendImage','sendVideo','release','discard','syncAiEnabled','focusConversation'];const adapter={id:'test',accessMode:'webview',supports:()=>true,...Object.fromEntries(methods.map(k=>[k,async()=>({ok:true})])),sendText:async(uid,text)=>{sent.push({uid,text});return {ok:true,msgId:'s1'}}};const b=require('../electron/backend.cjs').createBackend({dataDir:dir,adapterFactory:()=>adapter,managerFactory:()=>({stateOf:()=>({open:true,online:true}),closeAll(){}})});await b.execute({action:'add-store',values:{storeName:'店A',platform:'pdd-web'}});const id=b.snapshot().stores[0].id;b.ingest({type:'message:in',storeId:id,uid:'buyer-a',from:'buyer',content:'问题',ts:1});await b.execute({action:'select-conversation',storeId:id,conversationId:'buyer-a'});await b.execute({action:'send-reply',storeId:id,conversationId:'buyer-a',values:{reply:'人工回复'}});assert.deepEqual(sent,[{uid:'buyer-a',text:'人工回复'}]);assert.equal(b.snapshot().conversations[0].messages.length,2);assert.equal(b.snapshot().conversations[0].status,'replied');b.dispose();const c=require('../electron/backend.cjs').createBackend({dataDir:dir});assert.equal(c.snapshot().conversations[0].messages.length,2);c.dispose();});

