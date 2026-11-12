import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {electronExecutable} from '../shared/electron-runtime.mjs';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-pdd-electron-'));
const env={...process.env,LINGTU_DATA_DIR:data,LINGTU_INTEGRATION_TEST:'1',LINGTU_DISABLE_UPDATE_CHECK:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 const packaged=process.env.LINGTU_PACKAGED_EXE;
 app=await electron.launch({executablePath:packaged||await electronExecutable(),args:packaged?[]:['.'],env,timeout:30000});
 const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.lingtu?.managedSnapshot));
 await page.evaluate(async()=>{const state=await window.lingtu.managedSnapshot();await window.lingtu.managedAction('local',state.workspace.workspaceId)});
 await page.getByText('尚未添加店铺',{exact:true}).waitFor();
 // Intercept only this test store's HTTPS session, preserving real renderer/IPC/adapter code.
 await app.evaluate(({app,session})=>{
  const backend=process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend();
  globalThis.pddFixture={loggedIn:false,fail:false};
  backend.manager.resolveEntryUrl=store=>{
   session.fromPartition(backend.manager.partitionOf(store)).protocol.handle('https',request=>{
    const u=new URL(request.url),fixture=globalThis.pddFixture;
    if(u.origin!=='https://mms.pinduoduo.com')return new Response('',{status:403});
    if(u.pathname==='/chats/userinfo/realtime')return new Response(JSON.stringify(fixture.fail?{success:false}:{mall:{mall_name:'受控旗舰店',mall_id:'10086'},username:'受控客服01',id:'9001'}),{headers:{'content-type':'application/json'}});
    const html=!fixture.loggedIn?'<h1>拼多多扫码登录 受控测试</h1>':'<h1>拼多多客服工作区 受控测试</h1>';
    return new Response('<!doctype html><meta charset="utf-8">'+html,{headers:{'content-type':'text/html; charset=utf-8'}});
   });
   return 'https://mms.pinduoduo.com/login.html';
  };
 });
 await page.getByRole('button',{name:'添加店铺',exact:true}).click();await page.getByRole('button',{name:'多多店铺 · 网页',exact:true}).click();await page.getByRole('button',{name:'确认添加',exact:true}).click();
 await page.waitForFunction(async()=>{const s=(await window.lingtu.backendSnapshot()).stores[0];return s?.runtime.open&&s.runtime.authenticated===false});
 assert.equal(await page.getByLabel('店铺名称',{exact:true}).count(),0);
 await page.getByRole('region',{name:'真实店铺列表'}).getByRole('button',{name:/拼多多店铺 · 待登录/}).waitFor();
 let snap=await page.evaluate(()=>window.lingtu.backendSnapshot());assert.equal(snap.stores.length,1);assert.equal(snap.stores[0].storeName,'');assert.equal(snap.stores[0].runtime.online,false);const id=snap.stores[0].id;
 const embedded=await app.evaluate(({app,BrowserWindow},id)=>{const main=BrowserWindow.getAllWindows()[0],wc=process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend().manager.webContentsOf(id);return {windows:BrowserWindow.getAllWindows().length,attached:main.contentView.children.some(view=>view.webContents?.id===wc.id)}},id);assert.equal(embedded.windows,1);assert.equal(embedded.attached,true);
 const loginText=await app.evaluate(async({app},id)=>process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend().manager.webContentsOf(id).executeJavaScript('document.body.innerText'),id);assert.match(loginText,/扫码登录/);
 await app.evaluate(async({app},id)=>{globalThis.pddFixture.loggedIn=true;const b=process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend();await b.manager.webContentsOf(id).loadURL('https://mms.pinduoduo.com/chat-merchant/index.html');},id);
 await page.waitForFunction(async()=>{const s=(await window.lingtu.backendSnapshot()).stores[0];return s?.storeName==='受控旗舰店'&&s.runtime.online},{},{timeout:15000});
 await page.getByRole('region',{name:'真实店铺列表'}).getByRole('button',{name:/受控旗舰店.*受控客服01/}).waitFor();
 snap=await page.evaluate(()=>window.lingtu.backendSnapshot());assert.equal(snap.stores[0].mallId,'10086');assert.equal(snap.stores[0].customerServiceName,'受控客服01');assert.equal(snap.stores[0].aiEnabled,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(data,'backend','stores.json'),'utf8')).stores[0].storeName,'受控旗舰店');
 await app.evaluate(async({app},id)=>{globalThis.pddFixture.fail=true;await process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend().manager.open(id)},id);
 snap=await page.evaluate(()=>window.lingtu.backendSnapshot());assert.equal(snap.stores[0].runtime.authenticated,true);assert.ok(snap.stores[0].runtime.identityError);
 await app.evaluate(async({app},id)=>{globalThis.pddFixture.fail=false;const b=process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend();await b.manager.open(id);await b.manager.webContentsOf(id).loadURL('https://mms.pinduoduo.com/login.html')},id);
 await page.waitForFunction(async()=>{const s=(await window.lingtu.backendSnapshot()).stores[0];return s?.runtime.authenticated===false});
 snap=await page.evaluate(()=>window.lingtu.backendSnapshot());assert.equal(snap.stores[0].storeName,'受控旗舰店');assert.equal(snap.stores[0].runtime.online,false);
 fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/pdd-login-electron.png'});
 console.log('PASS: real Electron confirm -> isolated login view -> account GET -> name/customer identity -> UI + disk; retry and logout; AI remains off. Controlled platform responses, no real buyer sends.');
}finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}}
