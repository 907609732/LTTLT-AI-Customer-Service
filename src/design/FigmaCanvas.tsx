import {useMemo} from 'react';
import type {CSSProperties,KeyboardEvent,MouseEvent} from 'react';
import components from './generated/components.json';
import type {FigmaLayer,FigmaRegistry} from './types';
import {rgba,styleOf} from './style';
import {resolveAction,type DesignAction} from './actions';
const registry=components as unknown as FigmaRegistry;
const symbolId=(s?:{sessionID:number;localID:number})=>s?s.sessionID+':'+s.localID:'';
type Props={screenId:string;design:FigmaLayer;scale:number;onAction:(action:DesignAction)=>void};
export default function FigmaCanvas({screenId,design,scale,onAction}:Props){
 const width=design.props.size?.x||1440;
 const height=design.props.size?.y||900;
 const available=useMemo(()=>({width,height}),[width,height]);
 return <div className="canvas-viewport" style={{width:width*scale,height:height*scale}}>
   <div className="canvas-scaled" style={{width,height,transform:'scale('+scale+')'}}>
     <Layer layer={design} root screenId={screenId} ancestors={[]} onAction={onAction} depth={0}/>
   </div>
   <span className="sr-only">{screenId} 可编辑 Figma 画板 {available.width}×{available.height}</span>
 </div>;
}
function Layer({layer,root=false,screenId,ancestors,onAction,depth}:{
 layer:FigmaLayer;root?:boolean;screenId:string;ancestors:string[];onAction:(a:DesignAction)=>void;depth:number;
}){
 if(layer.props.visible===false || depth>40)return null;
 const base=styleOf(layer.props,root);
 const action=resolveAction(layer,screenId,ancestors);
 let children=layer.children;
 const ref=layer.props.symbolData?.symbolID;
 const definition=layer.type==='INSTANCE'?registry[symbolId(ref)]:undefined;
 if(definition&&definition.id!==layer.id)children=definition.children;
 const onClick=(event:MouseEvent<HTMLDivElement>)=>{if(!action)return;event.stopPropagation();onAction(action)};
 const onKeyDown=(event:KeyboardEvent<HTMLDivElement>)=>{if(!action)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onAction(action);}};
 if(layer.type==='TEXT'){
  const paint=layer.props.fillPaints?.find(p=>p.visible!==false&&p.type==='SOLID'&&p.color);
  const style:CSSProperties={...base,backgroundColor:'transparent',backgroundImage:'none',border:'none',
   color:paint?.color?rgba(paint.color,paint.opacity??1):'#23334d',pointerEvents:'none'};
  return <div style={style} className="native-text" data-figma-node={layer.id}>{layer.props.text??layer.name}</div>;
 }
 const style:CSSProperties={...base};
 if(layer.type==='ELLIPSE')style.borderRadius='50%';
 if(action)style.cursor='pointer';
 if(layer.type==='VECTOR'&&!layer.props.fillPaints?.length && !layer.props.strokePaints?.length)style.background='none';
 const className=['native-layer',layer.type==='INSTANCE'?'native-instance':'',action?'native-action':'',root?'native-root':''].filter(Boolean).join(' ');
 const inner=definition&&definition.props.size?.x&&definition.props.size?.y?
  <div style={{position:'absolute',top:0,left:0,width:definition.props.size.x,height:definition.props.size.y,
    transform:'scale('+(Number(layer.props.size?.x||0)/definition.props.size.x||1)+','+(Number(layer.props.size?.y||0)/definition.props.size.y||1)+')',transformOrigin:'top left'}}>
    {children.map(c=><Layer key={c.id} layer={c} screenId={screenId} ancestors={[...ancestors,layer.name]} onAction={onAction} depth={depth+1}/>)}
  </div>:
  children.map(c=><Layer key={c.id} layer={c} screenId={screenId} ancestors={[...ancestors,layer.name]} onAction={onAction} depth={depth+1}/>);
 return <div data-figma-node={layer.id} data-figma-type={layer.type} title={action?layer.name:undefined}
  role={action?'button':undefined} tabIndex={action?0:undefined}
  aria-label={action?layer.name:undefined}
  onClick={action?onClick:undefined} onKeyDown={action?onKeyDown:undefined}
  style={style} className={className}>{inner}</div>;
}
