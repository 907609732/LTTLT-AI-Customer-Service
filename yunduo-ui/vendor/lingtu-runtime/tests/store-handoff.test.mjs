import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBackend}=require('../electron/backend.cjs');

test('per-store keywords persist independently and older stores inherit the global setting',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-handoff-'));
 let backend=createBackend({dataDir});
 await backend.execute({action:'add-store',values:{storeName:'甲店',platform:'pdd-web'}});
 const a=backend.snapshot().selection.storeId;
 await backend.execute({action:'add-store',values:{storeName:'乙店',platform:'pdd-web'}});
 const b=backend.snapshot().selection.storeId;
 const original=backend.snapshot().config.safety.handoffKeywords;
 assert.deepEqual(backend.engine.getConfig(a).safety.handoffKeywords,original);
 await backend.execute({action:'save-store-handoff',storeId:a,values:{mode:'custom',keywords:['退款','人工']}});
 await backend.execute({action:'save-store-handoff',storeId:b,values:{mode:'custom',keywords:[]}});
 assert.deepEqual(backend.engine.getConfig(a).safety.handoffKeywords,['退款','人工']);
 assert.deepEqual(backend.engine.getConfig(b).safety.handoffKeywords,[]);
 assert.deepEqual(backend.snapshot().config.safety.handoffKeywords,original);
 await assert.rejects(()=>backend.execute({action:'save-store-handoff',storeId:a,values:{mode:'custom',keywords:['x'.repeat(31)]}}));
 await assert.rejects(()=>backend.execute({action:'save-store-handoff',storeId:'unknown',values:{mode:'custom',keywords:['a']}}));
 assert.deepEqual(backend.engine.getConfig(a).safety.handoffKeywords,['退款','人工']);
 backend.dispose(); backend=createBackend({dataDir});
 assert.deepEqual(backend.snapshot().handoffByStore[a].keywords,['退款','人工']);
 assert.deepEqual(backend.engine.getConfig(b).safety.handoffKeywords,[]);
 await backend.execute({action:'save-store-handoff',storeId:a,values:{mode:'inherit'}});
 assert.equal(backend.snapshot().handoffByStore[a],undefined);
 assert.deepEqual(backend.engine.getConfig(a).safety.handoffKeywords,original);
 await backend.execute({action:'save-config',screenId:'UX08',values:{handoffKeywords:['新的全局词']}});
 assert.deepEqual(backend.engine.getConfig(a).safety.handoffKeywords,['新的全局词']);
 assert.deepEqual(backend.engine.getConfig(b).safety.handoffKeywords,[]);
 backend.dispose();
});

test('corrupt stored rules are never silently replaced',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-handoff-corrupt-'));
 const file=path.join(dataDir,'store-handoff.json');
 fs.writeFileSync(file,'{broken');
 assert.throws(()=>createBackend({dataDir}),/配置损坏/);
 assert.equal(fs.readFileSync(file,'utf8'),'{broken');
});

