import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {createBackend}=createRequire(import.meta.url)('../electron/backend.cjs');

test('AI banned words validate, persist, and reach the live engine',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-banned-'));
 let backend=createBackend({dataDir});
 const rules=[{word:'微信客服',replacement:'人工客服'},{word:'微信',replacement:''}];
 await backend.execute({action:'save-banned-words',values:{rules}});
 assert.deepEqual(backend.snapshot().bannedWords,rules);
 assert.deepEqual(backend.engine.getConfig('any').safety.bannedWords,rules);
 await backend.execute({action:'add-store',values:{storeName:'测试店',platform:'pdd-web'}});
 const id=backend.snapshot().selection.storeId;
 backend.ingest({type:'message:in',storeId:id,uid:'buyer',from:'buyer',content:'你好',msgId:'fixture',ts:1});
 backend.ingest({type:'reply:needs-manual',storeId:id,uid:'buyer',reason:'banned_empty'});
 assert.equal(backend.snapshot().conversations[0].status,'handoff');
 await assert.rejects(()=>backend.execute({action:'save-banned-words',values:{rules:[{word:'',replacement:''}]}}));
 await assert.rejects(()=>backend.execute({action:'save-banned-words',values:{rules:[{word:'微信',replacement:''},{word:'微信',replacement:'其他'}]}}));
 assert.deepEqual(backend.snapshot().bannedWords,rules);
 backend.dispose();backend=createBackend({dataDir});
 assert.deepEqual(backend.snapshot().bannedWords,rules);
 await backend.execute({action:'save-banned-words',values:{rules:[]}});
 backend.dispose();backend=createBackend({dataDir});assert.deepEqual(backend.snapshot().bannedWords,[]);backend.dispose();
});
