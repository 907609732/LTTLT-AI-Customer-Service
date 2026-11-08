import {createContext,useContext,useState,useEffect,useCallback,useRef} from 'react';
import type {ReactNode} from 'react';
import type {FrontendResult} from '../services/contracts';
export type Store={id:string;storeName:string;platform:string;group?:string;aiEnabled:boolean;runtime:{open:boolean;online:boolean;awaitingClient?:boolean;collectionError?:string;lastError?:string}};
export type Conversation={storeId:string;uid:string;name:string;status:string;messages:{from:string;content:string;ts:number}[];updatedAt?:number};
export type BackendSnapshot={revision:number;stores:Store[];config:{ai:{systemPrompt:string;baseUrl:string;model:string};reply?:{enabled:boolean};safety:{handoffKeywords:string[]}};engine:Record<string,{running:boolean;paused:boolean}>;conversations:Conversation[];selection:{storeId:string;conversationId:string};capabilities:{platforms:{id:string;label:string}[];apiKeyConfigured:boolean}};
export type BackendCommand={action:string;screenId?:string;storeId?:string;conversationId?:string;values?:Record<string,unknown>};
const empty:BackendSnapshot={revision:0,stores:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},safety:{handoffKeywords:[]}},engine:{},conversations:[],selection:{storeId:'',conversationId:''},capabilities:{platforms:[],apiKeyConfigured:false}};
type BackendContext={available:boolean;loading:boolean;error:string;snapshot:BackendSnapshot;execute:(c:BackendCommand)=>Promise<FrontendResult>;settings:boolean;setSettings:(v:boolean)=>void};
const Context=createContext<BackendContext>({available:false,loading:false,error:'',snapshot:empty,execute:async()=>{throw Error('服务未连接')},settings:false,setSettings(){}});
export const useBackend=()=>useContext(Context);
export function BackendProvider({children}:{children:ReactNode}){
 const available=Boolean(window.lingtu?.backendSnapshot);const [snapshot,setSnapshot]=useState(empty),[loading,setLoading]=useState(available),[error,setError]=useState(''),[settings,setSettings]=useState(false);const live=useRef(true);const sequence=useRef(0);
 const refresh=useCallback(async()=>{if(!window.lingtu?.backendSnapshot)return;const ticket=++sequence.current;try{const next=await window.lingtu.backendSnapshot();if(live.current&&ticket===sequence.current){setSnapshot(next);setError('');}}catch(e){if(live.current)setError(e instanceof Error?e.message:String(e));}finally{if(live.current)setLoading(false)}},[]);
 useEffect(()=>{live.current=true;let timer:ReturnType<typeof setTimeout>|undefined;const off=window.lingtu?.onBackendEvent?.(()=>{if(!timer)timer=setTimeout(()=>{timer=undefined;void refresh()},100)});void refresh();return()=>{live.current=false;clearTimeout(timer);off?.()}},[refresh]);
 const execute=useCallback(async(command:BackendCommand)=>{if(!window.lingtu?.backendExecute)throw Error('服务未连接');try{const result=await window.lingtu.backendExecute(command);await refresh();return result;}catch(e){await refresh();const message=e instanceof Error?e.message:String(e);throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}},[refresh]);
 return <Context.Provider value={{available,loading,error,snapshot,execute,settings,setSettings}}>{children}</Context.Provider>;
}
