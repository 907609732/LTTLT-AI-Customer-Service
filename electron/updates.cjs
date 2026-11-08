const RELEASES_URL='https://github.com/907609732/LTTLT-AI-Customer-Service/releases';
function createUpdateService({updater,currentVersion,openExternal=async()=>{},onChange=()=>{},enabled=true,timeoutMs=20000}){
 let state={status:'idle',currentVersion,availableVersion:'',manual:false,checkedAt:null,message:'',revision:0};
 let flight=null,timer,disposed=false,generation=0;
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;updater.logger=null;
 const swallow=()=>{};updater.on('error',swallow);
 const snapshot=()=>structuredClone(state);
 function publish(patch){if(disposed)return;state={...state,...patch,revision:state.revision+1};onChange(snapshot());}
 function check(manual=false){
  if(disposed)return Promise.resolve(snapshot());
  if(flight){if(manual&&!state.manual)publish({manual:true});return flight;}
  if(!enabled){publish({status:'unsupported',manual,message:'请使用正式打包版本检查更新。'});return Promise.resolve(snapshot());}
  const token=++generation;
  publish({status:'checking',manual,availableVersion:'',message:'正在检查GitHub更新…'});
  flight=(async()=>{
   try{
    const result=await Promise.race([Promise.resolve().then(()=>updater.checkForUpdates()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('update_check_timeout')),timeoutMs)})]);
    if(disposed||token!==generation)return snapshot();
    if(!result||typeof result.isUpdateAvailable!=='boolean'||typeof result.updateInfo?.version!=='string'||result.updateInfo.version.length>64)throw Error('update_metadata_unavailable');
    publish({status:result.isUpdateAvailable?'available':'latest',availableVersion:result.updateInfo.version,checkedAt:new Date().toISOString(),message:result.isUpdateAvailable?'发现新版本，可前往GitHub下载。':'当前已是最新版本。'});
   }catch(error){
    if(disposed||token!==generation)return snapshot();
    publish({status:'error',checkedAt:new Date().toISOString(),message:'未能获取正式版本，请检查网络后重试，或查看GitHub发行页。'});
   }finally{clearTimeout(timer);flight=null;if(disposed)updater.removeListener('error',swallow);}
   return snapshot();
  })();
  return flight;
 }
 return {snapshot,check,async openReleasePage(){if(disposed)return;await openExternal(RELEASES_URL);return {opened:true};},dispose(){disposed=true;generation++;clearTimeout(timer);if(!flight)updater.removeListener('error',swallow);}};
}
module.exports={createUpdateService,RELEASES_URL};
