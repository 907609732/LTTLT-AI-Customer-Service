'use strict';
const fs=require('node:fs');const {randomUUID}=require('node:crypto');const {z}=require('zod');const {writeJson}=require('../desk-v1/src/main/json-store');
const input=z.object({name:z.string().trim().min(1).max(100),prompt:z.string().trim().min(1).max(8000),maxReplyChars:z.number().int().min(1).max(2000)}).strict();
const profile=input.extend({id:z.string().uuid(),version:z.number().int().positive(),updatedAt:z.number().int().nonnegative()});
const schema=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),profiles:z.array(profile).max(100),bindings:z.record(z.string().min(1).max(64),z.string().uuid())}).strict();
function createModelProfiles(file){let state={version:1,revision:0,profiles:[],bindings:{}};if(fs.existsSync(file)){try{state=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(new Set(state.profiles.map(x=>x.id)).size!==state.profiles.length||Object.values(state.bindings).some(id=>!state.profiles.some(p=>p.id===id)))throw Error('invalid');}catch{throw Error('模型方案数据损坏，原文件未改动，请恢复备份');}}
 function commit(patch){const next=schema.parse({...state,...patch,revision:state.revision+1});writeJson(file,next);state=next;}
 return {
  snapshot:()=>structuredClone(state),
  save(value){const {id,version,updatedAt,...data}=value;const checked=input.parse(data),old=id?state.profiles.find(x=>x.id===id):null;if(id&&!old)throw Error('模型方案不存在');if(old&&old.version!==version)throw Error('模型方案已更新，请重新载入');const next={...checked,id:old?.id||randomUUID(),version:(old?.version||0)+1,updatedAt:Date.now()};commit({profiles:old?state.profiles.map(x=>x.id===id?next:x):[...state.profiles,next]});return structuredClone(next);},
  bind(storeId,profileId,revision){z.string().min(1).max(64).parse(storeId);if(revision!==state.revision)throw Error('模型方案或绑定已更新，请刷新');if(profileId&&!state.profiles.some(p=>p.id===profileId))throw Error('模型方案不存在');const bindings={...state.bindings};if(profileId)bindings[storeId]=profileId;else delete bindings[storeId];commit({bindings});},
  remove(id,version,confirmed){if(confirmed!==true)throw Error('请确认删除方案并恢复全局规则');const old=state.profiles.find(p=>p.id===id);if(!old)throw Error('模型方案不存在');if(old.version!==version)throw Error('模型方案已更新，请重新载入');commit({profiles:state.profiles.filter(p=>p.id!==id),bindings:Object.fromEntries(Object.entries(state.bindings).filter(([,value])=>value!==id))});},
  resolve(storeId,global){const p=state.profiles.find(x=>x.id===state.bindings[storeId]);return p?{...global,ai:{...global.ai,systemPrompt:p.prompt},reply:{...global.reply,maxReplyChars:p.maxReplyChars}}:global;},
 };
}
module.exports={createModelProfiles};

