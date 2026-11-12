const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const {writeJson}=require('../desk-v1/src/main/json-store');
const eventSchema=z.object({key:z.string().max(180),code:z.string().max(64),at:z.number().finite(),buyerMessage:z.string().max(3000),reply:z.string().max(3000),requestId:z.string().max(100),delivery:z.enum(['unknown','failed','confirmed']),resolved:z.boolean().default(false)}).strict();
const rowSchema=z.object({id:z.string().uuid(),storeId:z.string().min(1).max(64),uid:z.string().min(1).max(200),name:z.string().max(120),storeName:z.string().max(120),platform:z.string().max(40),status:z.enum(['pending','passed','problem']),note:z.string().max(2000),version:z.number().int().nonnegative(),updatedAt:z.number().finite(),reviewedAt:z.number().finite(),events:z.array(eventSchema).max(50)}).strict();
const schema=z.object({version:z.literal(1),rows:z.array(rowSchema).max(5000)}).strict();
function createConversationQuality(file){
 let state={version:1,rows:[]};
 if(fs.existsSync(file)){try{state=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')))}catch{throw Error('会话质检记录损坏，请恢复备份后重试；原文件未改动')}}
 const save=rows=>{const next=schema.parse({version:1,rows:rows.slice(-5000)});writeJson(file,next);state=next};
 const base=(store,c)=>state.rows.find(r=>r.storeId===store.id&&r.uid===c.uid)||{id:randomUUID(),storeId:store.id,uid:c.uid,name:String(c.name||c.uid).slice(0,120),storeName:String(store.storeName||'店铺').slice(0,120),platform:store.platform,status:'pending',note:'',version:0,updatedAt:0,reviewedAt:0,events:[]};
 const replace=row=>save([...state.rows.filter(r=>r.id!==row.id),row]);
 return {
  list:()=>structuredClone(state.rows),
  observe(store,c){const row=base(store,c);replace({...row,name:String(c.name||c.uid).slice(0,120),storeName:String(store.storeName||row.storeName).slice(0,120),status:'pending',version:row.version+1,updatedAt:Math.max(row.updatedAt,c.updatedAt||0)})},
  issue(store,context,code,key,at=Date.now()){
   const row=base(store,{uid:context.uid,name:context.buyerName});
   if(row.events.some(e=>e.key===key))return;
   const last=row.events.at(-1);if(last&&!last.resolved&&last.code===code&&Date.now()-last.at<1000)return;
   const event=eventSchema.parse({key,code,at,buyerMessage:String(context.buyerMessage||'').slice(0,3000),reply:String(context.reply||'').slice(0,3000),requestId:String(context.requestId||'').slice(0,100),delivery:code==='delivery_unconfirmed'?'unknown':'failed',resolved:false});
   replace({...row,status:'pending',version:row.version+1,updatedAt:Math.max(row.updatedAt,at),events:[...row.events,event].slice(-50)});
  },
  review(values){const input=z.object({id:z.string().uuid(),version:z.number().int().nonnegative(),status:z.enum(['passed','problem','pending']),note:z.string().trim().max(2000)}).strict().parse(values);const row=state.rows.find(r=>r.id===input.id);if(!row)throw Error('会话质检记录不存在');if(row.version!==input.version)throw Error('会话已有更新，请重新查看后再保存质检结果');replace({...row,status:input.status,note:input.note,reviewedAt:Date.now(),version:row.version+1})},
  resolve(storeId,uid){const row=state.rows.find(r=>r.storeId===storeId&&r.uid===uid);if(row)replace({...row,version:row.version+1,events:row.events.map(e=>({...e,resolved:true}))})},
  blocked(storeId,uid){const row=state.rows.find(r=>r.storeId===storeId&&r.uid===uid);return !!row?.events.some(e=>!e.resolved)}
 };
}
module.exports={createConversationQuality};
