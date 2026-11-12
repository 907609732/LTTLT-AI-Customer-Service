'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('本机工作区记录无法读取，请保留文件并检查。');}}
function durable(file,value,{exclusive=false}={}){
 fs.mkdirSync(path.dirname(file),{recursive:true});const raw=JSON.stringify(value,null,2);const temp=file+'.'+randomUUID()+'.tmp';
 const fd=fs.openSync(exclusive?file:temp,exclusive?'wx':'wx',0o600);
 try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(!exclusive)fs.renameSync(temp,file);
}
function empty(folder){return !fs.existsSync(folder)||fs.readdirSync(folder).length===0;}
const browserDirs=new Set(['partitions','sessions','session storage','local storage','indexeddb','cache','code cache','gpuCache'.toLowerCase(),'service worker']);
function copyData(source,target){
 if(!fs.existsSync(source))return;fs.mkdirSync(target,{recursive:true});
 for(const item of fs.readdirSync(source,{withFileTypes:true})){
  if(browserDirs.has(item.name.toLowerCase()))continue;
  if(item.isSymbolicLink())throw Error('工作区含链接，不能安全认领。');
  const from=path.join(source,item.name),to=path.join(target,item.name);
  if(item.isDirectory())copyData(from,to);else if(item.isFile())fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);else throw Error('工作区含不支持的文件。');
 }
}
function createAccountWorkspaces({dataRoot,origin}){
 if(!path.isAbsolute(dataRoot))throw Error('工作区路径必须为绝对路径');
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error('工作区服务地址无效');
 const originId=hash(origin).slice(0,24),legacy=path.join(dataRoot,'backend');
 const marker=path.join(dataRoot,'legacy-workspace-owner.json');
 const externalMarker=path.join(dataRoot,'external-client-owner.json');
 const ownership=()=>{const value=read(marker);if(value&&(!value.owner||!value.backup||!['copying','ready'].includes(value.state)))throw Error('工作区归属记录损坏，已阻止访问。');return value;};
 const count=()=>{const raw=read(path.join(legacy,'stores.json'));return (Array.isArray(raw)?raw:raw?.stores||[]).length;};
 function identity(userId){if(!['number','string'].includes(typeof userId)||!String(userId)||String(userId).length>512)throw Error('账号无效');return originId+'-'+hash(String(userId)).slice(0,32);}
 function externalOwner(){
  const legacyOwner=ownership(),native=read(externalMarker);
  if(native&&(native.version!==1||typeof native.owner!=='string'||!native.origin||!Number.isSafeInteger(native.createdAt)))throw Error('抖店客户端归属记录损坏，已阻止访问。');
  if(native&&legacyOwner&&native.owner!==legacyOwner.owner)throw Error('抖店客户端归属记录冲突，已阻止访问。');
  return native?{owner:native.owner,source:'explicit'}:legacyOwner?{owner:legacyOwner.owner,source:'legacy'}:null;
 }
 function externalClient(id){const owner=externalOwner();return {status:owner?(owner.owner===id?'owned':'other'):'unclaimed',allowed:owner?owner.owner===id:!id,canClaim:!!id&&!owner,source:owner?.source||null};}
 function account(userId){
  const id=identity(userId),folder=path.join(dataRoot,'account-profiles',id),meta=read(path.join(folder,'profile.json')),owner=ownership();
  if(meta&&meta.id!==id)throw Error('工作区记录不匹配');
  if(owner?.owner===id&&owner.state!=='ready')throw Error('原有工作区认领尚未完成，请保留备份并恢复后重试。');
  const pending=!meta&&count()>0&&!owner;
  return {id,dataDir:path.join(folder,'backend'),partitionNamespace:owner?.owner===id?'':id,pending,externalClient:externalClient(id),legacyAdoption:{count:count(),claimed:!!owner,pending}};
 }
 function initialize(userId,adopt){
  const descriptor=account(userId),folder=path.dirname(descriptor.dataDir),metaFile=path.join(folder,'profile.json');
  if(read(metaFile)||!empty(descriptor.dataDir))throw Error('账号工作区已初始化或非空，不能覆盖。');
  if(adopt){
   if(ownership())throw Error('原有工作区已归属账号，不能重复认领。');
   const native=externalOwner();if(native&&native.owner!==descriptor.id)throw Error('本机抖店客户端已绑定其他灵兔账号，不能认领原有工作区。');
   const backup=Date.now()+'-'+randomUUID();
   // Main closes all stores and stops collection before invoking adoption. Only backend data is copied.
   copyData(legacy,path.join(dataRoot,'workspace-backups',backup,'backend'));
   durable(marker,{version:1,owner:descriptor.id,origin,backup,state:'copying',createdAt:Date.now()},{exclusive:true});
   copyData(legacy,descriptor.dataDir);
   durable(metaFile,{version:1,id:descriptor.id,adoptedLegacy:true});
   durable(marker,{version:1,owner:descriptor.id,origin,backup,state:'ready',createdAt:Date.now()});
  }else{
   fs.mkdirSync(descriptor.dataDir,{recursive:true});durable(metaFile,{version:1,id:descriptor.id,adoptedLegacy:false});
  }
  return account(userId);
 }
 function local(){const owner=ownership()||externalOwner();return {...(owner?{id:'local-isolated',dataDir:path.join(dataRoot,'local-isolated','backend'),partitionNamespace:'local-isolated',pending:false}:{id:'legacy-local',dataDir:legacy,partitionNamespace:'',pending:false}),externalClient:externalClient(null)};}
 function claimExternal(userId,confirmed){
  if(confirmed!==true)throw Error('请先确认将本机抖店客户端绑定当前灵兔账号。');
  const id=identity(userId),owner=externalOwner();if(owner&&owner.owner!==id)throw Error('本机抖店客户端已绑定其他灵兔账号，不能重复绑定。');
  if(!owner)durable(externalMarker,{version:1,origin,owner:id,createdAt:Date.now()},{exclusive:true});
  return account(userId);
 }
 return {account,adopt:userId=>initialize(userId,true),skip:userId=>initialize(userId,false),local,ownership,claimExternal,externalClient:userId=>externalClient(userId===null?null:identity(userId)),ensure(userId){const d=account(userId);if(!d.pending&&!read(path.join(path.dirname(d.dataDir),'profile.json')))return initialize(userId,false);return d;}};
}
module.exports={createAccountWorkspaces};

