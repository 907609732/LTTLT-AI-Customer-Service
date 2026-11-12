import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {createIntentKnowledge}=require('../electron/intent-knowledge.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'intent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'intents.json');return {file,s:createIntentKnowledge(file)};}
const pack={name:'物流问答',enabled:true,storeIds:['a'],productIds:[],entries:[{question:'什么时候发货',keywords:['发货','物流'],answer:'付款后48小时内发出',enabled:true}]};
test('意图只供绑定店铺使用，停用与商品限制生效',t=>{const {s,file}=fixture(t);const item=s.save(pack);assert.equal(s.search('a','什么时候发货').length,1);assert.equal(s.search('b','发货').length,0);s.save({...item,productIds:['sku1']});assert.equal(s.search('a','发货').length,0);assert.equal(s.search('a','发货','sku1').length,1);assert.equal(createIntentKnowledge(file).list()[0].name,'物流问答');const latest=s.list()[0];s.save({...latest,enabled:false});assert.equal(s.search('a','发货','sku1').length,0);assert.throws(()=>s.save(item),/更新/);});
test('坏文件保留，JSON导入先预览、整批校验、拒绝过期确认',t=>{const {s,file}=fixture(t);const json=JSON.stringify([pack]);const preview=s.previewImport(json);assert.equal(s.list().length,0);s.importJson(json,{revision:preview.revision,confirmed:true});assert.equal(s.list().length,1);assert.throws(()=>s.importJson(json,{revision:0,confirmed:true}),/更新/);assert.throws(()=>s.previewImport(JSON.stringify([pack,{...pack,name:''}])));fs.writeFileSync(file,'broken');assert.throws(()=>createIntentKnowledge(file),/损坏/);assert.equal(fs.readFileSync(file,'utf8'),'broken');});

const correctionSource={type:'quality',recordId:'11111111-1111-4111-8111-111111111111',qualityVersion:1,storeId:'a',uid:'PRIVATE-BUYER',messageTs:1,savedAt:2};
test('纠错可追加到明确目标包，保留逐条来源且重试不重复，导出不携带顾客信息',t=>{
 const {s,file}=fixture(t),target=s.save(pack),command={targetPackId:target.id,targetVersion:target.version,question:'保修多久',answer:'按已公布规则处理',source:correctionSource};
 const result=s.learnCorrection(command);assert.equal(result.id,target.id);assert.equal(result.entries.length,2);assert.equal(result.version,2);s.learnCorrection(command);assert.equal(s.list().length,1);assert.equal(s.list()[0].entries.length,2);
 assert.equal(createIntentKnowledge(file).list()[0].corrections[0].source.uid,'PRIVATE-BUYER');assert.equal(s.search('a','保修')[0].answer,command.answer);assert.equal(s.search('b','保修').length,0);assert.doesNotMatch(s.exportJson(),/PRIVATE-BUYER|corrections|recordId/);
 const saved=s.save({...s.list()[0],name:'已改名'});assert.equal(saved.corrections[0].source.uid,'PRIVATE-BUYER');
});

test('纠错目标必须启用、绑定来源店且不限制商品，过期版本不追加',t=>{
 const {s}=fixture(t);const command={question:'问保修',answer:'人工答案',source:correctionSource};
 for(const patch of [{storeIds:['b']},{enabled:false},{productIds:['sku']}]){const p=s.save({...pack,...patch});assert.throws(()=>s.learnCorrection({...command,targetPackId:p.id,targetVersion:p.version}),/知识包|店铺|商品/);assert.equal(s.list().find(x=>x.id===p.id).entries.length,1);}
 const target=s.save(pack);s.save({...target,name:'已被编辑'});assert.throws(()=>s.learnCorrection({...command,targetPackId:target.id,targetVersion:target.version}),/更新/);assert.equal(s.list().find(x=>x.id===target.id).entries.length,1);
});

test('旧版包级纠错来源可作为目标去重依据，不改写旧文件直到确认新内容',t=>{
 const {s,file}=fixture(t),old=s.save({...pack,entries:[{question:'旧纠错问题',keywords:[],answer:'旧纠错答案',enabled:true}]});const disk=JSON.parse(fs.readFileSync(file,'utf8'));disk.packs[0].source=correctionSource;delete disk.packs[0].corrections;fs.writeFileSync(file,JSON.stringify(disk));const before=fs.readFileSync(file,'utf8'),restored=createIntentKnowledge(file);
 restored.learnCorrection({targetPackId:old.id,targetVersion:old.version,question:'旧纠错问题',answer:'旧纠错答案',source:correctionSource});assert.equal(restored.list()[0].entries.length,1);assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('已删除的纠错条目不会因旧审计日志而假报保存成功，重新确认当前版本才可恢复',t=>{
 const {s}=fixture(t),target=s.save(pack),command={targetPackId:target.id,targetVersion:1,question:'保修多久',answer:'人工答案',source:correctionSource};s.learnCorrection(command);const current=s.list()[0],removed=s.save({...current,entries:current.entries.slice(0,1)});
 assert.throws(()=>s.learnCorrection(command),/更新/);s.learnCorrection({...command,targetVersion:removed.version});assert.equal(s.list()[0].entries.length,2);
});
