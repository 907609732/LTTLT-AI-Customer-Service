import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
const make=opts=>{const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-remove-store-'));return {dataDir,create:()=>require('../electron/backend.cjs').createBackend({dataDir,...opts})};};
test('removal requires explicit confirmation, closes only its store and persists with a recovery archive',async()=>{
 const closed=[];const {create,dataDir}=make({managerFactory:()=>({close:id=>closed.push(id),stateOf:()=>({open:false,online:false}),closeAll(){}})});let b=create();
 await b.execute({action:'add-store',values:{storeName:'保留店铺',platform:'pdd-web'}});const keep=b.snapshot().stores[0].id;
 await b.execute({action:'add-store',values:{storeName:'待删除店铺',platform:'pdd-web'}});const id=b.snapshot().selection.storeId;
 b.ingest({type:'message:in',storeId:id,uid:'fixture-buyer',from:'buyer',content:'本地验收会话',msgId:'m1',ts:1});
 await assert.rejects(()=>b.execute({action:'remove-store',storeId:id}),/确认/);assert.equal(b.snapshot().stores.length,2);
 await b.execute({action:'remove-store',storeId:id,values:{confirmed:true}});assert.deepEqual(closed,[id]);assert.equal(b.snapshot().stores.length,1);assert.equal(b.snapshot().selection.storeId,keep);assert.equal(b.monitor.watchers.has(id),false);assert.equal(b.engine.worker(id),null);assert.equal(b.snapshot().conversations.length,0);
 const archive=JSON.parse(fs.readFileSync(path.join(dataDir,'removed-stores',id+'.json'),'utf8'));assert.equal(archive.store.storeName,'待删除店铺');assert.equal(archive.conversations[0].messages[0].content,'本地验收会话');
 b.dispose();b=create();assert.equal(b.snapshot().stores.length,1);assert.equal(b.snapshot().stores[0].id,keep);await b.execute({action:'remove-store',storeId:keep,values:{confirmed:true}});assert.equal(b.snapshot().selection.storeId,'');b.dispose();
});
test('group edits survive restart and unknown stores cannot be removed',async()=>{
 const {create}=make();let b=create();await b.execute({action:'add-store',values:{storeName:'分组店铺',platform:'pdd-web'}});const id=b.snapshot().selection.storeId;
 await b.execute({action:'set-store-group',storeId:id,values:{group:' 主店 '}});b.dispose();b=create();assert.equal(b.snapshot().stores[0].group,'主店');await assert.rejects(()=>b.execute({action:'remove-store',storeId:'unknown',values:{confirmed:true}}),/有效店铺/);assert.equal(b.snapshot().stores.length,1);b.dispose();
});
test('busy opening and failed window closure cannot remove the account',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const {create}=make({managerFactory:()=>({open:async()=>{entered();await gate;},close(){throw Error('窗口关闭失败')},stateOf:()=>({open:false,online:false}),closeAll(){}})});const b=create();
 await b.execute({action:'add-store',values:{storeName:'操作中店铺',platform:'pdd-web'}});const id=b.snapshot().selection.storeId;
 const opening=b.execute({action:'open-store',storeId:id}).catch(()=>{});await started;
 await assert.rejects(()=>b.execute({action:'remove-store',storeId:id,values:{confirmed:true}}),/正在/);assert.equal(b.snapshot().stores.length,1);release();await opening;
 await assert.rejects(()=>b.execute({action:'remove-store',storeId:id,values:{confirmed:true}}),/窗口关闭失败/);assert.equal(b.snapshot().stores.length,1);b.dispose();
});

