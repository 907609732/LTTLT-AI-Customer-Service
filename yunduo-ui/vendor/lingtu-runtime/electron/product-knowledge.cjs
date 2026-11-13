'use strict';
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const MiniSearch=require('minisearch');
const Papa=require('papaparse');
const {writeJson}=require('../desk-v1/src/main/json-store');
const text=max=>z.string().trim().max(max);
const input=z.object({storeId:text(64).min(1),productId:text(100).min(1),title:text(200).min(1),description:text(6000).default(''),specifications:text(3000).default(''),price:text(80).default(''),enabled:z.boolean().default(true)}).strict();
const row=input.extend({id:z.string().uuid(),version:z.number().int().positive(),updatedAt:z.number().int().nonnegative()});
const schema=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),items:z.array(row).max(10000)}).strict();
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
const tokenize=value=>Array.from(segmenter.segment(String(value).toLowerCase())).filter(x=>x.isWordLike).map(x=>x.segment);
function createProductKnowledge(file){
 let state={version:1,revision:0,items:[]};
 if(fs.existsSync(file)){try{state=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')));const keys=new Set();for(const x of state.items){const key=JSON.stringify([x.storeId,x.productId]);if(keys.has(key))throw Error('duplicate');keys.add(key);}}catch{throw Error('商品知识数据损坏，原文件未改动，请恢复备份');}}
 let index;
 function reindex(){index=new MiniSearch({fields:['title','description','specifications','productId'],storeFields:['storeId'],tokenize});index.addAll(state.items.filter(x=>x.enabled));}
 reindex();
 function commit(items){const next=schema.parse({version:1,revision:state.revision+1,items});writeJson(file,next);state=next;reindex();}
 function summary(){const byStore={};for(const x of state.items)byStore[x.storeId]=(byStore[x.storeId]||0)+1;return {revision:state.revision,total:state.items.length,byStore};}
 function parseCsv(storeId,csv){
  if(typeof csv!=='string'||Buffer.byteLength(csv)>1024*1024)throw Error('CSV 最大 1 MB');
  const parsed=Papa.parse(csv,{header:true,skipEmptyLines:'greedy'});
  if(parsed.errors.length||!parsed.meta.fields?.includes('productId')||!parsed.meta.fields?.includes('title'))throw Error('CSV 需要 productId、title 列，且格式完整');
  if(parsed.data.length>1000)throw Error('每批最多导入 1000 个商品');
  const seen=new Set();return parsed.data.map(x=>{const item=input.parse({storeId,productId:x.productId,title:x.title,description:x.description||'',specifications:x.specifications||'',price:x.price||'',enabled:x.enabled!=='false'});if(seen.has(item.productId))throw Error('CSV 内商品编号重复');seen.add(item.productId);return item;});
 }
 return {
  summary,
  identifyTitle(storeId,title){const rows=state.items.filter(x=>x.storeId===storeId&&x.enabled&&x.title===title);return rows.length===1?rows[0].productId:'';},
  getByProductId(storeId,productId){return structuredClone(state.items.find(x=>x.storeId===storeId&&x.productId===productId&&x.enabled)||null);},
  list(storeId,{offset=0,limit=100}={}){const all=state.items.filter(x=>x.storeId===storeId);return {revision:state.revision,total:all.length,items:structuredClone(all.slice(z.number().int().nonnegative().parse(offset),offset+z.number().int().min(1).max(100).parse(limit)))};},
  save(value){const {id,version,updatedAt,...fields}=value;const data=input.parse(fields);const old=id?state.items.find(x=>x.id===id&&x.storeId===data.storeId):null;if(id&&!old)throw Error('商品不存在');if(old&&version!==old.version)throw Error('商品已更新，请刷新后再修改');if(state.items.some(x=>x.storeId===data.storeId&&x.productId===data.productId&&x.id!==id))throw Error('该店铺商品编号已存在');const next=row.parse({...data,id:old?.id||randomUUID(),version:(old?.version||0)+1,updatedAt:Date.now()});commit(old?state.items.map(x=>x.id===id?next:x):[...state.items,next]);return structuredClone(next);},
  remove(storeId,id,version,confirmed){if(confirmed!==true)throw Error('请确认删除商品知识');const old=state.items.find(x=>x.storeId===storeId&&x.id===id);if(!old)throw Error('商品不存在');if(old.version!==version)throw Error('商品已更新，请刷新');commit(state.items.filter(x=>x.id!==id));},
  search(storeId,query,limit=5){const hits=index.search(String(query).slice(0,1000),{prefix:true,combineWith:'OR',boost:{title:2},filter:x=>x.storeId===storeId}).slice(0,Math.max(1,Math.min(10,limit)));return hits.map(hit=>structuredClone(state.items.find(x=>x.id===hit.id)));},
  previewImport(storeId,csv){const items=parseCsv(storeId,csv);return {revision:state.revision,count:items.length,duplicates:items.filter(x=>state.items.some(y=>y.storeId===storeId&&y.productId===x.productId)).length,items:items.slice(0,20)};},
  importCsv(storeId,csv,{revision,mode,confirmed}={}){if(confirmed!==true)throw Error('请先预览并确认导入');if(revision!==state.revision)throw Error('商品已更新，请重新预览');if(!['skip','replace'].includes(mode))throw Error('请选择重复商品处理方式');const items=parseCsv(storeId,csv);const next=structuredClone(state.items);let imported=0;for(const data of items){const i=next.findIndex(x=>x.storeId===storeId&&x.productId===data.productId);if(i>=0&&mode==='skip')continue;const old=next[i];const value={...data,id:old?.id||randomUUID(),version:(old?.version||0)+1,updatedAt:Date.now()};if(i<0)next.push(value);else next[i]=value;imported++;}commit(next);return {imported,revision:state.revision};},
  exportCsv(storeId){return Papa.unparse(state.items.filter(x=>x.storeId===storeId).map(({id,version,updatedAt,...data})=>data),{escapeFormulae:true});},
 };
}
module.exports={createProductKnowledge};

