import {createContext,useContext,useEffect,useState,useRef,useCallback} from 'react';import type {ReactNode} from 'react';
import {version as appVersion} from '../../package.json';
export type UpdateState={status:'idle'|'checking'|'available'|'latest'|'error'|'unpublished'|'unsupported'|'downloading'|'downloaded'|'installing';progress?:{percent:number;transferred:number;total:number;bytesPerSecond:number};failureStage?:'check'|'download'|'install'|null;currentVersion:string;availableVersion:string;manual:boolean;checkedAt:string|null;message:string;revision:number};
const initial:UpdateState={status:'idle',currentVersion:appVersion,availableVersion:'',manual:false,checkedAt:null,message:'',revision:0};
type UpdateContext={state:UpdateState;check:()=>Promise<void>;downloadAndInstall:()=>Promise<void>;openRelease:()=>Promise<void>};
const Context=createContext<UpdateContext>({state:initial,async check(){},async downloadAndInstall(){},async openRelease(){}});
export const useUpdates=()=>useContext(Context);
export function UpdateProvider({children}:{children:ReactNode}){
 const [state,setState]=useState(initial);const mounted=useRef(true);
 const accept=useCallback((next:UpdateState)=>{if(mounted.current)setState(previous=>next.revision>=previous.revision?next:previous)},[]);
 useEffect(()=>{mounted.current=true;const off=window.lingtu?.onUpdateState?.(accept);void window.lingtu?.updateSnapshot?.().then(accept).catch(()=>{});return()=>{mounted.current=false;off?.()}},[accept]);
 const check=useCallback(async()=>{if(!window.lingtu?.checkForUpdates){setState(s=>({...s,status:'unsupported',manual:true,message:'请使用正式软件检查更新。',revision:s.revision+1}));return;}try{accept(await window.lingtu.checkForUpdates())}catch{setState(s=>({...s,status:'error',manual:true,message:'更新服务暂不可用，请稍后重试。',revision:s.revision+1}))}},[accept]);
 const openRelease=useCallback(async()=>{try{await window.lingtu?.openUpdateRelease?.()}catch{setState(s=>({...s,status:'error',manual:true,message:'无法打开浏览器，请稍后重试。',revision:s.revision+1}))}},[]);
 const downloadAndInstall=useCallback(async()=>{if(!window.lingtu?.downloadAndInstallUpdate){setState(s=>({...s,status:'unsupported',manual:true,message:'此版本不支持软件内安装，请先安装新版。',revision:s.revision+1}));return;}try{accept(await window.lingtu.downloadAndInstallUpdate());}catch{if(mounted.current)setState(s=>({...s,status:'error',manual:true,failureStage:'download',message:'更新操作失败，请稍后重试。',revision:s.revision+1}));}},[accept]);
 return <Context.Provider value={{state,check,downloadAndInstall,openRelease}}>{children}</Context.Provider>;
}
export function CheckUpdateLink(){const u=useUpdates();const busy=['checking','downloading','downloaded','installing'].includes(u.state.status);return <button className="check-update-link" aria-label="检测更新" disabled={busy} onClick={()=>void u.check()}>{busy?(u.state.status==='checking'?'检测中…':'正在更新…'):'检测更新'}</button>}
export function UpdateNotice({onVisibilityChange}:{onVisibilityChange?:(visible:boolean)=>void}={}){
 const u=useUpdates(),[dismissed,setDismissed]=useState(-1);const s=u.state;
 const busy=['downloading','downloaded','installing'].includes(s.status);
 const visible=window.lingtu?.role!=='auxiliary'&&dismissed!==s.revision&&!['idle','checking'].includes(s.status)&&(s.manual||s.status==='available'||busy);
 useEffect(()=>{onVisibilityChange?.(visible);return()=>onVisibilityChange?.(false);},[visible,onVisibilityChange]);
 if(!visible)return null;
 const heading=s.status==='available'?'发现新版本 v'+s.availableVersion:busy?'正在更新至 v'+s.availableVersion:'软件更新';
 const retryUpdate=s.status==='error'&&['download','install'].includes(s.failureStage||'');
 return <section role="dialog" aria-label="软件更新" className="update-notice"><h2>{heading}</h2><p>当前版本 v{s.currentVersion}</p><p role="status">{s.message}</p>
 {s.status==='downloading'&&<div className="update-progress"><progress aria-label="更新下载进度" max={100} value={s.progress?.percent||0}/><span>{(s.progress?.percent||0).toFixed(0)}%{s.progress?.total?` · ${((s.progress?.transferred||0)/1048576).toFixed(1)} / ${(s.progress.total/1048576).toFixed(1)} MB`:''}</span></div>}
 {s.status==='available'&&<p>请先保存正在编辑的内容。下载完成并校验通过后，将自动退出、安装并重新打开软件。</p>}
 <footer>{s.status==='available'&&<button onClick={()=>void u.downloadAndInstall()}>下载并自动安装</button>}
 {retryUpdate&&<button onClick={()=>void u.downloadAndInstall()}>{s.failureStage==='install'?'重试安装':'重试下载'}</button>}
 {s.status==='error'&&!retryUpdate&&<button onClick={()=>void u.check()}>重新检测</button>}
 {s.status==='error'&&<button onClick={()=>void u.openRelease()}>备用下载</button>}
 {!busy&&<button autoFocus={s.manual} onClick={()=>setDismissed(s.revision)}>关闭</button>}</footer></section>;
}
