import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {electronExecutable} from '../shared/electron-runtime.mjs';

const data=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-embedded-platform-'));
const server=createServer((_request,response)=>{
 response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
 response.end('<h1>受控店铺测试页</h1><p>仅用于验证内嵌和通知权限。</p>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const env={...process.env,LINGTU_DATA_DIR:data,LINGTU_INTEGRATION_TEST:'1'};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:await electronExecutable(),args:['.'],env,timeout:30000});
 const page=await app.firstWindow();
 await page.waitForFunction(()=>window.lingtu?.backendSnapshot);
 const result=await app.evaluate(async({BrowserWindow,app},fixtureUrl)=>{
  const req=process.mainModule.require.bind(process.mainModule);
  const {StoreRegistry}=req(app.getAppPath()+'/desk-v1/src/main/store-registry');
  const {createPlatformHost}=req(app.getAppPath()+'/electron/platform-host.cjs');
  const adapters=req(app.getAppPath()+'/desk-v1/src/adapters');
  const path=req('node:path');
  const main=BrowserWindow.getAllWindows()[0],before=BrowserWindow.getAllWindows().length;
  const registry=new StoreRegistry({file:path.join(app.getPath('userData'),'fixture-stores.json')});
  const first=registry.add({platform:'pdd-web',storeName:'测试店铺一'});
  const second=registry.add({platform:'pdd-web',storeName:'测试店铺二'});
  const logger={child(){return this;},info(){},warn(){},error(){}};
  const host=createPlatformHost({dataDir:app.getPath('userData'),partitionNamespace:'fixture',allowExternalClient:false,getWindow:()=>main});
  const oldEntry=adapters.entryUrlFor;
  let manager;
  try{
   adapters.entryUrlFor=()=>fixtureUrl;
   manager=host.managerFactory({logger,config:{all:()=>({})},registry,adapterFor:()=>({ensure:async()=>({ok:true}),readIdentity:async()=>({authenticated:false})}),onEvent(){}});
  }finally{adapters.entryUrlFor=oldEntry;}
  globalThis.embeddedFixture={host,manager,main,first,second};
  host.setPresentation({visible:true,storeId:first.id});
  await manager.open(first.id);
  await manager.open(second.id);
  const a=manager.views.get(first.id).view,b=manager.views.get(second.id).view;
  const [width,height]=main.getContentSize();
  const initial={windows:BrowserWindow.getAllWindows().length,before,attached:main.contentView.children.includes(a),firstVisible:a.getVisible(),secondVisible:b.getVisible(),bounds:a.getBounds(),expected:{x:300,y:72,width:width-300,height:height-72}};
  const permission=await a.webContents.executeJavaScript('Notification.permission');
  const request=await a.webContents.executeJavaScript('Notification.requestPermission()');
  host.setPresentation({visible:true,storeId:second.id});
  const switched={first:a.getVisible(),second:b.getVisible()};
  host.setPresentation({visible:false,storeId:second.id});
  const hidden={first:a.getVisible(),second:b.getVisible()};
  host.setPresentation({visible:true,storeId:first.id});
  await a.webContents.loadURL('http://localhost:'+new URL(fixtureUrl).port);
  const foreignPermission=await a.webContents.executeJavaScript('Notification.permission');
  const aContents=a.webContents,bContents=b.webContents;
  await host.close();
  await new Promise(resolve=>setImmediate(resolve));
  const cleaned=!main.contentView.children.includes(a)&&!main.contentView.children.includes(b)&&aContents.isDestroyed()&&bContents.isDestroyed();
  return {cleaned,initial,permission,request,switched,hidden,foreignPermission,mainAlive:!main.isDestroyed(),remaining:manager.list().length};
 },url);
 assert.equal(result.initial.windows,result.initial.before);
 assert.equal(result.initial.attached,true);
 assert.equal(result.initial.firstVisible,true);
 assert.equal(result.initial.secondVisible,false);
 assert.deepEqual(result.initial.bounds,result.initial.expected);
 assert.equal(result.permission,'granted');
 assert.equal(result.request,'granted');
 assert.deepEqual(result.switched,{first:false,second:true});
 assert.deepEqual(result.hidden,{first:false,second:false});
 assert.notEqual(result.foreignPermission,'granted');
 assert.equal(result.mainAlive,true);
 assert.equal(result.cleaned,true);
 assert.equal(result.remaining,0);
 const storeId=await app.evaluate(async({app},fixtureUrl)=>{
  const api=process.mainModule.require(app.getAppPath()+'/electron/main.cjs');
  await api.getRuntime().acceptSession({status:'signed_in',account:{userId:'overlay-test',trial:{limit:100,remaining:100,expiresAt:4102444800}}});
  const backend=api.getBackend();
  backend.manager.resolveEntryUrl=()=>fixtureUrl;
  backend.manager.readIdentity=async()=>({authenticated:false});
  backend.manager.prepareStore=async()=>({ok:true});
  const added=await backend.execute({action:'add-store',values:{platform:'pdd-web',storeName:'悬浮测试店铺'}});
  await backend.manager.open(added.data.id);
  globalThis.overlayStoreId=added.data.id;
  return added.data.id;
 },url);
 await page.getByText('悬浮测试店铺',{exact:true}).waitFor();
 await app.evaluate(({app},id)=>{
  const backend=process.mainModule.require(app.getAppPath()+'/electron/main.cjs').getBackend();
  backend.engine.aiClient.onDeliveryFailure({reason:'send_unconfirmed',storeId:id,uid:'fixture-buyer',buyerName:'核对买家',buyerMessage:'测试问题',reply:'测试待核对回复'});
 },storeId);
 let floating;
 for(let attempt=0;attempt<50;attempt++){
  floating=await app.evaluate(async({app,BrowserWindow},id)=>{
   const api=process.mainModule.require(app.getAppPath()+'/electron/main.cjs');
   const issue=api.getIssueView(),store=api.getBackend().manager.views.get(id).view;
   const main=BrowserWindow.getAllWindows()[0],children=main.contentView.children;
   return {top:store.getBounds().y,visible:issue.getVisible(),above:children.indexOf(issue)>children.indexOf(store),text:await issue.webContents.executeJavaScript('document.body.innerText')};
  },storeId);
  if(floating.visible&&floating.text.includes('测试待核对回复'))break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(floating.top,72);
 assert.equal(floating.visible,true);
 assert.equal(floating.above,true);
 assert.match(floating.text,/核对买家/);
 assert.match(floating.text,/测试待核对回复/);
 console.log('PASS: embedded view, selected store switching, overlay hiding, scoped notification checks and requests, host cleanup, and real native overlay above shop without changing its top bound');
}finally{
 if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 await new Promise(resolve=>server.close(resolve));
}
