import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
test('switch invalidates commands and late results before creating next backend',async()=>{
 const {createWorkspaceRuntime}=require('../electron/workspace-runtime.cjs');let finish,disposed=0;const events=[];
 const runtime=createWorkspaceRuntime({workspaces:{local:()=>({id:'legacy',dataDir:'legacy',partitionNamespace:''}),ensure:id=>({id,dataDir:id,partitionNamespace:id,pending:false})},createHost:()=>({start:async()=>{},close:async()=>{events.push('host closed');}}),createBackend:opts=>({snapshot:()=>({stores:[opts.dataDir]}),execute:()=>new Promise(r=>{finish=r;}),dispose(){disposed++;events.push('disposed');},stopAi(){}}),onReset:()=>events.push('reset')});
 await runtime.local();const old=runtime.snapshot();const pending=runtime.execute({workspaceId:old.workspaceId,action:'refresh'});
 await runtime.acceptSession({status:'signed_in',account:{userId:'b'}});finish({status:'ok'});await assert.rejects(pending,/工作区/);
 await assert.rejects(runtime.execute({workspaceId:old.workspaceId,action:'refresh'}),/工作区/);assert.equal(disposed,1);assert.deepEqual(runtime.snapshot().stores,['b']);assert.ok(events.indexOf('disposed')<events.indexOf('host closed'));
 await runtime.dispose();
});
test('signed out/default mode is locked and offline cannot authorize new hosted AI',async()=>{
 const {createWorkspaceRuntime}=require('../electron/workspace-runtime.cjs');let stopped=0;
 const r=createWorkspaceRuntime({workspaces:{ensure:id=>({id,dataDir:id,partitionNamespace:id,pending:false})},createHost:()=>({start:async()=>{},close:async()=>{}}),createBackend:()=>({snapshot:()=>({}),dispose(){},stopAi(){stopped++;}})});
 await assert.rejects(r.execute({action:'add-store'}));await r.acceptSession({status:'signed_in',account:{userId:'a'}});await r.acceptSession({status:'offline',account:{userId:'a'}});assert.equal(stopped,1);assert.throws(()=>r.assertManagedReady(),/连接/);await r.dispose();
});
test('configuration data remains isolated when switching managed accounts',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lingtu-config-workspaces-'));
 const {createWorkspaceRuntime}=require('../electron/workspace-runtime.cjs');const {createBackend}=require('../electron/backend.cjs');
 const runtime=createWorkspaceRuntime({workspaces:{ensure:id=>({id,dataDir:path.join(dir,id),partitionNamespace:id,pending:false})},createHost:()=>({start:async()=>{},close:async()=>{}}),createBackend});
 try{
  await runtime.acceptSession({status:'signed_in',account:{userId:'account-a'}});let a=runtime.snapshot();
  await runtime.execute({workspaceId:a.workspaceId,action:'add-store',values:{storeName:'甲店',platform:'pdd-web'}});a=runtime.snapshot();const store=a.selection.storeId;
  await runtime.execute({workspaceId:a.workspaceId,action:'save-store-handoff',storeId:store,values:{mode:'custom',keywords:['甲规则']}});
  await runtime.execute({workspaceId:a.workspaceId,action:'save-banned-words',values:{rules:[{word:'甲禁用',replacement:''}]}});
  await runtime.execute({workspaceId:a.workspaceId,action:'create-work-order',values:{storeId:store,type:'其他事项',orderNo:'隔离单号',buyer:'',priority:'normal',description:'跟进测试'}});
  await runtime.acceptSession({status:'signed_in',account:{userId:'account-b'}});let b=runtime.snapshot();assert.deepEqual(b.bannedWords,[]);assert.deepEqual(b.stores,[]);assert.deepEqual(b.workOrders,[]);
  await assert.rejects(runtime.execute({workspaceId:a.workspaceId,action:'save-banned-words',values:{rules:[]}}),/工作区/);
  await runtime.execute({workspaceId:b.workspaceId,action:'save-banned-words',values:{rules:[{word:'乙禁用',replacement:''}]}});
  await runtime.acceptSession({status:'signed_in',account:{userId:'account-a'}});a=runtime.snapshot();assert.deepEqual(a.bannedWords,[{word:'甲禁用',replacement:''}]);assert.deepEqual(a.handoffByStore[store].keywords,['甲规则']);assert.equal(a.workOrders[0].orderNo,'隔离单号');
 }finally{await runtime.dispose()}
});
