import {createContext,useContext,useEffect,useState,useRef,useCallback} from 'react';import type {ReactNode} from 'react';
import {version as appVersion} from '../../package.json';
export type UpdateState={status:'idle'|'checking'|'available'|'latest'|'error'|'unpublished'|'unsupported';currentVersion:string;availableVersion:string;manual:boolean;checkedAt:string|null;message:string;revision:number};
const initial:UpdateState={status:'idle',currentVersion:appVersion,availableVersion:'',manual:false,checkedAt:null,message:'',revision:0};
type UpdateContext={state:UpdateState;check:()=>Promise<void>;openRelease:()=>Promise<void>};
const Context=createContext<UpdateContext>({state:initial,async check(){},async openRelease(){}});
export const useUpdates=()=>useContext(Context);
export function UpdateProvider({children}:{children:ReactNode}){
 const [state,setState]=useState(initial);const mounted=useRef(true);
 const accept=useCallback((next:UpdateState)=>{if(mounted.current)setState(previous=>next.revision>=previous.revision?next:previous)},[]);
 useEffect(()=>{mounted.current=true;const off=window.lingtu?.onUpdateState?.(accept);void window.lingtu?.updateSnapshot?.().then(accept).catch(()=>{});return()=>{mounted.current=false;off?.()}},[accept]);
 const check=useCallback(async()=>{if(!window.lingtu?.checkForUpdates){setState(s=>({...s,status:'unsupported',manual:true,message:'请使用正式软件检查更新。',revision:s.revision+1}));return;}try{accept(await window.lingtu.checkForUpdates())}catch{setState(s=>({...s,status:'error',manual:true,message:'更新服务暂不可用，请稍后重试。',revision:s.revision+1}))}},[accept]);
 const openRelease=useCallback(async()=>{try{await window.lingtu?.openUpdateRelease?.()}catch{setState(s=>({...s,status:'error',manual:true,message:'无法打开浏览器，请稍后重试。',revision:s.revision+1}))}},[]);
 return <Context.Provider value={{state,check,openRelease}}>{children}</Context.Provider>;
}
export function CheckUpdateLink(){const u=useUpdates();return <button className="check-update-link" aria-label="检测更新" disabled={u.state.status==='checking'} onClick={()=>void u.check()}>{u.state.status==='checking'?'检测中…':'检测更新'}</button>}
export function UpdateNotice(){
 const u=useUpdates(),[dismissed,setDismissed]=useState(-1);const s=u.state;
 if(window.lingtu?.role==='auxiliary'||dismissed===s.revision||['idle','checking'].includes(s.status)||(!s.manual&&s.status!=='available'))return null;
 return <section role="dialog" aria-label="软件更新" className="update-notice" onKeyDown={e=>{if(e.key==='Escape')setDismissed(s.revision)}}><h2>{s.status==='available'?'发现新版本 v'+s.availableVersion:'检查更新'}</h2><p>当前版本 v{s.currentVersion}</p><p role="status">{s.message}</p><footer>{!['latest','unsupported'].includes(s.status)&&<button onClick={()=>void u.openRelease()}>{s.status==='available'?'前往GitHub下载':'查看发行页'}</button>}<button autoFocus={s.manual} onClick={()=>setDismissed(s.revision)}>关闭</button></footer></section>;
}
