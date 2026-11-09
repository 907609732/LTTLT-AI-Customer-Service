import {createContext,useContext,useEffect,useState,useRef,useCallback} from 'react';
import type {ReactNode} from 'react';
import {ManagedAccount} from './ManagedAccount';
import type {ManagedAccountSnapshot,ManagedNativeBinding} from './ManagedAccount';
import {useBackend} from './BackendProvider';
export type ManagedState={session:ManagedAccountSnapshot;workspace:{id:string|null;workspaceId:string;mode:'locked'|'managed'|'local';externalClient?:ManagedNativeBinding|null;legacyAdoption:null|{count:number;claimed:boolean;pending?:boolean}};message:string|null};
export type ManagedAction='login'|'cancel'|'logout'|'refresh'|'local'|'managed'|'adopt'|'skip'|'claim-native';
const initial:ManagedState={session:{status:'signed_out',account:null,expiresAt:null,login:null,message:null},workspace:{id:null,workspaceId:'',mode:'locked',legacyAdoption:null},message:null};
const Context=createContext<{state:ManagedState;action:(a:ManagedAction)=>Promise<unknown>}>({state:initial,action:async()=>{throw Error('请在桌面客户端使用账号服务。');}});
export const useManagedAccess=()=>useContext(Context);
export function ManagedAccessProvider({children}:{children:ReactNode}){
 const [state,setState]=useState(initial);const sequence=useRef(0),live=useRef(true);
 useEffect(()=>{live.current=true;const off=window.lingtu?.onManagedState?.(value=>{sequence.current++;if(live.current)setState(value);});const ticket=sequence.current;void window.lingtu?.managedSnapshot?.().then(value=>{if(live.current&&ticket===sequence.current)setState(value);}).catch(()=>{});return()=>{live.current=false;off?.();};},[]);
 const action=useCallback(async(a:ManagedAction)=>{if(!window.lingtu?.managedAction)throw Error('请在桌面客户端使用账号服务。');const ticket=++sequence.current;const next=await window.lingtu.managedAction(a,state.workspace.workspaceId);if(live.current&&ticket===sequence.current)setState(next);return next;},[state.workspace.workspaceId]);
 return <Context.Provider value={{state,action}}>{children}</Context.Provider>;
}
export function ManagedAccountPanel(){
 const {state,action}=useManagedAccess();const backend=useBackend();
 return <><ManagedAccount snapshot={{...state.session,message:state.message||state.session.message}} legacyAdoption={state.workspace.legacyAdoption} externalClient={state.workspace.externalClient} onClaimNative={()=>action('claim-native')}
  onLogin={()=>action('login')} onCancelLogin={()=>action('cancel')} onLogout={()=>action('logout')} onRefresh={()=>action('refresh')}
  onAdoptLegacy={()=>action('adopt')} onSkipLegacy={()=>action('skip')}
  onShowAdvanced={async()=>{await action('local');await backend.refresh();backend.setSettings(true);}}/>
  {state.workspace.mode==='local'&&<div className="managed-account-message" role="status">当前为自己的 Key 直连模式。<button onClick={()=>void action('managed').catch(()=>{})}>切回托管模型</button></div>}
 </>;
}

