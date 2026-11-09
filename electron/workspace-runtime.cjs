'use strict';
const {randomUUID}=require('node:crypto');
const {ManagedSessionError}=require('./managed-session.cjs');
const empty=()=>({revision:0,stores:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},safety:{handoffKeywords:[]}},engine:{},conversations:[],selection:{storeId:'',conversationId:''},capabilities:{platforms:[],apiKeyConfigured:false,modelMode:'managed'}});
const canceled=()=>Object.assign(Error('工作区切换已取消'),{code:'workspace_canceled'});
/** Coordinates main-owned backends. A fresh opaque workspaceId invalidates every renderer command/result. */
function createWorkspaceRuntime({workspaces,createHost,createBackend,managedChat,onEvent=()=>{},onReset=()=>{},onChange=()=>{}}){
 let backend=null,host=null,profile=null,mode='locked',workspaceId=randomUUID(),epoch=0,disposed=false,session={status:'signed_out',account:null},pending=null;
 let queue=Promise.resolve();
 function view(){return {id:profile?.id||null,mode,workspaceId,legacyAdoption:pending?.legacyAdoption||profile?.legacyAdoption||null,externalClient:workspaces.externalClient?.(session.status==='signed_in'?session.account.userId:null)||null};}
 function snapshot(){return {...(backend?.snapshot()||empty()),workspaceId,workspaceMode:mode};}
 function invalidate(){epoch++;workspaceId=randomUUID();const oldBackend=backend,oldHost=host;backend=null;host=null;profile=null;mode='locked';oldBackend?.dispose();onReset({type:'workspace:reset',workspaceId});onChange(view());return Promise.resolve(oldHost?.close()).catch(()=>{});}
 function change(descriptor,nextMode){
  const closed=invalidate(),ticket=epoch;
  const operation=async()=>{
   await closed;if(disposed||ticket!==epoch)throw canceled();
   if(!descriptor||descriptor.pending){pending=descriptor;onChange(view());return;}
   pending=null;
   const allowExternalClient=descriptor.externalClient?.allowed??descriptor.partitionNamespace==='';
   const nextHost=createHost({dataDir:descriptor.dataDir,partitionNamespace:descriptor.partitionNamespace,allowExternalClient});
   const nextBackend=createBackend({dataDir:descriptor.dataDir,...nextHost,modelMode:nextMode,allowExternalClient,externalClientReady:()=>{if(workspaces.externalClient&&!workspaces.externalClient(session.status==='signed_in'?session.account.userId:null).allowed)throw Error('请在登录账号页面确认本机抖店客户端的账号绑定。');},managedReady:assertManagedReady,managedChat,
    onEvent:event=>{if(!disposed&&ticket===epoch)onEvent({...event,workspaceId});}});
   host=nextHost;backend=nextBackend;profile=descriptor;mode=nextMode;
   try{await nextHost.start();}catch{if(ticket===epoch){await invalidate();throw Error('工作区平台服务启动失败');}return;}
   if(disposed||ticket!==epoch){nextBackend.dispose();await nextHost.close();throw canceled();}
   onEvent({type:'backend:changed',workspaceId,revision:0});onChange(view());
  };
  const run=queue.then(operation);queue=run.catch(()=>{});return run;
 }
 function assertManagedReady(){
  if(session.status==='disabled')throw new ManagedSessionError('account_disabled');
  if(session.status==='expired'||!session.account)throw new ManagedSessionError('session_expired');
  if(session.status!=='signed_in')throw new ManagedSessionError('offline');
  const trial=session.account.trial;
  if(trial&&trial.expiresAt<=Date.now()/1000)throw new ManagedSessionError('trial_expired');
  if(trial&&trial.remaining<=0)throw new ManagedSessionError('trial_exhausted');
 }
 async function acceptSession(value){
  if(disposed)return;session=value;
  if(value.status==='signed_in'){
   const descriptor=workspaces.ensure(value.account.userId);
   if(profile?.id===descriptor.id)return;
   return change(descriptor,'managed');
  }
  if(value.status==='offline'&&value.account&&profile?.id===workspaces.ensure(value.account.userId).id){backend?.stopAi();return;}
  if(mode!=='locked')return change(null,'locked');
 }
 async function execute(command){
  if(disposed||command?.workspaceId!==workspaceId)throw Error('工作区已切换，请刷新后重试。');
  if(!backend||mode==='locked')throw Error('请先登录并选择工作区，或在账号高级设置明确选择自己的 Key。');
  const ticket=epoch,target=backend;const {workspaceId:ignored,...raw}=command;
  const result=await target.execute(raw);
  if(disposed||ticket!==epoch||target!==backend)throw Error('工作区已切换，已丢弃旧操作结果。');
  return result;
 }
 async function local(){if(disposed)throw Error('服务已关闭');const descriptor=session.status==='signed_in'?workspaces.ensure(session.account.userId):workspaces.local();if(descriptor.pending)throw Error('请先选择归入已有店铺或使用空白工作区。');return change(descriptor,'local');}
 async function managed(){assertManagedReady();return change(workspaces.ensure(session.account.userId),'managed');}
 async function decide(action){if(session.status!=='signed_in')throw Error('请先登录');const id=session.account.userId;const closed=invalidate(),ticket=epoch;await closed;await queue;if(disposed||ticket!==epoch||session.status!=='signed_in'||session.account.userId!==id)throw Error('账号已切换');const descriptor=action==='adopt'?workspaces.adopt(id):workspaces.skip(id);return change(descriptor,'managed');}
 async function claimExternal(){
  if(session.status!=='signed_in'||!profile)throw Error('请先登录并选择账号工作区。');
  const binding=workspaces.externalClient(session.account.userId);
  if(binding.allowed)return;
  if(!binding.canClaim)throw Error('本机抖店客户端已绑定其他灵兔账号，不能重复绑定。');
  const id=session.account.userId,nextMode=mode,closed=invalidate(),ticket=epoch;await closed;await queue;
  if(disposed||ticket!==epoch||session.status!=='signed_in'||session.account.userId!==id)throw canceled();
  const descriptor=workspaces.claimExternal(id,true);return change(descriptor,nextMode);
 }
 async function lock(){pending=null;return change(null,'locked');}
 async function dispose(){disposed=true;pending=null;await invalidate();await queue;}
 return {snapshot,view,execute,acceptSession,assertManagedReady,local,managed,decide,claimExternal,lock,dispose,getBackend:()=>backend};
}
module.exports={createWorkspaceRuntime};
