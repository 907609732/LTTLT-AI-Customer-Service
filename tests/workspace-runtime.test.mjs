import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
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
