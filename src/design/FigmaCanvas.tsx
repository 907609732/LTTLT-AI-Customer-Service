import {useEffect} from 'react';
import type {CSSProperties,KeyboardEvent,MouseEvent} from 'react';
import components from './generated/components.json';
import type {FigmaLayer,FigmaRegistry} from './types';
import {rgba,styleOf} from './style';
import {resolveAction,type DesignAction} from './actions';
import type {InteractionAction,InteractionHost,InteractionState} from './interaction.mjs';
import {BoundControl,BoundText,controlBinding,buttonLabel,isFrontendAction} from '../features/FrontendControls';
const registry=components as unknown as FigmaRegistry;
const symbolId=(s?:{sessionID:number;localID:number})=>s?s.sessionID+':'+s.localID:'';
type Reaction={trigger:{type:string;timeout?:number};actions:InteractionAction[]};
type Props={screenId:string;design:FigmaLayer;scale:number;onAction:(action:DesignAction)=>void;state?:InteractionState;onInteraction?:(action:InteractionAction,ancestors:InteractionHost[])=>void;onUIAction?:(layer:FigmaLayer,screen:string)=>boolean};
type LayerProps=Props&{layer:FigmaLayer;root?:boolean;names:string[];hosts:InteractionHost[];depth:number;instancePrefix?:string;blockedByButton?:boolean};
export default function FigmaCanvas(props:Props){
 const width=props.design.props.size?.x||1440,height=props.design.props.size?.y||900;
 return <div className="canvas-viewport" style={{width:width*props.scale,height:height*props.scale}}><div className="canvas-scaled" style={{width,height,transform:'scale('+props.scale+')'}}><Layer {...props} layer={props.design} root names={[]} hosts={[]} depth={0}/></div><span className="sr-only">{props.screenId} 可编辑Figma图层 {width}×{height}</span></div>;
}
function Layer(props:LayerProps){
 const {layer,root=false,screenId,names,hosts,depth,state,onInteraction,onAction,onUIAction,instancePrefix}=props;
 const runtimeId=instancePrefix?instancePrefix+';'+layer.id:layer.id;
 const selected=state?.variants[runtimeId];const variant=selected?registry[selected]:undefined;const shown=variant||layer;
 const currentComponentId=variant?.id||String(layer.props.componentId||'');
 const nextHosts=layer.type==='INSTANCE'?[...hosts,{id:runtimeId,componentId:currentComponentId}]:hosts;
 const reactions=(shown.props.interactions||[]) as Reaction[];
 const clickReaction=reactions.find(r=>r.trigger?.type==='ON_CLICK');const timeoutReaction=reactions.find(r=>r.trigger?.type==='AFTER_TIMEOUT');
 const action=resolveAction(layer,screenId,names);
 useEffect(()=>{
  if(!timeoutReaction||!onInteraction)return;
  const timer=setTimeout(()=>{for(const a of timeoutReaction.actions)onInteraction(a,nextHosts);},(timeoutReaction.trigger.timeout||0)*1000);
  return()=>clearTimeout(timer);
 },[selected,layer.id,Boolean(onInteraction)]);
 if(layer.props.visible===false||depth>55)return null;
 const base=styleOf({...shown.props,size:layer.props.size,transform:layer.props.transform},root);
 const definition=!layer.props.expanded&&layer.type==='INSTANCE'?registry[symbolId(layer.props.symbolData?.symbolID)]:undefined;
 const children=variant?.children||definition?.children||layer.children;
 const businessAction=Boolean(onUIAction&&isFrontendAction(layer));
 const interactive=!props.blockedByButton&&(Boolean(onInteraction&&clickReaction)||Boolean(action)||businessAction);
 const activate=()=>{if(onUIAction?.(layer,screenId))return;if(onInteraction&&clickReaction){for(const a of clickReaction.actions)onInteraction(a,nextHosts);}else if(action)onAction(action);};
 const onClick=(event:MouseEvent)=>{if(interactive){event.stopPropagation();activate();}};
 const onKeyDown=(event:KeyboardEvent)=>{if(interactive&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();activate();}};
 const binding=onUIAction?controlBinding(layer):undefined;
 if(binding){
  const fieldStyle:CSSProperties={...base};
  if(layer.type==='TEXT'){fieldStyle.height=44;fieldStyle.top=Number(fieldStyle.top)-14;fieldStyle.backgroundColor='transparent';fieldStyle.backgroundImage='none';fieldStyle.border=0;}
  return <div style={fieldStyle} data-figma-node={runtimeId} className="bound-control" onClick={e=>e.stopPropagation()}><BoundControl binding={binding} screenId={screenId} onClose={()=>onInteraction?.({type:'CLOSE'},nextHosts)}/></div>;
 }
 if(layer.type==='TEXT'){
  const paint=shown.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);
  const style:CSSProperties={...base,backgroundColor:'transparent',backgroundImage:'none',border:'none',color:paint?.color?rgba(paint.color,paint.opacity??1):'#23334d',pointerEvents:'none'};
  const text=String(shown.props.text??shown.name);
  return <div style={style} className="native-text" data-figma-node={runtimeId}>{onUIAction?<BoundText text={text} screenId={screenId}/>:text}</div>;
 }
 const style:CSSProperties={...base};if(layer.type==='ELLIPSE')style.borderRadius='50%';if(interactive)style.cursor='pointer';
 const paths=shown.props.vectorPaths as {data:string;windingRule?:string}[]|undefined;
 const paint=shown.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);const stroke=shown.props.strokePaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);
 let inner;
 if(layer.type==='VECTOR'&&paths?.length){
  Object.assign(style,{background:'none',border:'none',overflow:'visible'});
  inner=<svg width="100%" height="100%" viewBox={'0 0 '+(shown.props.size?.x||1)+' '+(shown.props.size?.y||1)} style={{overflow:'visible',display:'block'}} aria-hidden="true">{paths.map((p,i)=><path key={i} d={p.data} fillRule={p.windingRule==='EVENODD'?'evenodd':'nonzero'} fill={paint?.color?rgba(paint.color,paint.opacity??1):'none'} stroke={stroke?.color?rgba(stroke.color,stroke.opacity??1):undefined} strokeWidth={shown.props.strokeWeight}/>)}</svg>;
 }else{
  const childPrefix=variant?runtimeId:instancePrefix;
  inner=children.map(c=><Layer {...props} key={c.id} layer={c} root={false} names={[...names,layer.name]} hosts={nextHosts} depth={depth+1} instancePrefix={childPrefix} blockedByButton={props.blockedByButton||interactive}/>);
 }
 return <div data-figma-node={runtimeId} data-source-node={layer.id} data-figma-type={layer.type} role={interactive?'button':undefined} tabIndex={interactive?0:undefined} aria-label={interactive?businessAction?buttonLabel(layer):layer.name:undefined} onClick={interactive?onClick:undefined} onKeyDown={interactive?onKeyDown:undefined} style={style} className={['native-layer',interactive?'native-action':'',root?'native-root':''].join(' ')}>{inner}</div>;
}
