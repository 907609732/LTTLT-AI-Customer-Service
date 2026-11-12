import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
const {createBackend}=createRequire(import.meta.url)('../electron/backend.cjs');
test('fallback settings persist and managed mode cannot enable local fallback',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-fallback-'));let b=createBackend({dataDir});
 await b.execute({action:'save-automation-fallback',values:{enabled:true,seconds:20,text:'请稍候'}});
 assert.equal(b.snapshot().config.reply.fallbackAfterMs,20000);assert.equal(b.engine.getConfig('any').reply.fallbackText,'请稍候');
 await assert.rejects(()=>b.execute({action:'save-automation-fallback',values:{enabled:true,seconds:0,text:'请稍候'}}));
 await assert.rejects(()=>b.execute({action:'save-automation-fallback',values:{enabled:true,seconds:20,text:'  '}}));
 assert.equal(b.snapshot().config.reply.fallbackAfterMs,20000);b.dispose();b=createBackend({dataDir});assert.equal(b.snapshot().config.reply.fallbackText,'请稍候');
 await b.execute({action:'save-automation-fallback',values:{enabled:false,seconds:20,text:'请稍候'}});assert.equal(b.snapshot().config.reply.fallbackAfterMs,0);b.dispose();
 b=createBackend({dataDir,modelMode:'managed'});await assert.rejects(()=>b.execute({action:'save-automation-fallback',values:{enabled:true,seconds:20,text:'请稍候'}}),/托管/);assert.equal(b.snapshot().config.reply.fallbackAfterMs,0);b.dispose();
});

