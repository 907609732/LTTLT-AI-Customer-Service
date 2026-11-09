import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function setup(t){const root=await mkdtemp(path.join(tmpdir(),'lingtu-profiles-'));t.after(()=>rm(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'backend'));fs.writeFileSync(path.join(root,'backend','stores.json'),JSON.stringify({stores:[{id:'legacy-store'}]}));fs.writeFileSync(path.join(root,'backend','secrets.json'),'encrypted-original');return {root,manager:require('../electron/account-workspaces.cjs').createAccountWorkspaces({dataRoot:root,origin:'https://api-kefu.lttlt.top'})};}
test('explicit adoption backs up legacy, preserves original and grants only owner legacy cookies',async t=>{
 const {root,manager:m}=await setup(t);assert.equal(m.account('alice').pending,true);const p=m.adopt('alice');
 assert.equal(p.partitionNamespace,'');assert.equal(fs.readFileSync(path.join(p.dataDir,'secrets.json'),'utf8'),'encrypted-original');
 assert.equal(fs.readFileSync(path.join(root,'backend','secrets.json'),'utf8'),'encrypted-original');
 assert.ok(fs.existsSync(path.join(root,'workspace-backups',m.ownership().backup,'backend','stores.json')));
 assert.throws(()=>m.adopt('bob'),/已归属/);assert.equal(m.account('bob').pending,false);assert.notEqual(m.account('bob').partitionNamespace,'');
 assert.notEqual(m.local().dataDir,path.join(root,'backend'));
});
test('skip initializes separate empty profile and cannot later overwrite it by adoption',async t=>{
 const {manager:m}=await setup(t);const p=m.skip('alice');assert.notEqual(p.partitionNamespace,'');assert.equal(m.account('alice').pending,false);assert.throws(()=>m.adopt('alice'),/非空|初始化/);assert.equal(m.local().partitionNamespace,'');
 assert.notEqual(m.account('../alice').dataDir,p.dataDir);
});
test('refuses nonempty target and never follows symlink during backup',async t=>{
 const {root,manager:m}=await setup(t);const p=m.account('alice');fs.mkdirSync(p.dataDir,{recursive:true});fs.writeFileSync(path.join(p.dataDir,'keep'),'keep');
 assert.throws(()=>m.adopt('alice'),/非空/);assert.equal(m.ownership(),null);
 fs.mkdirSync(path.join(root,'backend','Partitions'));fs.writeFileSync(path.join(root,'backend','Partitions','cookie'),'private');
 const p2=m.adopt('bob');assert.equal(fs.existsSync(path.join(p2.dataDir,'Partitions')),false);
});
test('fresh native client binding is explicit, durable, unique and blocks signed-out local use',async t=>{
 const {root,manager:m}=await setup(t);fs.writeFileSync(path.join(root,'backend','stores.json'),'[]');
 const a=m.ensure('alice');assert.equal(a.externalClient.status,'unclaimed');assert.equal(a.externalClient.allowed,false);assert.equal(fs.existsSync(path.join(root,'external-client-owner.json')),false);assert.equal(m.local().externalClient.allowed,true);
 assert.throws(()=>m.claimExternal('alice',false),/确认/);assert.equal(fs.existsSync(path.join(root,'external-client-owner.json')),false);
 m.claimExternal('alice',true);assert.equal(m.account('alice').externalClient.allowed,true);assert.equal(m.account('bob').externalClient.allowed,false);assert.equal(m.local().externalClient.allowed,false);assert.throws(()=>m.claimExternal('bob',true),/已绑定/);
 const restored=require('../electron/account-workspaces.cjs').createAccountWorkspaces({dataRoot:root,origin:'https://api-kefu.lttlt.top'});assert.equal(restored.account('alice').externalClient.allowed,true);assert.equal(restored.claimExternal('alice',true).externalClient.allowed,true);
 const otherOrigin=require('../electron/account-workspaces.cjs').createAccountWorkspaces({dataRoot:root,origin:'https://other.example'});assert.equal(otherOrigin.account('alice').externalClient.allowed,false);
});
test('legacy owner implicitly owns native client before any new marker exists',async t=>{
 const {root,manager:m}=await setup(t);m.adopt('alice');assert.equal(fs.existsSync(path.join(root,'external-client-owner.json')),false);
 assert.equal(m.account('alice').externalClient.allowed,true);assert.equal(m.account('alice').externalClient.source,'legacy');assert.equal(m.account('bob').externalClient.status,'other');assert.throws(()=>m.claimExternal('bob',true),/已绑定/);assert.equal(m.local().externalClient.allowed,false);
});
