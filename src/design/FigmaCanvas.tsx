import {useEffect} from 'react';
import type {CSSProperties,KeyboardEvent,MouseEvent,ReactNode} from 'react';
import components from './generated/components.json';
import type {FigmaLayer,FigmaRegistry} from './types';
import {rgba,styleOf} from './style';
import {constrainProperties} from './layout.mjs';
import {resolveAction,type DesignAction} from './actions';
import type {InteractionAction,InteractionHost,InteractionState} from './interaction.mjs';
import {BoundControl,BoundText,controlBinding,buttonLabel,isFrontendAction,isFrontendDisabled} from '../features/FrontendControls';
const registry=components as unknown as FigmaRegistry;
const symbolId=(s?:{sessionID:number;localID:number})=>s?s.sessionID+':'+s.localID:'';
type Reaction={trigger:{type:string;timeout?:number};actions:InteractionAction[]};
type Props={screenId:string;design:FigmaLayer;scale:number;viewport?:{width:number;height:number};onAction:(action:DesignAction)=>void;state?:InteractionState;renderLayer?:(layer:FigmaLayer)=>ReactNode|undefined;actionLabel?:(layer:FigmaLayer)=>string|undefined;onInteraction?:(action:InteractionAction,ancestors:InteractionHost[])=>void;onUIAction?:(layer:FigmaLayer,screen:string)=>boolean};
type LayerProps=Props&{layer:FigmaLayer;root?:boolean;names:string[];hosts:InteractionHost[];depth:number;instancePrefix?:string;blockedByButton?:boolean;originalParent?:{x:number;y:number};renderedParent?:{x:number;y:number}};
export default function FigmaCanvas(props:Props){
 const width=props.viewport?.width||props.design.props.size?.x||1440,height=props.viewport?.height||props.design.props.size?.y||900;
 return <div className="canvas-viewport" style={{width:width*props.scale,height:height*props.scale}}><div className="canvas-scaled" style={{width,height,transform:'scale('+props.scale+')'}}><Layer {...props} layer={props.design} root names={[]} hosts={[]} depth={0}/></div><span className="sr-only">{props.screenId} 可编辑Figma图层 {width}×{height}</span></div>;
}
function Layer(props:LayerProps){
 const {layer,root=false,screenId,names,hosts,depth,state,onInteraction,onAction,onUIAction,instancePrefix}=props;
 const runtimeId=instancePrefix?instancePrefix+';'+layer.id:layer.id;
 const shared=state?.variants['@reception'];
 const sharedForInstance=shared&&layer.props.componentId&&registry[String(layer.props.componentId)]?.props.componentSetId===registry[shared]?.props.componentSetId?shared:undefined;
 const selected=state?.variants[runtimeId]||sharedForInstance;const variant=selected?registry[selected]:undefined;const shown=variant||layer;
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
 const geometry=root&&props.viewport?{...layer.props,size:{x:props.viewport.width,y:props.viewport.height}}:constrainProperties(layer.props,props.originalParent,props.renderedParent);
 const base=styleOf({...shown.props,size:geometry.size,transform:geometry.transform,overflow:layer.props.overflow,clipsContent:layer.props.clipsContent},root);
 const definition=!layer.props.expanded&&layer.type==='INSTANCE'?registry[symbolId(layer.props.symbolData?.symbolID)]:undefined;
 const children=variant?.children||definition?.children||layer.children;
 const override=props.renderLayer?.(layer);
 if(override===null)return null;
 if(override!==undefined){const paint=layer.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);const style:CSSProperties=layer.type==='TEXT'?{...base,backgroundColor:'transparent',outline:'none',color:paint?.color?rgba(paint.color,paint.opacity??1):undefined}:base;return <div style={style} data-figma-node={runtimeId} onClick={e=>e.stopPropagation()}>{override}</div>;}
 const businessAction=Boolean(onUIAction&&isFrontendAction(layer));
 const disabled=Boolean(onUIAction&&isFrontendDisabled(layer,screenId));
 const interactive=!props.blockedByButton&&(Boolean(onInteraction&&clickReaction)||Boolean(action)||businessAction);
 const activate=()=>{if(disabled)return;if(window.lingtu?.role==='auxiliary'&&layer.name==='最小化'){onAction({kind:'window',action:'minimize'});return;}if(onUIAction?.(layer,screenId))return;if(onInteraction&&clickReaction){for(const a of clickReaction.actions)onInteraction(a,nextHosts);}else if(action)onAction(action);};
 const onClick=(event:MouseEvent)=>{if(interactive){event.stopPropagation();activate();}};
 const onKeyDown=(event:KeyboardEvent)=>{if(interactive&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();activate();}};
 const binding=onUIAction?controlBinding(layer):undefined;
 if(binding){
  const fieldStyle:CSSProperties={...base};
  if(layer.type==='TEXT'){fieldStyle.height=Math.max(44,(layer.props.lineHeight?.value||layer.props.size?.y||16)+28);fieldStyle.top=Number(fieldStyle.top)-14;fieldStyle.backgroundColor='transparent';fieldStyle.backgroundImage='none';fieldStyle.border=0;if(binding.field==='welcome'&&props.renderedParent)fieldStyle.width=Math.max(Number(fieldStyle.width),props.renderedParent.x-Number(fieldStyle.left)-16);}
  const visibleText=(nodes:FigmaLayer[]):FigmaLayer[]=>nodes.filter(n=>n.props.visible!==false).flatMap(n=>n.type==='TEXT'?[n]:visibleText(n.children));
  const textLayers=layer.type==='TEXT'?[layer]:visibleText(children);const first=textLayers[0];
  const textStyle=first?styleOf(first.props):{};const textPaint=first?.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);
  const lineHeight=layer.type!=='TEXT'&&binding.kind==='textarea'&&textLayers.length>1?Number(textLayers[1].props.transform?.m12)-Number(first.props.transform?.m12):undefined;
  const leading=lineHeight?Math.max(0,(lineHeight-(first?.props.lineHeight?.value||first?.props.fontSize||13))/2):0;
  const inputStyle:CSSProperties={fontFamily:textStyle.fontFamily,fontSize:textStyle.fontSize,fontWeight:textStyle.fontWeight,lineHeight:lineHeight&&lineHeight>0?lineHeight+'px':textStyle.lineHeight,color:textPaint?.color?rgba(textPaint.color,textPaint.opacity??1):undefined,padding:layer.type==='TEXT'?'14px 0':Math.max(0,Number(first?.props.transform?.m12||0)-leading)+'px 8px 0 '+Number(first?.props.transform?.m02||0)+'px'};
  const art=children.length?children.map(c=><Layer {...props} onUIAction={undefined} key={c.id} layer={c} root={false} originalParent={shown.props.size} renderedParent={geometry.size} names={[...names,layer.name]} hosts={nextHosts} depth={depth+1} blockedByButton/>):undefined;
  return <div style={fieldStyle} data-figma-node={runtimeId} className="bound-control" onClick={e=>e.stopPropagation()}><BoundControl binding={binding} screenId={screenId} sourceNodeId={layer.id} inputStyle={inputStyle} onClose={()=>onInteraction?.({type:'CLOSE'},nextHosts)} renderTaskSource={options=><FigmaCanvas design={registry[options.componentId]} screenId="tasks" scale={1} onAction={()=>{}} onInteraction={()=>{}} onUIAction={n=>{options.onAction(buttonLabel(n)||n.name);return true;}} renderLayer={options.renderLayer} actionLabel={n=>n.name==='关闭'?'关闭定时任务':buttonLabel(n)||undefined}/>}>{art}</BoundControl></div>;
 }
 if(layer.type==='TEXT'){
  const paint=shown.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);
  const style:CSSProperties={...base,backgroundColor:'transparent',backgroundImage:'none',border:'none',outline:'none',color:paint?.color?rgba(paint.color,paint.opacity??1):'#23334d',pointerEvents:interactive?'auto':'none',cursor:interactive?'pointer':undefined};
  const text=String(shown.props.text??shown.name);
  return <div style={style} className={'native-text'+(interactive?' native-action':'')} data-figma-node={runtimeId} role={interactive?'button':undefined} tabIndex={interactive?0:undefined} aria-label={interactive?props.actionLabel?.(layer)||(layer.name==='×'?'返回店铺首页':layer.name):undefined} onClick={interactive?onClick:undefined} onKeyDown={interactive?onKeyDown:undefined}>{onUIAction?<BoundText text={text} screenId={screenId}/>:text}</div>;
 }
 const style:CSSProperties={...base};if(layer.type==='ELLIPSE')style.borderRadius='50%';if(interactive)style.cursor=disabled?'not-allowed':'pointer';
 const paths=shown.props.vectorPaths as {data:string;windingRule?:string}[]|undefined;
 const paint=shown.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);const stroke=shown.props.strokePaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);
 let inner;
 if(layer.type==='VECTOR'&&paths?.length){
  Object.assign(style,{background:'none',border:'none',outline:'none',overflow:'visible'});
  inner=<svg width="100%" height="100%" viewBox={'0 0 '+(shown.props.size?.x||1)+' '+(shown.props.size?.y||1)} style={{overflow:'visible',display:'block'}} aria-hidden="true">{paths.map((p,i)=><path key={i} d={p.data} fillRule={p.windingRule==='EVENODD'?'evenodd':'nonzero'} fill={paint?.color?rgba(paint.color,paint.opacity??1):'none'} stroke={stroke?.color?rgba(stroke.color,stroke.opacity??1):undefined} strokeWidth={shown.props.strokeWeight}/>)}</svg>;
 }else{
  const childPrefix=variant?runtimeId:instancePrefix;
  inner=children.map(c=><Layer {...props} key={c.id} layer={c} root={false} originalParent={shown.props.size} renderedParent={geometry.size} names={[...names,layer.name]} hosts={nextHosts} depth={depth+1} instancePrefix={childPrefix} blockedByButton={props.blockedByButton||interactive}/>);
 }
 return <div data-figma-node={runtimeId} data-source-node={layer.id} data-figma-type={layer.type} role={interactive?'button':undefined} tabIndex={interactive&&!disabled?0:undefined} aria-disabled={disabled||undefined} aria-label={interactive?props.actionLabel?.(layer)||((businessAction||screenId==='UX32')&&buttonLabel(layer)?buttonLabel(layer):layer.name):undefined} onClick={interactive?onClick:undefined} onKeyDown={interactive?onKeyDown:undefined} style={style} className={['native-layer',interactive?'native-action':'',root?'native-root':'',/标题栏|顶部 \/ 导航与账户/.test(layer.name)?'native-titlebar':''].join(' ')}>{inner}</div>;
}
