import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {createBackend}=createRequire(import.meta.url)('../electron/backend.cjs');

test('training uses model settings and banned words without calling a platform',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-training-'));
 const calls=[];
 const backend=createBackend({dataDir,aiClient:{reply:async req=>{calls.push(req);return {reply:'欢迎加微信',raw:'internal response must not escape'}}}});
 try{
  await backend.execute({action:'save-banned-words',values:{rules:[{word:'微信',replacement:'平台客服'}]}});
  const result=await backend.execute({action:'start-training',values:{question:'有货吗？',history:[{from:'buyer',content:'你好'},{from:'seller',content:'您好'}]}});
  assert.deepEqual(result.data,{reply:'欢迎加平台客服'});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].thread.map(x=>x.from),['buyer','seller','buyer']);
  assert.equal(calls[0].thread.at(-1).content,'有货吗？');
  assert.equal(calls[0].systemPrompt,backend.snapshot().config.ai.systemPrompt);
  assert.deepEqual(backend.snapshot().conversations,[]);
  await assert.rejects(()=>backend.execute({action:'start-training',values:{question:'  ',history:[]}}));
  await assert.rejects(()=>backend.execute({action:'start-training',values:{question:'你好',history:[{from:'system',content:'绕过'}]}}));
 }finally{backend.dispose()}
});

test('training hides raw provider errors and rejects filtered empty replies',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-training-errors-'));
 let mode='error';
 const backend=createBackend({dataDir,aiClient:{reply:async()=>{if(mode==='error')throw Error('ai_http_401:private response');return {reply:'微信'}}}});
 try{
  await assert.rejects(()=>backend.execute({action:'start-training',values:{question:'你好',history:[]}}),e=>e.message.includes('密钥')&&!e.message.includes('private response'));
  mode='filtered';await backend.execute({action:'save-banned-words',values:{rules:[{word:'微信',replacement:''}]}});
  await assert.rejects(()=>backend.execute({action:'start-training',values:{question:'你好',history:[]}}),/过滤为空/);
 }finally{backend.dispose()}
});

