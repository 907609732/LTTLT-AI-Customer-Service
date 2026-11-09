import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {electronExecutable} from '../shared/electron-runtime.mjs';

const data=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-handoff-electron-'));
const packaged=process.env.LINGTU_PACKAGED_EXE;
const env={...process.env,LINGTU_DATA_DIR:data,LINGTU_INTEGRATION_TEST:'1',LINGTU_DISABLE_UPDATE_CHECK:'1'};
delete env.ELECTRON_RUN_AS_NODE;
let server,app;
async function launch(){return electron.launch({executablePath:packaged||await electronExecutable(),args:packaged?[]:['.','--dev'],env,timeout:30000})}
try{
 if(!packaged){server=await createServer();await server.listen()}
 app=await launch();let page=await app.firstWindow();
 await page.waitForFunction(()=>Boolean(window.lingtu?.backendSnapshot));
 await page.evaluate(async()=>{const state=await window.lingtu.managedSnapshot();await window.lingtu.managedAction('local',state.workspace.workspaceId)});
 const ids=await page.evaluate(async()=>{
  const workspaceId=(await window.lingtu.backendSnapshot()).workspaceId;
  await window.lingtu.backendExecute({workspaceId,action:'add-store',values:{storeName:'隔离测试甲',platform:'pdd-web'}});
  const a=(await window.lingtu.backendSnapshot()).selection.storeId;
  await window.lingtu.backendExecute({workspaceId,action:'add-store',values:{storeName:'隔离测试乙',platform:'pdd-web'}});
  const b=(await window.lingtu.backendSnapshot()).selection.storeId;
  await window.lingtu.backendExecute({workspaceId,action:'save-store-handoff',storeId:a,values:{mode:'custom',keywords:['退款','人工']}});
  await window.lingtu.backendExecute({workspaceId,action:'save-store-handoff',storeId:b,values:{mode:'custom',keywords:[]}});
  await window.lingtu.backendExecute({workspaceId,action:'save-banned-words',values:{rules:[{word:'微信',replacement:''}]}});
  return {a,b};
 });
 await app.evaluate(({app})=>app.exit(0));await app.close();
 app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.lingtu?.backendSnapshot));
 await page.evaluate(async()=>{const state=await window.lingtu.managedSnapshot();await window.lingtu.managedAction('local',state.workspace.workspaceId)});
 await page.getByRole('main',{name:'灵兔客服'}).waitFor();
 const snap=await page.evaluate(()=>window.lingtu.backendSnapshot());
 assert.deepEqual(snap.handoffByStore[ids.a].keywords,['退款','人工']);
 assert.deepEqual(snap.handoffByStore[ids.b].keywords,[]);
 await page.evaluate(async id=>window.lingtu.backendExecute({workspaceId:(await window.lingtu.backendSnapshot()).workspaceId,action:'select-store',storeId:id}),ids.a);
 await page.evaluate(()=>window.lingtu.openMain('UX08'));
 await page.getByRole('textbox',{name:'转人工关键词',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'转人工关键词',exact:true}).inputValue(),'退款，人工');
 await page.evaluate(()=>window.lingtu.openMain('UX19'));
 await page.getByRole('button',{name:'删除禁用词 微信'}).waitFor();
 await page.getByRole('textbox',{name:'禁用词',exact:true}).fill('红包');
 await page.getByRole('textbox',{name:'替换成',exact:true}).fill('优惠');
 await page.getByRole('button',{name:'添加',exact:true}).click();
 await page.getByRole('button',{name:'保存词表',exact:true}).click();
 await page.waitForFunction(async()=> (await window.lingtu.backendSnapshot()).bannedWords.some(r=>r.word==='红包'&&r.replacement==='优惠'));
 await page.evaluate(()=>window.lingtu.openMain('UX16'));
 const trainingInput=page.getByRole('textbox',{name:'模拟买家问题'});await trainingInput.waitFor();
 await trainingInput.fill('测试问题');await page.getByRole('button',{name:'发送测试'}).click();
 await page.getByRole('alert').filter({hasText:'请先配置模型接口地址'}).waitFor();
 assert.equal(await trainingInput.inputValue(),'测试问题');
 await page.evaluate(()=>window.lingtu.openMain('UX20'));
 await page.getByRole('button',{name:'登记工单'}).click();await page.getByLabel('订单号').fill('ISOLATED-001');await page.getByLabel('登记内容').fill('测试跟进');await page.getByRole('button',{name:'保存登记'}).click();
 await page.waitForFunction(async()=> (await window.lingtu.backendSnapshot()).workOrders?.some(o=>o.orderNo==='ISOLATED-001'));
 await app.evaluate(({app})=>app.exit(0));await app.close();
 app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.lingtu?.managedSnapshot));
 await page.evaluate(async()=>{const state=await window.lingtu.managedSnapshot();await window.lingtu.managedAction('local',state.workspace.workspaceId)});
 assert.equal((await page.evaluate(()=>window.lingtu.backendSnapshot())).workOrders[0].orderNo,'ISOLATED-001');
 console.log('PASS: isolated Electron IPC, store rules, banned words and work orders persist, training error preserves input');
}finally{
 if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
 await server?.close();
}
