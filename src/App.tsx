import {useCallback,useEffect,useState} from 'react';
import DesignPreview from './DesignPreview';
import FigmaCanvas from './design/FigmaCanvas';
import manifest from './design/generated/manifest.json';
import definitions from './design/generated/components.json';
import {initialInteractionState,applyInteraction} from './design/interaction.mjs';
import type {InteractionAction,InteractionHost} from './design/interaction.mjs';
import type {FigmaLayer,FigmaRegistry} from './design/types';
import type {DesignAction} from './design/actions';
const registry=definitions as unknown as FigmaRegistry;
const routes=Object.fromEntries(manifest.files.map(s=>[s.nodeId,s.uxId]));const targets=new Set([...Object.keys(registry),...Object.keys(routes)]);
const sets=Object.fromEntries(Object.values(registry).filter(n=>n.props.componentSetId).map(n=>[n.id,String(n.props.componentSetId)]));
const screenModules=import.meta.glob<{default:FigmaLayer}>('./design/generated/screens/UX*.json');
export default function App(){return new URLSearchParams(location.search).get('design')==='1'?<DesignPreview/>:<Product/>;}
function Product(){
 const start=new URLSearchParams(location.search).get('screen');
 const [state,setState]=useState(()=>initialInteractionState(manifest.files.some(s=>s.uxId===start)?start!:'UX01'));
 const [design,setDesign]=useState<FigmaLayer|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const dispatch=useCallback((action:InteractionAction,ancestors:InteractionHost[])=>{setState(previous=>applyInteraction(previous,action,{routes,targets,sets,ancestors}));},[]);
 useEffect(()=>{let active=true;setError('');setDesign(null);screenModules['./design/generated/screens/'+state.screenId+'.json']().then(m=>{if(active)setDesign(m.default)}).catch(()=>{if(active)setError('界面加载失败，请重试。')});return()=>{active=false};},[state.screenId]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
 const onAction=(action:DesignAction)=>{
  if(action.kind==='navigate'){const dest=manifest.files.find(s=>s.uxId===action.to);if(dest)dispatch({type:'NODE',navigation:'NAVIGATE',destinationId:dest.nodeId},[]);}
  if(action.kind==='notice')setNotice(action.message);if(action.kind==='window'&&window.lingtu)void window.lingtu.windowAction(action.action);
 };
 const auxiliary=Number(state.screenId.slice(2))>=26;
 return <main className={'product-app '+(auxiliary?'product-auxiliary':'')} aria-label="灵兔客服">
  {error?<div role="alert" className="stage-error">{error}<button onClick={()=>location.reload()}>重新加载</button></div>:!design?<div role="status" className="stage-loading">正在加载界面…</div>:<FigmaCanvas design={design} screenId={state.screenId} scale={1} state={state} onInteraction={dispatch} onAction={onAction}/>}
  {state.overlays.map((id,index)=>registry[id]&&<div key={index+':'+id} className="product-overlay" role="dialog" aria-modal="true" aria-label={registry[id].name}><FigmaCanvas design={registry[id]} screenId={state.screenId} scale={1} state={state} onInteraction={dispatch} onAction={onAction}/></div>)}
  {notice&&<div role="status" className="dev-toast">{notice}</div>}
 </main>;
}
