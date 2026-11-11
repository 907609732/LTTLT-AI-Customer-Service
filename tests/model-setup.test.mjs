import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const make=opts=>require('../electron/backend.cjs').createBackend({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'model-setup-')),safeStorage:secure,...opts});

test('provider presets identify official endpoints only',async()=>{
 const {modelProviders,detectModelProvider}=await import('../shared/model-providers.mjs');
 assert.equal(modelProviders.deepseek.model,'deepseek-flash');
 assert.equal(modelProviders.qwen.model,'qwen-plus');
 assert.equal(detectModelProvider('https://api.deepseek.com/v1/'),'deepseek');
 assert.equal(detectModelProvider('https://api.deepseek.com.attacker.test'),'custom');
 assert.equal(detectModelProvider('http://localhost:11434/v1'),'custom');
});
test('test-and-save trims key, uses selected model, and persists only after success',async()=>{
 let call;const b=make({fetchImpl:async(url,options)=>{call={url,options};return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}));}});
 try{await b.execute({action:'save-model-settings',values:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'  test-secret  ',testConnection:true}});
 assert.equal(call.url,'https://api.deepseek.com/chat/completions');assert.equal(call.options.headers.authorization,'Bearer test-secret');assert.equal(JSON.parse(call.options.body).model,'deepseek-flash');assert.deepEqual(JSON.parse(call.options.body).thinking,{type:'disabled'});
 assert.equal(b.snapshot().capabilities.apiKeyConfigured,true);assert.equal(JSON.stringify(b.snapshot()).includes('test-secret'),false);
 await assert.rejects(()=>b.execute({action:'save-model-settings',values:{baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus',testConnection:true}}),/粘贴/);
 }finally{b.dispose();}
});
test('failed connection keeps previous settings and redacts provider error',async()=>{
 const b=make({fetchImpl:async()=>new Response('sensitive-key',{status:401})});const before=b.snapshot().config.ai;
 try{await assert.rejects(()=>b.execute({action:'save-model-settings',values:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'sensitive-key',testConnection:true}}),e=>/密钥/.test(e.message)&&!e.message.includes('sensitive-key'));
 assert.deepEqual(b.snapshot().config.ai,before);assert.equal(b.snapshot().capabilities.apiKeyConfigured,false);
 }finally{b.dispose();}
});
test('only fixed official provider key pages can open',async()=>{
 const opened=[];const b=make({openExternal:async url=>opened.push(url)});
 try{await b.execute({action:'open-model-key-page',values:{provider:'deepseek'}});assert.equal(opened[0],'https://platform.deepseek.com/api_keys');await assert.rejects(()=>b.execute({action:'open-model-key-page',values:{provider:'https://attacker.test'}}));}finally{b.dispose();}
});
test('saved key can be reused only on the same endpoint and encryption must be available',async()=>{
 let calls=0;const b=make({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}));}});
 const values={baseUrl:'https://api.deepseek.com',model:'deepseek-flash',testConnection:true};
 try{await assert.rejects(()=>b.execute({action:'save-model-settings',values}),/粘贴/);assert.equal(calls,0);
 await b.execute({action:'save-model-settings',values:{...values,apiKey:'test-key'}});
 await b.execute({action:'save-model-settings',values});assert.equal(calls,2);
 }finally{b.dispose();}
 const locked=make({safeStorage:{isEncryptionAvailable:()=>false},fetchImpl:async()=>{throw Error('must not fetch');}});
 try{await assert.rejects(()=>locked.execute({action:'save-model-settings',values:{...values,apiKey:'test-key'}}),/加密存储/);assert.equal(locked.snapshot().capabilities.apiKeyConfigured,false);}finally{locked.dispose();}
});
test('concurrent windows cannot mix endpoint and key while connection is being tested',async()=>{
 let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const b=make({fetchImpl:async()=>{entered();await gate;return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}));}});
 try{const first=b.execute({action:'save-model-settings',values:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'deepseek-test-key',testConnection:true}});await started;
 await assert.rejects(()=>b.execute({action:'save-model-settings',values:{baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus',apiKey:'qwen-test-key'}}),/正在/);
 release();await first;assert.equal(b.snapshot().config.ai.baseUrl,'https://api.deepseek.com');
 }finally{release();b.dispose();}
});
