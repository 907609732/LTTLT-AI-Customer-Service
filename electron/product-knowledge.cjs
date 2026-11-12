'use strict';
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const MiniSearch=require('minisearch');
const Papa=require('papaparse');
const {writeJson}=require('../desk-v1/src/main/json-store');
const text=max=>z.string().trim().max(max);
const sku=z.object({skuId:text(100).min(1),attributes:text(500).default(''),price:text(80).default(''),stock:z.number().int().min(0).max(999999999).optional()}).strict();
const skuList=z.array(sku).max(200).superRefine((items,ctx)=>{if(new Set(items.map(x=>x.skuId)).size!==items.length)ctx.addIssue({code:'custom',message:'SKU编号不能重复'});});
const input=z.object({storeId:text(64).min(1),productId:text(100).min(1),code:text(100).default(''),title:text(200).min(1),description:text(6000).default(''),specifications:text(3000).default(''),price:text(80).default(''),skus:skuList.default([]),enabled:z.boolean().default(true)}).strict();
const sourceSchema=z.object({kind:z.enum(['manual','csv','json','conversation']),capturedAt:z.number().int().nonnegative(),uid:text(200).optional(),messageId:text(200).optional(),observedAt:z.number().finite().optional()}).strict();
const row=input.extend({id:z.string().uuid(),version:z.number().int().positive(),updatedAt:z.number().int().nonnegative(),source:sourceSchema.default({kind:'manual',capturedAt:0})});
const schema=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),items:z.array(row).max(10000)}).strict();
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
const tokenize=value=>Array.from(segmenter.segment(String(value).toLowerCase())).filter(x=>x.isWordLike).map(x=>x.segment);
function createProductKnowledge(file){
 let state={version:1,revision:0,items:[]};
 if(fs.existsSync(file)){try{state=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')));const keys=new Set();for(const x of state.items){const key=JSON.stringify([x.storeId,x.productId]);if(keys.has(key))throw Error('duplicate');keys.add(key);}}catch{throw Error('商品知识数据损坏，原文件未改动，请恢复备份');}}
 let index;
 function reindex(){index=new MiniSearch({fields:['title','description','specifications','productId','code','skus'],storeFields:['storeId','enabled'],tokenize,extractField:(d,key)=>key==='skus'?d.skus.map(s=>s.skuId+' '+s.attributes).join(' '):d[key]});index.addAll(state.items);}
 reindex();
 function commit(items){const next=schema.parse({version:1,revision:state.revision+1,items});writeJson(file,next);state=next;reindex();}
 function summary(){const byStore={};for(const x of state.items)byStore[x.storeId]=(byStore[x.storeId]||0)+1;return {revision:state.revision,total:state.items.length,byStore};}
 function parseImport(storeId,raw,format){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>1024*1024)throw Error('导入文件最大 1 MB');
  let records;
  if(format==='json')records=z.array(input.omit({storeId:true})).max(1000).parse(JSON.parse(raw));
  else if(format==='csv'){
   const parsed=Papa.parse(raw,{header:true,skipEmptyLines:'greedy'});
   if(parsed.errors.length||!parsed.meta.fields?.includes('productId')||!parsed.meta.fields?.includes('title'))throw Error('CSV 需要 productId、title 列，且格式完整');
   records=parsed.data.map(x=>{if(x.enabled!==undefined&&!['','true','false'].includes(x.enabled.trim()))throw Error('CSV enabled启用值只允许 true 或 false');return {productId:x.productId,title:x.title,code:x.code||'',description:x.description||'',specifications:x.specifications||'',price:x.price||'',skus:x.skus?JSON.parse(x.skus):[],enabled:x.enabled?.trim()!=='false'};});
  }else throw Error('不支持的导入格式');
  if(records.length>1000)throw Error('每批最多导入 1000 个商品');
  const seen=new Set();return records.map(x=>{const item=input.parse({...x,storeId});if(seen.has(item.productId))throw Error('导入文件内商品编号重复');seen.add(item.productId);return item;});
 }
 function applyImport(storeId,raw,{revision,mode,confirmed}={},format){
  if(confirmed!==true)throw Error('请先预览并确认导入');if(revision!==state.revision)throw Error('商品已更新，请重新预览');if(!['skip','replace'].includes(mode))throw Error('请选择重复商品处理方式');
  const items=parseImport(storeId,raw,format),next=structuredClone(state.items);let imported=0;const now=Date.now();
  for(const data of items){const i=next.findIndex(x=>x.storeId===storeId&&x.productId===data.productId);if(i>=0&&mode==='skip')continue;const old=next[i];const value={...data,id:old?.id||randomUUID(),version:(old?.version||0)+1,updatedAt:now,source:{kind:format,capturedAt:now}};if(i<0)next.push(value);else next[i]=value;imported++;}
  commit(next);return {imported,revision:state.revision};
 }
 function portable(storeId){return state.items.filter(x=>x.storeId===storeId).map(({id,version,updatedAt,source,storeId:ignored,...data})=>data);}
 return {
  summary,
  identifyTitle(storeId,title){const rows=state.items.filter(x=>x.storeId===storeId&&x.enabled&&x.title===title);return rows.length===1?rows[0].productId:'';},
  getByProductId(storeId,productId){return structuredClone(state.items.find(x=>x.storeId===storeId&&x.productId===productId&&x.enabled)||null);},
  getRecord(storeId,productId){return structuredClone(state.items.find(x=>x.storeId===storeId&&x.productId===productId)||null);},
  list(storeId,{offset=0,limit=100,query=''}={}){const q=text(200).parse(query);const all=q?index.search(q,{prefix:true,combineWith:'OR',filter:x=>x.storeId===storeId}).map(hit=>state.items.find(x=>x.id===hit.id)):state.items.filter(x=>x.storeId===storeId);return {revision:state.revision,total:all.length,items:structuredClone(all.slice(z.number().int().nonnegative().parse(offset),offset+z.number().int().min(1).max(100).parse(limit)))};},
  save(value,{source:provenance}={}){const {id,version,updatedAt,source,...fields}=value;const data=input.parse(fields);const old=id?state.items.find(x=>x.id===id&&x.storeId===data.storeId):null;if(id&&!old)throw Error('商品不存在');if(old&&version!==old.version)throw Error('商品已更新，请刷新后再修改');if(state.items.some(x=>x.storeId===data.storeId&&x.productId===data.productId&&x.id!==id))throw Error('该店铺商品编号已存在');const now=Date.now(),next=row.parse({...data,id:old?.id||randomUUID(),version:(old?.version||0)+1,updatedAt:now,source:provenance||old?.source||{kind:'manual',capturedAt:now}});commit(old?state.items.map(x=>x.id===id?next:x):[...state.items,next]);return structuredClone(next);},
  remove(storeId,id,version,confirmed){if(confirmed!==true)throw Error('请确认删除商品知识');const old=state.items.find(x=>x.storeId===storeId&&x.id===id);if(!old)throw Error('商品不存在');if(old.version!==version)throw Error('商品已更新，请刷新');commit(state.items.filter(x=>x.id!==id));},
  search(storeId,query,limit=5){const hits=index.search(String(query).slice(0,1000),{prefix:true,combineWith:'OR',boost:{title:2},filter:x=>x.storeId===storeId&&x.enabled}).slice(0,Math.max(1,Math.min(10,limit)));return hits.map(hit=>structuredClone(state.items.find(x=>x.id===hit.id)));},
  references(storeId,query,productId){
   const selected=state.items.find(x=>x.storeId===storeId&&x.productId===productId&&x.enabled),hits=this.search(storeId,query,3);
   const rows=[...(selected?[selected]:[]),...hits.filter(x=>x.id!==selected?.id)].slice(0,3),terms=tokenize(query);
   return rows.map(x=>{const rank=s=>(new RegExp('(^|[^a-z0-9_-])'+s.skuId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9_-])','i').test(String(query))?1000:0)+terms.filter(t=>s.attributes.toLowerCase().includes(t)).length;const skus=[...x.skus].sort((a,b)=>rank(b)-rank(a)).slice(0,8).map(s=>({...s,attributes:s.attributes.slice(0,160)}));return {source:'product',productId:x.productId,code:x.code,title:x.title,description:x.description.slice(0,1200),specifications:x.specifications.slice(0,800),price:x.price,skus,skuCount:x.skus.length,skusIncluded:skus.length,stockBasis:'人工维护的参考库存，非实时库存；未列出的SKU不能推断为无货'};});
  },
  previewImport(storeId,raw,format='csv'){const items=parseImport(storeId,raw,format);return {revision:state.revision,count:items.length,duplicates:items.filter(x=>state.items.some(y=>y.storeId===storeId&&y.productId===x.productId)).length,items:items.slice(0,20)};},
  importCsv:(storeId,raw,options)=>applyImport(storeId,raw,options,'csv'),
  importJson:(storeId,raw,options)=>applyImport(storeId,raw,options,'json'),
  exportCsv(storeId){return Papa.unparse(portable(storeId).map(data=>({...data,skus:JSON.stringify(data.skus)})),{escapeFormulae:true});},
  exportJson:storeId=>JSON.stringify(portable(storeId),null,2),
 };
}
module.exports={createProductKnowledge};
