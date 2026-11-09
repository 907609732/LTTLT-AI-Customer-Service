import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url),Module=require('node:module');
class View{constructor(){this.webContents=new EventEmitter();Object.assign(this.webContents,{loadURL:async()=>{},setWindowOpenHandler(){},isDestroyed:()=>false,close(){}})}setBackgroundColor(){}setBounds(){}}
const load=Module._load;let ShopWindowManager;
try{Module._load=function(id,...args){if(id==='electron')return {WebContentsView:View,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){}})},shell:{openExternal:async()=>{}}};return load.call(this,id,...args)};({ShopWindowManager}=require('../desk-v1/src/main/shop-window'));}finally{Module._load=load}
const {StoreRegistry}=require('../desk-v1/src/main/store-registry');
function setup(readIdentity){const registry=new StoreRegistry({file:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'pdd-window-')),'stores.json')});const s=registry.add({platform:'pdd-web',storeName:'旧店名'}),events=[];const m=new ShopWindowManager({window:{getContentSize:()=>[1100,800],contentView:{addChildView(){},removeChildView(){}}},registry,resolveEntryUrl:()=> 'https://mms.pinduoduo.com/chat-merchant/index.html',prepareStore:async()=>({ok:true}),readIdentity,onEvent:e=>events.push(e),identityPollIntervalMs:20});return {registry,s,m,events}}
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}assert.fail('condition did not become true')};
test('login page is offline, SPA login identifies and persists, logout keeps name',async()=>{
 let result={authenticated:false};const {m,s,registry}=setup(async()=>result);
 try{await m.open(s.id);assert.equal(m.stateOf(s.id).online,false);assert.equal(m.stateOf(s.id).authenticated,false);
 result={authenticated:true,storeName:'平台店铺',mallId:'321',customerServiceName:'客服01',customerServiceId:'123'};
 await until(()=>registry.get(s.id).storeName==='平台店铺');assert.equal(m.stateOf(s.id).online,true);assert.equal(registry.get(s.id).mallId,'321');
 result={authenticated:false};m.webContentsOf(s.id).emit('did-navigate-in-page',{},'https://mms.pinduoduo.com/login/',true);await until(()=>m.stateOf(s.id).authenticated===false);assert.equal(m.stateOf(s.id).online,false);assert.equal(registry.get(s.id).storeName,'平台店铺');
 }finally{m.closeAll()}
});
test('identity errors retry automatically without inventing a name',async()=>{
 let result={authenticated:true,storeName:'',mallId:'321',identityError:'店铺名称暂未获取'};const {m,s,registry}=setup(async()=>result);
 try{await m.open(s.id);assert.match(m.stateOf(s.id).identityError,/未获取/);assert.equal(registry.get(s.id).storeName,'旧店名');result={authenticated:true,storeName:'恢复的店名',mallId:'321'};await until(()=>registry.get(s.id).storeName==='恢复的店名');assert.equal(m.stateOf(s.id).identityError,'');}finally{m.closeAll()}
});
test('closing while identity request is pending cannot save late identity',async()=>{
 let release;const gate=new Promise(r=>release=r);const {m,s,registry}=setup(()=>gate);
 const opening=m.open(s.id);await until(()=>m.stateOf(s.id).open);m.close(s.id);release({authenticated:true,storeName:'迟到身份',mallId:'99'});await opening;assert.equal(registry.get(s.id).storeName,'旧店名');assert.equal(m.stateOf(s.id).open,false);
});
test('opening a failed page reloads it and recovers identity',async()=>{
 const {m,s}=setup(async()=>({authenticated:true,storeName:'已恢复',mallId:'1'}));
 try{await m.open(s.id);const wc=m.webContentsOf(s.id);let reloads=0;wc.loadURL=async()=>{reloads++};wc.emit('did-fail-load',{},-105,'NAME_NOT_RESOLVED','',true);assert.equal(m.stateOf(s.id).online,false);await m.open(s.id);assert.equal(reloads,1);assert.equal(m.stateOf(s.id).online,true);}finally{m.closeAll()}
});
test('periodic identity probes refresh stale account caches',async()=>{
 const options=[];const {m,s}=setup(async(_store,opts)=>{options.push(opts);return {authenticated:true,storeName:'真实店',mallId:'1'}});
 try{await m.open(s.id);await until(()=>options.length>1);assert.equal(options[1].refresh,true);}finally{m.closeAll()}
});
test('temporary identity failure retains known login, renderer crash rejects in-flight identity',async()=>{
 let result={authenticated:true,storeName:'真实店',mallId:'1'};const {m,s,registry}=setup(async()=>result);
 try{await m.open(s.id);result={authenticated:null,identityError:'网络波动'};await m.open(s.id);assert.equal(m.stateOf(s.id).authenticated,true);assert.equal(m.stateOf(s.id).online,true);
 let release;const gate=new Promise(r=>release=r);m.readIdentity=()=>gate;const pending=m.open(s.id);m.webContentsOf(s.id).emit('render-process-gone',{}, {reason:'crashed'});release({authenticated:true,storeName:'崩溃迟到结果',mallId:'2'});await pending;assert.equal(m.stateOf(s.id).online,false);assert.equal(registry.get(s.id).storeName,'真实店');}finally{m.closeAll()}
});
test('switching platform accounts cannot retain the previous store name',async()=>{
 let result={authenticated:true,storeName:'原账号店铺',mallId:'1',customerServiceName:'原客服',customerServiceId:'11'};const {m,s,registry}=setup(async()=>result);
 try{await m.open(s.id);result={authenticated:true,storeName:'',mallId:'2',customerServiceName:'',customerServiceId:'22'};await m.open(s.id);assert.equal(registry.get(s.id).storeName,'');assert.equal(registry.get(s.id).customerServiceName,'');assert.equal(registry.get(s.id).mallId,'2');}finally{m.closeAll()}
});
