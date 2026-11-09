import {ManagedAccessProvider} from './features/ManagedAccess';
import {useCallback,useEffect,useState} from 'react';
import {BackendProvider,useBackend} from './features/BackendProvider';
import {BackendChrome,useBackendLayers} from './features/BackendLayers';
import {UpdateProvider,UpdateNotice} from './features/Updates';
import DesignPreview from './DesignPreview';
import FigmaCanvas from './design/FigmaCanvas';
import manifest from './design/generated/manifest.json';
import definitions from './design/generated/components.json';
import {initialInteractionState,applyInteraction} from './design/interaction.mjs';
import type {InteractionAction,InteractionHost} from './design/interaction.mjs';
import type {FigmaLayer,FigmaRegistry} from './design/types';
import type {DesignAction} from './design/actions';
import {FrontendProvider,useFrontendActions} from './features/FrontendControls';
const registry=definitions as unknown as FigmaRegistry;
const routes=Object.fromEntries(manifest.files.map(s=>[s.nodeId,s.uxId]));const targets=new Set([...Object.keys(registry),...Object.keys(routes)]);
const sets=Object.fromEntries(Object.values(registry).filter(n=>n.props.componentSetId).map(n=>[n.id,String(n.props.componentSetId)]));
const receptionVariants=Object.values(registry).filter(n=>n.name.startsWith('菜单=')&&n.name.includes('接待模式='));
const receptionClosed=Object.fromEntries(receptionVariants.map(n=>[n.id,receptionVariants.find(v=>v.name===n.name.replace(/菜单=[^,]+/,'菜单=关闭'))!.id]));
const screenModules=import.meta.glob<{default:FigmaLayer}>('./design/generated/screens/UX*.json');
export default function App(){return new URLSearchParams(location.search).get('design')==='1'?<DesignPreview/>:<ManagedAccessProvider><BackendProvider><UpdateProvider><Product/></UpdateProvider></BackendProvider></ManagedAccessProvider>;}
function Product(){
 const backend=useBackend();
 const start=new URLSearchParams(location.search).get('screen');
 const [state,setState]=useState(()=>initialInteractionState(manifest.files.some(s=>s.uxId===start)?start!:'UX01'));
 const [design,setDesign]=useState<FigmaLayer|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [confirmClose,setConfirmClose]=useState(false);
 const [closeDesign,setCloseDesign]=useState<FigmaLayer|null>(null);
 useEffect(()=>{if(confirmClose&&!closeDesign)void screenModules['./design/generated/screens/UX32.json']().then(m=>setCloseDesign(m.default));},[confirmClose,closeDesign]);
 useEffect(()=>{if(!confirmClose||!closeDesign)return;const id=requestAnimationFrame(()=>document.querySelector<HTMLElement>('.aux-close-source-mask [role="button"][aria-label="取消"]')?.focus());return()=>cancelAnimationFrame(id);},[confirmClose,closeDesign]);
 const [viewport,setViewport]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
 useEffect(()=>{const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 const dispatch=useCallback((action:InteractionAction,ancestors:InteractionHost[])=>{
  const target=action.navigation==='NAVIGATE'&&action.destinationId?routes[action.destinationId]:undefined;
  if(target==='UX32'){setConfirmClose(true);return;}
  if(target&&window.lingtu){
   if(window.lingtu.role==='main'&&Number(target.slice(2))>=26){void window.lingtu.openAuxiliary(target).catch(()=>setNotice('辅助窗口打开失败，请重试。'));return;}
   if(window.lingtu.role==='auxiliary'&&Number(target.slice(2))<26){if(target==='UX01')void window.lingtu.windowAction('close');else void window.lingtu.openMain(target);return;}
  }
  setState(previous=>applyInteraction(previous,action,{routes,targets,sets,ancestors,receptionClosed}));
 },[]);
 const requestOverlay=useCallback((id:string)=>dispatch({type:'NODE',navigation:'OVERLAY',destinationId:id},[]),[dispatch]);
 useEffect(()=>window.lingtu?.onNavigate(screen=>{const destination=manifest.files.find(s=>s.uxId===screen);if(destination)setState(previous=>applyInteraction(previous,{type:'NODE',navigation:'NAVIGATE',destinationId:destination.nodeId},{routes,targets,sets,ancestors:[],receptionClosed}));}),[]);
 useEffect(()=>window.lingtu?.onConfirmClose(()=>setConfirmClose(true)),[]);
 useEffect(()=>{let active=true;setError('');setDesign(null);screenModules['./design/generated/screens/'+state.screenId+'.json']().then(m=>{if(active)setDesign(m.default)}).catch(()=>{if(active)setError('界面加载失败，请重试。')});return()=>{active=false};},[state.screenId]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
 const onAction=(action:DesignAction)=>{
  if(action.kind==='navigate'){const dest=manifest.files.find(s=>s.uxId===action.to);if(dest)dispatch({type:'NODE',navigation:'NAVIGATE',destinationId:dest.nodeId},[]);}
  if(action.kind==='notice')setNotice(action.message);if(action.kind==='window'&&window.lingtu)void window.lingtu.windowAction(action.action);
 };
 const auxiliary=Number(state.screenId.slice(2))>=26;
 const canvasViewport=auxiliary?{width:300,height:Math.max(900,viewport.height)}:{width:Math.max(1440,viewport.width),height:Math.max(900,viewport.height)};
 const finishClose=()=>{setConfirmClose(false);if(window.lingtu?.role==='auxiliary')void window.lingtu.windowAction('close');else dispatch({type:'NODE',navigation:'NAVIGATE',destinationId:'8836:4283'},[]);};
 const closeInteraction=(action:InteractionAction)=>{if(action.type==='BACK'||action.type==='CLOSE')setConfirmClose(false);else if(action.navigation==='NAVIGATE'&&action.destinationId==='8836:4283')finishClose();};
 if(backend.available&&backend.loading)return <div role="status" className="stage-loading">正在读取本地业务数据…</div>;
 return <FrontendProvider key={backend.snapshot.workspaceId} onNotice={setNotice} onOverlay={requestOverlay}><main className={'product-app '+(auxiliary?'product-auxiliary':'')} aria-label="灵兔客服">
  <div inert={confirmClose||state.overlays.length>0} aria-hidden={confirmClose||state.overlays.length>0||undefined}>{error?<div role="alert" className="stage-error">{error}<button onClick={()=>location.reload()}>重新加载</button></div>:!design?<div role="status" className="stage-loading">正在加载界面…</div>:<ProductCanvas notice={setNotice} design={design} screenId={state.screenId} scale={1} viewport={canvasViewport} state={state} onInteraction={dispatch} onAction={onAction}/>}</div>
  {state.overlays.map((id,index)=>registry[id]&&<div key={index+':'+id} className="product-overlay" role="dialog" aria-modal="true" aria-label={registry[id].name}><ProductCanvas notice={setNotice} design={registry[id]} screenId={state.screenId} scale={1} state={state} onInteraction={dispatch} onAction={onAction}/></div>)}
  <BackendChrome screen={state.screenId} notice={setNotice}/><UpdateNotice/>{notice&&<div role="status" className="dev-toast">{notice}</div>}
  {confirmClose&&<div className="aux-close-source-mask" role="dialog" aria-modal="true" aria-label="关闭 AI 辅助中心" onKeyDown={e=>{if(e.key==='Escape')setConfirmClose(false)}}>{closeDesign?<FigmaCanvas design={closeDesign} screenId="UX32" scale={1} onInteraction={closeInteraction} onAction={action=>{if(action.kind==='navigate'){if(action.to==='UX01')finishClose();else setConfirmClose(false);}}}/>:<div role="status">正在加载确认界面…</div>}</div>}
 </main></FrontendProvider>;
}
function ProductCanvas({notice,...props}:React.ComponentProps<typeof FigmaCanvas>&{notice:(s:string)=>void}){const onUIAction=useFrontendActions();const renderLayer=useBackendLayers(props.screenId,notice);return <FigmaCanvas {...props} renderLayer={renderLayer} onUIAction={onUIAction}/>;}
