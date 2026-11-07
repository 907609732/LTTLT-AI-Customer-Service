import {useCallback,useEffect,useState} from 'react';
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
export default function App(){return new URLSearchParams(location.search).get('design')==='1'?<DesignPreview/>:<Product/>;}
function Product(){
 const start=new URLSearchParams(location.search).get('screen');
 const [state,setState]=useState(()=>initialInteractionState(manifest.files.some(s=>s.uxId===start)?start!:'UX01'));
 const [design,setDesign]=useState<FigmaLayer|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [confirmClose,setConfirmClose]=useState(false);
 const dispatch=useCallback((action:InteractionAction,ancestors:InteractionHost[])=>{
  const target=action.navigation==='NAVIGATE'&&action.destinationId?routes[action.destinationId]:undefined;
  if(target==='UX32'){setConfirmClose(true);return;}
  if(target&&window.lingtu){
   if(window.lingtu.role==='main'&&Number(target.slice(2))>=26){void window.lingtu.openAuxiliary(target).catch(()=>setNotice('辅助窗口打开失败，请重试。'));return;}
   if(window.lingtu.role==='auxiliary'&&Number(target.slice(2))<26){if(target==='UX01')void window.lingtu.windowAction('close');else void window.lingtu.openMain(target);return;}
  }
  setState(previous=>applyInteraction(previous,action,{routes,targets,sets,ancestors,receptionClosed}));
 },[]);
 useEffect(()=>window.lingtu?.onNavigate(screen=>{const destination=manifest.files.find(s=>s.uxId===screen);if(destination)setState(previous=>applyInteraction(previous,{type:'NODE',navigation:'NAVIGATE',destinationId:destination.nodeId},{routes,targets,sets,ancestors:[],receptionClosed}));}),[]);
 useEffect(()=>window.lingtu?.onConfirmClose(()=>setConfirmClose(true)),[]);
 useEffect(()=>{let active=true;setError('');setDesign(null);screenModules['./design/generated/screens/'+state.screenId+'.json']().then(m=>{if(active)setDesign(m.default)}).catch(()=>{if(active)setError('界面加载失败，请重试。')});return()=>{active=false};},[state.screenId]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
 const onAction=(action:DesignAction)=>{
  if(action.kind==='navigate'){const dest=manifest.files.find(s=>s.uxId===action.to);if(dest)dispatch({type:'NODE',navigation:'NAVIGATE',destinationId:dest.nodeId},[]);}
  if(action.kind==='notice')setNotice(action.message);if(action.kind==='window'&&window.lingtu)void window.lingtu.windowAction(action.action);
 };
 const auxiliary=Number(state.screenId.slice(2))>=26;
 return <FrontendProvider onNotice={setNotice}><main className={'product-app '+(auxiliary?'product-auxiliary':'')} aria-label="灵兔客服">
  <div inert={confirmClose||state.overlays.length>0} aria-hidden={confirmClose||state.overlays.length>0||undefined}>{error?<div role="alert" className="stage-error">{error}<button onClick={()=>location.reload()}>重新加载</button></div>:!design?<div role="status" className="stage-loading">正在加载界面…</div>:<ProductCanvas design={design} screenId={state.screenId} scale={1} state={state} onInteraction={dispatch} onAction={onAction}/>}</div>
  {state.overlays.map((id,index)=>registry[id]&&<div key={index+':'+id} className="product-overlay" role="dialog" aria-modal="true" aria-label={registry[id].name}><ProductCanvas design={registry[id]} screenId={state.screenId} scale={1} state={state} onInteraction={dispatch} onAction={onAction}/></div>)}
  {notice&&<div role="status" className="dev-toast">{notice}</div>}
  {confirmClose&&<div className="aux-close-mask" role="dialog" aria-modal="true" aria-label="关闭 AI 辅助中心" onKeyDown={e=>{if(e.key==='Escape')setConfirmClose(false)}}><section><h3>关闭 AI 辅助中心</h3><p>关闭后停止新消息聚合和人工预警。最小化可继续值守；关闭后可从主界面入口重新打开。</p><footer><button autoFocus onClick={()=>setConfirmClose(false)}>取消</button><button className="primary" onClick={()=>{setConfirmClose(false);if(window.lingtu?.role==='auxiliary')void window.lingtu.windowAction('close');else dispatch({type:'NODE',navigation:'NAVIGATE',destinationId:'8836:4283'},[]);}}>关闭</button></footer></section></div>}
 </main></FrontendProvider>;
}
function ProductCanvas(props:React.ComponentProps<typeof FigmaCanvas>){const onUIAction=useFrontendActions();return <FigmaCanvas {...props} onUIAction={onUIAction}/>;}
