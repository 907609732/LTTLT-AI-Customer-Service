'use strict';
const fs=require('node:fs');const {z}=require('zod');const {writeJson}=require('../desk-v1/src/main/json-store');
const settings=z.object({text:z.string().trim().max(200),enabled:z.boolean(),version:z.number().int().nonnegative(),enabledAt:z.number().finite()}).strict();
const seen=z.object({storeId:z.string().min(1).max(64),uid:z.string().min(1).max(200),firstTs:z.number().finite(),eligible:z.boolean(),attempted:z.boolean()}).strict();
const schema=z.object({version:z.literal(2),stores:z.record(z.string(),settings),seen:z.array(seen).max(50000)}).strict();
const legacy=z.object({version:z.literal(1),stores:z.record(z.string(),z.object({text:z.string().max(200)}).strict())}).strict();
const key=x=>JSON.stringify([x.storeId,x.uid]);
function createWelcome(file,{now=Date.now}={}){
 let state={version:2,stores:{},seen:[]};if(fs.existsSync(file)){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.version===1){const old=legacy.parse(value);state={version:2,stores:Object.fromEntries(Object.entries(old.stores).map(([id,s])=>[id,{...s,enabled:false,version:0,enabledAt:0}])),seen:[]};}else state=schema.parse(value);if(new Set(state.seen.map(key)).size!==state.seen.length)throw Error('duplicate');}catch{throw Error('店铺欢迎配置损坏，原文件未改动，请恢复备份');}}
 let known=new Map(state.seen.map(x=>[key(x),x]));
 const defaultSetting=()=>({text:'',enabled:false,version:0,enabledAt:0});
 function get(id){return Object.hasOwn(state.stores,id)?state.stores[id]:defaultSetting();}
 function commit(patch){const next=schema.parse({...state,...patch});writeJson(file,next);state=next;known=new Map(state.seen.map(x=>[key(x),x]));}
 return {
  snapshot:()=>structuredClone(state.stores),
  noteOutbound({storeId,uid}){const item=known.get(key({storeId,uid}));if(item?.eligible&&!item.attempted)commit({seen:state.seen.map(x=>key(x)===key(item)?{...x,attempted:true}:x)});},
  save(storeId,value){z.string().min(1).max(64).parse(storeId);const input=z.object({text:z.string().trim().max(200),enabled:z.boolean().default(false),version:z.number().int().nonnegative().default(0)}).strict().parse(value),old=get(storeId);if(input.version!==old.version)throw Error('欢迎配置已更新，请重新载入');if(input.enabled&&!input.text)throw Error('请先填写欢迎语');const next={...input,version:old.version+1,enabledAt:input.enabled&&!old.enabled?now():old.enabledAt};commit({stores:{...state.stores,[storeId]:next}});return structuredClone(next);},
  seed(conversations){const added=[];for(const c of conversations){if(known.has(key(c))||added.some(x=>key(x)===key(c))||state.seen.length+added.length>=50000)continue;added.push(seen.parse({storeId:c.storeId,uid:c.uid,firstTs:0,eligible:false,attempted:false}));}if(added.length)commit({seen:[...state.seen,...added]});},
  observe({storeId,uid,ts,existing=false}){const k=key({storeId,uid});if(known.has(k)||state.seen.length>=50000)return;const setting=get(storeId),at=now(),fresh=Number.isFinite(ts)&&ts>=setting.enabledAt&&at-ts<=30000&&ts<=at+5000;const item=seen.parse({storeId,uid,firstTs:Number.isFinite(ts)?ts:0,eligible:!existing&&setting.enabled&&fresh,attempted:false});commit({seen:[...state.seen,item]});},
  claim({storeId,uid,thread}){const setting=get(storeId),item=known.get(key({storeId,uid}));if(!setting.enabled||!setting.text||!item?.eligible||item.attempted||now()-item.firstTs>30000)return '';const messages=(thread||[]).filter(m=>m.from==='buyer'||m.from==='seller');if(!messages.length||messages.some(m=>m.from==='seller'||!Number.isFinite(Number(m.ts))||Number(m.ts)<item.firstTs))return '';commit({seen:state.seen.map(x=>key(x)===key(item)?{...x,attempted:true}:x)});return setting.text;},
 };
}
module.exports={createWelcome};
