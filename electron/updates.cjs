const RELEASES_URL='https://github.com/907609732/LTTLT-AI-Customer-Service/releases';
function createUpdateService({updater,currentVersion,openExternal=async()=>{},onChange=()=>{},enabled=true,timeoutMs=20000}){
 let state={status:'idle',currentVersion,availableVersion:'',manual:false,checkedAt:null,message:'',revision:0,progress:{percent:0,transferred:0,total:0,bytesPerSecond:0},failureStage:null};
 let flight=null,downloadFlight=null,timer,disposed=false,generation=0,verified=false;
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;updater.logger=null;
 const swallow=()=>{if(!disposed&&state.status==='installing'){
  // electron-updater 6.x leaves this latch set when an installer spawn rejects asynchronously.
  if(typeof updater.quitAndInstallCalled==='boolean')updater.quitAndInstallCalled=false;
  publish({status:'error',failureStage:'install',message:'安装未能启动，请重试安装，或使用备用下载。'});
 }};updater.on('error',swallow);
 const snapshot=()=>structuredClone(state);
 function publish(patch){if(disposed)return;state={...state,...patch,revision:state.revision+1};onChange(snapshot());}
 function check(manual=false){
  if(disposed)return Promise.resolve(snapshot());
  if(downloadFlight||['downloading','downloaded','installing'].includes(state.status)||verified){if(manual&&!state.manual)publish({manual:true});return Promise.resolve(snapshot());}
  if(flight){if(manual&&!state.manual)publish({manual:true});return flight;}
  if(!enabled){publish({status:'unsupported',manual,message:'请使用正式打包版本检查更新。'});return Promise.resolve(snapshot());}
  const token=++generation;
  publish({status:'checking',manual,availableVersion:'',failureStage:null,message:'正在检查更新…'});
  flight=(async()=>{
   try{
    const result=await Promise.race([Promise.resolve().then(()=>updater.checkForUpdates()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('update_check_timeout')),timeoutMs)})]);
    if(disposed||token!==generation)return snapshot();
    if(!result||typeof result.isUpdateAvailable!=='boolean'||typeof result.updateInfo?.version!=='string'||result.updateInfo.version.length>64)throw Error('update_metadata_unavailable');
    publish({status:result.isUpdateAvailable?'available':'latest',availableVersion:result.updateInfo.version,checkedAt:new Date().toISOString(),message:result.isUpdateAvailable?'发现新版本，可在软件内下载并自动安装。':'当前已是最新版本。'});
   }catch(error){
    if(disposed||token!==generation)return snapshot();
    publish({status:'error',failureStage:'check',checkedAt:new Date().toISOString(),message:'未能获取正式版本，请检查网络后重试。'});
   }finally{clearTimeout(timer);flight=null;cleanupErrorListener();}
   return snapshot();
  })();
  return flight;
 }
 function cleanupErrorListener(){if(disposed&&!flight&&!downloadFlight)updater.removeListener('error',swallow);}
 const nonnegative=value=>Number.isFinite(value)?Math.max(0,value):0;
 const progress=info=>{if(!disposed&&state.status==='downloading')publish({progress:{percent:Math.min(100,nonnegative(info?.percent)),transferred:nonnegative(info?.transferred),total:nonnegative(info?.total),bytesPerSecond:nonnegative(info?.bytesPerSecond)}});};
 const downloaded=info=>{if(!disposed&&state.status==='downloading'&&info?.version===state.availableVersion){verified=true;publish({status:'downloaded',progress:{...state.progress,percent:100},message:'下载校验完成，正在准备自动安装…'});}};
 updater.on('download-progress',progress);updater.on('update-downloaded',downloaded);
 function install(){
  if(disposed||!verified||state.status==='installing')return snapshot();
  publish({status:'installing',failureStage:null,message:'正在退出并安装更新，完成后将自动打开软件。'});
  try{updater.quitAndInstall(true,true);}catch{swallow();}
  return snapshot();
 }
 function downloadAndInstall(){
  if(disposed)return Promise.resolve(snapshot());
  if(downloadFlight)return downloadFlight;
  if(!enabled){publish({status:'unsupported',manual:true,message:'请使用正式安装版本更新软件。'});return Promise.resolve(snapshot());}
  if(verified)return Promise.resolve(install());
  if(!state.availableVersion||!(state.status==='available'||(state.status==='error'&&state.failureStage==='download')))return Promise.resolve(snapshot());
  const token=++generation;verified=false;
  publish({status:'downloading',manual:true,failureStage:null,progress:{percent:0,transferred:0,total:0,bytesPerSecond:0},message:'正在下载更新，完成后将自动重启安装。'});
  downloadFlight=Promise.resolve().then(async()=>{
   try{if(disposed||token!==generation)return snapshot();const files=await updater.downloadUpdate();if(disposed||token!==generation)return snapshot();if(!verified||!Array.isArray(files)||!files.length)throw Error('download_not_verified');return install();}
   catch{if(!disposed&&token===generation){verified=false;publish({status:'error',failureStage:'download',message:'下载或校验失败，未安装更新。请检查网络后重试。'});}return snapshot();}
   finally{downloadFlight=null;cleanupErrorListener();}
  });return downloadFlight;
 }
 return {snapshot,check,downloadAndInstall,async openReleasePage(){if(disposed)return;await openExternal(RELEASES_URL);return {opened:true};},dispose(){disposed=true;generation++;clearTimeout(timer);updater.removeListener('download-progress',progress);updater.removeListener('update-downloaded',downloaded);cleanupErrorListener();}};
}
module.exports={createUpdateService,RELEASES_URL};
