import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {StoreRegistry}=require('../desk-v1/src/main/store-registry');
const {createBackend}=require('../electron/backend.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-pdd-login-'));

test('unnamed PDD identity survives restart without saving placeholder text',()=>{
 const file=path.join(temp(),'stores.json'),registry=new StoreRegistry({file});
 const store=registry.add({platform:'pdd-web'});
 assert.equal(store.storeName,'');assert.equal(store.aiEnabled,false);
 registry.update(store.id,{storeName:'识别出的店铺',mallId:'10001',customerServiceName:'客服01',customerServiceId:'20001'});
 const saved=new StoreRegistry({file}).get(store.id);
 assert.equal(saved.storeName,'识别出的店铺');assert.equal(saved.mallId,'10001');assert.equal(saved.customerServiceName,'客服01');
 assert.throws(()=>registry.add({platform:'doudian-client'}));
});

test('confirming unnamed PDD opens that store and keeps AI disabled',async()=>{
 let opened='';const b=createBackend({dataDir:temp(),managerFactory:()=>({open:async id=>{opened=id},stateOf:id=>({open:id===opened,online:false}),closeAll(){}})});
 try{const r=await b.execute({action:'add-store',values:{platform:'pdd-web',openAfterAdd:true}});const s=b.snapshot().stores[0];assert.equal(opened,s.id);assert.equal(r.data.id,s.id);assert.equal(s.storeName,'');assert.equal(s.aiEnabled,false);assert.equal(b.snapshot().selection.storeId,s.id);}finally{b.dispose()}
});

test('opening failure preserves the created store for retry instead of rejecting addition',async()=>{
 const b=createBackend({dataDir:temp(),managerFactory:()=>({open:async()=>{throw Error('network down')},stateOf:()=>({open:false,online:false}),closeAll(){}})});
 try{const r=await b.execute({action:'add-store',values:{platform:'pdd-web',openAfterAdd:true}});assert.equal(r.status,'ok');assert.equal(b.snapshot().stores.length,1);assert.equal(r.data.opened,false);assert.match(r.message,/重试/);}finally{b.dispose()}
});

test('collection starts only after login and stops on logout',async()=>{
 let notify,state={open:true,online:false,authenticated:false};
 const b=createBackend({dataDir:temp(),adapterFactory:()=>({drainEvents:async()=>({seq:0,events:[]}),syncAiEnabled:async()=>({ok:true})}),managerFactory:({onEvent})=>{notify=onEvent;return {open:async()=>{},stateOf:()=>state,closeAll(){}}}});
 try{await b.execute({action:'add-store',values:{platform:'pdd-web',openAfterAdd:true}});const id=b.snapshot().stores[0].id;
 assert.equal(b.monitor.watchers.has(id),false);
 state={open:true,online:true,authenticated:true};notify({type:'shop:login_state',storeId:id,authenticated:true,online:true});await new Promise(r=>setTimeout(r,20));assert.equal(b.monitor.watchers.has(id),true);
 state={open:true,online:false,authenticated:false};notify({type:'shop:login_state',storeId:id,authenticated:false,online:false});assert.equal(b.monitor.watchers.has(id),false);assert.equal(b.snapshot().stores[0].aiEnabled,false);
 }finally{b.dispose()}
});

for(const event of [{type:'shop:login_state',authenticated:false},{type:'shop:navigating'},{type:'shop:account_changed'}])test(`${event.type} cancels AI activation already waiting on platform readiness`,async()=>{
 let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const methods=['popMerchantSent','preparePending','pendingSnapshot','conversationHistory','sendText','sendImage','sendVideo','release','discard','syncAiEnabled','focusConversation'];
 const adapter={id:'pdd-web',accessMode:'webview',supports:()=>true,...Object.fromEntries(methods.map(k=>[k,async()=>({ok:true})])),popPending:async()=>null,ensure:async()=>{entered();await gate;return {ok:true}}};
 const b=createBackend({dataDir:temp(),adapterFactory:()=>adapter,managerFactory:()=>({stateOf:()=>({open:true,online:true}),closeAll(){}})});
 try{await b.execute({action:'add-store',values:{platform:'pdd-web'}});await b.execute({action:'save-model-settings',values:{baseUrl:'http://127.0.0.1:9999/v1',model:'test'}});const id=b.snapshot().stores[0].id;
 const enabling=b.execute({action:'set-ai',storeId:id,values:{enabled:true}}).catch(e=>e);await started;b.ingest({...event,storeId:id});release();await enabling;assert.equal(b.snapshot().stores[0].aiEnabled,false);assert.equal(b.engine.worker(id),null);
 }finally{release?.();b.dispose()}
});
