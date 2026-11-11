const fs=require('node:fs');
const {z}=require('zod');
const {writeJson}=require('../desk-v1/src/main/json-store');
const identity=z.object({storeId:z.string().min(1).max(64),uid:z.string().min(1).max(200)}).strict();
const screen=z.enum(['UX26','UX27','UX28','UX29','UX30','UX31']);
const schema=z.object({version:z.literal(1),screen,selected:identity.nullable(),drafts:z.array(identity.extend({text:z.string().max(2000)})).max(200),hidden:z.array(identity.extend({updatedAt:z.number().finite()})).max(200),scroll:z.record(z.string().max(40),z.number().min(0).max(1000000)),workOrderId:z.string().max(64),workOrderSelection:z.number().int().nonnegative().default(0),filterStore:z.string().max(64).default('')}).strict();
function createAuxiliaryState(file){
 let state={version:1,screen:'UX26',selected:null,drafts:[],hidden:[],scroll:{},workOrderId:'',workOrderSelection:0,filterStore:''};
 if(fs.existsSync(file)){try{state=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')))}catch{throw Error('辅助中心状态文件损坏，请恢复备份后重试；原文件未改动')}}
 const commit=next=>{const valid=schema.parse(next);writeJson(file,valid);state=valid};
 const same=(a,b)=>a.storeId===b.storeId&&a.uid===b.uid;
 return {snapshot:()=>structuredClone(state),
  update(values){const patch=z.object({screen:screen.optional(),selected:identity.nullable().optional(),scroll:z.record(z.string().max(40),z.number().min(0).max(1000000)).optional(),workOrderId:z.string().uuid().optional(),filterStore:z.string().max(64).optional()}).strict().parse(values);commit({...state,...patch,workOrderSelection:patch.workOrderId?state.workOrderSelection+1:state.workOrderSelection,scroll:{...state.scroll,...patch.scroll}})},
  draft(target,text){text=z.string().max(2000).parse(text);const drafts=state.drafts.filter(d=>!same(d,target));if(text)drafts.push({...target,text});commit({...state,drafts:drafts.slice(-200)})},
  clearDraft(target,text){if(state.drafts.some(d=>same(d,target)&&d.text===text))this.draft(target,'')},
  hide(values,conversations){const input=z.object({confirmed:z.literal(true),conversations:z.array(identity.extend({updatedAt:z.number().finite()})).max(200)}).strict().parse(values);const hidden=[...state.hidden];for(const target of input.conversations){const c=conversations.find(c=>same(c,target));if(c?.status==='replied'&&c.updatedAt===target.updatedAt){const i=hidden.findIndex(h=>same(h,target));if(i>=0)hidden.splice(i,1);hidden.push(target)}}commit({...state,hidden:hidden.slice(-200)})},
  reveal(target){if(state.hidden.some(h=>same(h,target)))commit({...state,hidden:state.hidden.filter(h=>!same(h,target))})}
 };
}
module.exports={createAuxiliaryState};
