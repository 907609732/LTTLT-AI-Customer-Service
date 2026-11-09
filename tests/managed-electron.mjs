import {_electron as electron} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {electronExecutable} from '../shared/electron-runtime.mjs';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-managed-electron-'));const env={...process.env,LINGTU_DATA_DIR:data,LINGTU_INTEGRATION_TEST:'1',LINGTU_DISABLE_UPDATE_CHECK:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
async function signedIn(page){for(let i=0;i<100;i++){const s=await page.evaluate(()=>window.lingtu.managedSnapshot());if(s.session.status==='signed_in')return;await new Promise(r=>setTimeout(r,100));}throw Error('fixture_login_timeout');}
const act=(page,action)=>page.evaluate(async action=>{const s=await window.lingtu.managedSnapshot();return window.lingtu.managedAction(action,s.workspace.workspaceId);},action);
try{
 app=await electron.launch({executablePath:await electronExecutable(),cwd:process.cwd(),args:[path.resolve('tests/fixtures/managed-electron-main.cjs')],env,timeout:30000});const page=await app.firstWindow();
 await page.waitForFunction(()=>window.lingtu?.managedSnapshot);assert.equal(await app.evaluate(({app})=>app.getPath('userData')),path.join(data,'electron-userdata'));
 assert.equal((await page.evaluate(()=>window.lingtu.backendSnapshot())).workspaceMode,'locked');
 await page.locator('[data-figma-node="8836:4283"]').waitFor({timeout:30000});await page.evaluate(()=>window.lingtu.openMain('UX25'));await page.getByRole('button',{name:'登录 / 注册灵兔账号'}).waitFor({timeout:30000});
 await act(page,'local');const before=await page.evaluate(()=>window.lingtu.backendSnapshot());
 await page.evaluate(async id=>window.lingtu.backendExecute({workspaceId:id,action:'add-store',values:{platform:'pdd-web',storeName:'原有隔离店铺'}}),before.workspaceId);
 await act(page,'login');await signedIn(page);
 let managed=await page.evaluate(()=>window.lingtu.managedSnapshot());assert.equal(managed.workspace.legacyAdoption?.pending,true,JSON.stringify(managed));assert.equal((await page.evaluate(()=>window.lingtu.backendSnapshot())).stores.length,0);
 await act(page,'adopt');const owned=await page.evaluate(()=>window.lingtu.backendSnapshot());assert.equal(owned.stores[0].storeName,'原有隔离店铺');assert.equal(owned.stores[0].aiEnabled,false);
 const legacyPartition=await app.evaluate(()=>{const b=process.mainModule.require(process.cwd()+'/electron/main.cjs').getBackend();return b.manager.partitionOf(b.snapshot().stores[0]);});assert.equal(legacyPartition,'persist:desk-store-'+owned.stores[0].id);
 const legacyBinding=await page.evaluate(()=>window.lingtu.managedSnapshot());assert.equal(legacyBinding.workspace.externalClient.allowed,true);assert.equal(legacyBinding.workspace.externalClient.source,'legacy');assert.equal(fs.existsSync(path.join(data,'external-client-owner.json')),false);
 const firstId=owned.workspaceId;await page.evaluate(()=>window.lingtu.openAuxiliary('UX26'));const aux=app.windows().find(w=>w!==page)||await app.waitForEvent('window');await aux.waitForFunction(()=>window.lingtu?.backendSnapshot);
 await act(page,'logout');await aux.waitForFunction(async()=>(await window.lingtu.backendSnapshot()).stores.length===0);
 const rejected=await page.evaluate(async id=>window.lingtu.backendExecute({workspaceId:id,action:'refresh'}).then(()=>false,()=>true),firstId);assert.equal(rejected,true);
 await act(page,'local');assert.equal((await page.evaluate(()=>window.lingtu.backendSnapshot())).stores.length,0);
 await act(page,'login');await signedIn(page);managed=await page.evaluate(()=>window.lingtu.managedSnapshot());assert.equal(managed.session.account.userId,2);assert.equal((await page.evaluate(()=>window.lingtu.backendSnapshot())).stores.length,0);
 await page.evaluate(async()=>{const s=await window.lingtu.backendSnapshot();await window.lingtu.backendExecute({workspaceId:s.workspaceId,action:'add-store',values:{platform:'pdd-web',storeName:'第二账号空白店铺'}});});
 const isolatedPartition=await app.evaluate(()=>{const b=process.mainModule.require(process.cwd()+'/electron/main.cjs').getBackend();return b.manager.partitionOf(b.snapshot().stores[0]);});assert.match(isolatedPartition,/^persist:lingtu-/);assert.ok(isolatedPartition.includes(managed.workspace.id));
 await assert.rejects(page.evaluate(async()=>{const s=await window.lingtu.backendSnapshot();return window.lingtu.backendExecute({workspaceId:s.workspaceId,action:'add-store',values:{platform:'doudian-client',storeName:'不得绑定旧主人的客户端'}});}),/绑定/);assert.equal(fs.existsSync(path.join(data,'external-client-owner.json')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(data,'backend','stores.json'),'utf8')).stores.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(data,'legacy-workspace-owner.json'),'utf8')).state,'ready');
 assert.ok(!JSON.stringify(managed).includes('fixture-refresh'));assert.ok(!fs.readFileSync(path.join(data,'managed-session.bin')).includes(Buffer.from('fixture-refresh')));
 fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/managed-electron-account.png'});
 console.log('PASS: isolated userData, real IPC/main safeStorage, fixed-domain device fixture, explicit adoption/backup, owner isolation, signed-out advanced isolation, auxiliary reset and stale command rejection. No real buyers or browsers.');
}finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}}
