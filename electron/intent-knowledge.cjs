'use strict';
const fs=require('node:fs');const {randomUUID}=require('node:crypto');const {z}=require('zod');const MiniSearch=require('minisearch');const {writeJson}=require('../desk-v1/src/main/json-store');
const text=n=>z.string().trim().min(1).max(n);
const entry=z.object({question:text(1000),keywords:z.array(text(100)).max(30),answer:text(4000),enabled:z.boolean()}).strict();
const input=z.object({name:text(100),enabled:z.boolean(),storeIds:z.array(text(64)).max(100),productIds:z.array(text(100)).max(1000),entries:z.array(entry).min(1).max(500)}).strict();
const row=input.extend({id:z.string().uuid(),version:z.number().int().positive(),updatedAt:z.number().int().nonnegative()});
const schema=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),packs:z.array(row).max(100)}).strict();
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});const tokenize=s=>[...segmenter.segment(String(s).toLowerCase())].filter(x=>x.isWordLike).map(x=>x.segment);
function createIntentKnowledge(file){
 let state={version:1,revision:0,packs:[]};if(fs.existsSync(file)){try{state=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(new Set(state.packs.map(x=>x.id)).size!==state.packs.length)throw Error('duplicate');}catch{throw Error('意图知识数据损坏，原文件未改动，请恢复备份');}}
 let index,docs;
 function reindex(){docs=state.packs.filter(x=>x.enabled).flatMap(p=>p.entries.map((e,i)=>({...e,id:p.id+':'+i,packId:p.id,packName:p.name,storeIds:p.storeIds,productIds:p.productIds})).filter(x=>x.enabled));index=new MiniSearch({fields:['question','keywords'],tokenize,extractField:(d,key)=>key==='keywords'?d.keywords.join(' '):d[key]});index.addAll(docs);}
 reindex();function commit(packs){const next=schema.parse({version:1,revision:state.revision+1,packs});writeJson(file,next);state=next;reindex();}
 function parse(json){if(typeof json!=='string'||Buffer.byteLength(json)>1048576)throw Error('导入文件最大 1 MB');return z.array(input).max(100).parse(JSON.parse(json));}
 return {
  list:()=>structuredClone(state.packs),summary:()=>({revision:state.revision,total:state.packs.length}),
  save(value){const {id,version,updatedAt,...data}=value;const parsed=input.parse(data);const old=id?state.packs.find(x=>x.id===id):null;if(id&&!old)throw Error('知识包不存在');if(old&&old.version!==version)throw Error('知识包已更新，请刷新');const next={...parsed,id:old?.id||randomUUID(),version:(old?.version||0)+1,updatedAt:Date.now()};commit(old?state.packs.map(x=>x.id===id?next:x):[...state.packs,next]);return structuredClone(next);},
  remove(id,version,confirmed){if(confirmed!==true)throw Error('请确认删除知识包');const old=state.packs.find(x=>x.id===id);if(!old)throw Error('知识包不存在');if(old.version!==version)throw Error('知识包已更新，请刷新');commit(state.packs.filter(x=>x.id!==id));},
  search(storeId,query,productId=''){const allowed=new Set(docs.filter(d=>d.storeIds.includes(storeId)&&(!d.productIds.length||(productId&&d.productIds.includes(productId)))).map(d=>d.id));return index.search(String(query).slice(0,2000),{prefix:true,combineWith:'OR'}).filter(x=>allowed.has(x.id)).slice(0,5).map(x=>{const d=docs.find(d=>d.id===x.id);return {source:'intent',packId:d.packId,packName:d.packName,question:d.question,answer:d.answer};});},
  previewImport(json){const packs=parse(json);return {revision:state.revision,count:packs.length,entries:packs.reduce((n,p)=>n+p.entries.length,0),packs};},
  importJson(json,{revision,confirmed}={}){if(confirmed!==true)throw Error('请预览并确认导入');if(revision!==state.revision)throw Error('知识包已更新，请重新预览');const packs=parse(json).map(p=>({...p,id:randomUUID(),version:1,updatedAt:Date.now()}));commit([...state.packs,...packs]);return {imported:packs.length};},
  exportJson(){return JSON.stringify(state.packs.map(({id,version,updatedAt,...data})=>data),null,2);},
 };
}
module.exports={createIntentKnowledge};
