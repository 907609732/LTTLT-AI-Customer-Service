const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {z}=require('zod');
const {writeJson}=require('../desk-v1/src/main/json-store');

const types=['退款跟进','补发登记','换货登记','物流异常','修改地址','发票登记','差评处理','买家投诉','其他事项'];
const statuses=['pending','working','waiting','done'];
const inputSchema=z.object({storeId:z.string().min(1).max(64),type:z.enum(types),orderNo:z.string().trim().min(1).max(100),buyer:z.string().trim().max(100),priority:z.enum(['normal','urgent']),description:z.string().trim().min(1).max(2000)}).strict();
const noteSchema=z.object({id:z.string().uuid(),text:z.string().min(1).max(2000),at:z.number().int().nonnegative()}).strict();
const orderSchema=inputSchema.extend({id:z.string().uuid(),storeName:z.string().min(1).max(60),status:z.enum(statuses),createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),notes:z.array(noteSchema).max(300)}).strict();
const fileSchema=z.object({version:z.literal(1),orders:z.array(orderSchema).max(5000)}).strict();

function createWorkOrders(file){
 let state={version:1,orders:[]};
 if(fs.existsSync(file)){try{state=fileSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')))}catch{throw Error('工单数据损坏，请恢复备份后重试；原文件未改动')}}
 function commit(orders){const next=fileSchema.parse({version:1,orders});writeJson(file,next);state=next;}
 function find(id){const item=state.orders.find(x=>x.id===id);if(!item)throw Error('工单不存在');return item;}
 return {
  list:()=>structuredClone(state.orders),
  create(values,store){const input=inputSchema.parse(values);if(input.storeId!==store.id)throw Error('请先选择有效店铺');const now=Date.now();const item=orderSchema.parse({...input,id:randomUUID(),storeName:store.storeName,status:'pending',createdAt:now,updatedAt:now,notes:[]});commit([...state.orders,item]);return structuredClone(item)},
  status(id,status){const old=find(id),next=orderSchema.parse({...old,status:z.enum(statuses).parse(status),updatedAt:Date.now()});commit(state.orders.map(x=>x.id===id?next:x))},
  note(id,text){const old=find(id),note=noteSchema.parse({id:randomUUID(),text:z.string().trim().min(1).max(2000).parse(text),at:Date.now()}),next=orderSchema.parse({...old,notes:[...old.notes,note],updatedAt:Date.now()});commit(state.orders.map(x=>x.id===id?next:x))},
 };
}
module.exports={createWorkOrders};
