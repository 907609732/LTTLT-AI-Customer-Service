import type {CSSProperties} from 'react';
import type {FigmaRGB,FigmaPaint,FigmaProperties} from './types';
import assets from './generated/assets.json';
const imageAssets=assets as Record<string,string>;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const rgba=(c:FigmaRGB,opacity=1)=>'rgba('+[c.r,c.g,c.b].map(n=>Math.round(clamp(n)*255)).join(',')+','+clamp((c.a??1)*opacity).toFixed(3)+')';
function assetUrl(hash?:Record<string,number>){
 if(!hash)return null;
 const key=Object.entries(hash).sort((a,b)=>Number(a[0])-Number(b[0])).map(([,v])=>Number(v).toString(16).padStart(2,'0')).join('');
 return imageAssets[key]||null;
}
function paintStyle(paint:FigmaPaint):CSSProperties{
 if(paint.type==='SOLID'&&paint.color)return{backgroundColor:rgba(paint.color,paint.opacity??1)};
 if(paint.type==='GRADIENT_LINEAR'&&paint.stops?.length){
  const angle=paint.transform?.m00===0&&paint.transform?.m01===1?'90deg':'130deg';
  const stops=paint.stops.map(s=>rgba(s.color,paint.opacity??1)+' '+Math.round(s.position*100)+'%').join(', ');
  return{backgroundImage:'linear-gradient('+angle+', '+stops+')'};
 }
 if(paint.type==='GRADIENT_RADIAL'&&paint.stops?.length){
  const stops=paint.stops.map(s=>rgba(s.color,paint.opacity??1)+' '+Math.round(s.position*100)+'%').join(', ');
  return{backgroundImage:'radial-gradient(circle, '+stops+')'};
 }
 if(paint.type==='IMAGE'){
  const url=assetUrl(paint.image?.hash);
  if(url)return {backgroundImage:'url("'+url+'")',backgroundRepeat:'no-repeat',
   backgroundPosition:'center',backgroundSize:paint.imageScaleMode==='FIT'?'contain':'cover'};
 }
 return {};
}
function firstPaint(paints?:FigmaPaint[]){return [...(paints||[])].reverse().find(p=>p.visible!==false);}
function radius(p:FigmaProperties){
 const a=p.rectangleTopLeftCornerRadius??p.cornerRadius??0;
 const b=p.rectangleTopRightCornerRadius??p.cornerRadius??0;
 const c=p.rectangleBottomRightCornerRadius??p.cornerRadius??0;
 const d=p.rectangleBottomLeftCornerRadius??p.cornerRadius??0;
 return [a,b,c,d].map(n=>Math.max(0,n||0)+'px').join(' ');
}
export function styleOf(p:FigmaProperties,root=false):CSSProperties{
 const s:CSSProperties={
  position:root?'relative':'absolute',
  left:root?0:(p.transform?.m02??0),
  top:root?0:(p.transform?.m12??0),
  width:p.size?.x??0,
  height:p.size?.y??0,
  boxSizing:'border-box',
  opacity:p.opacity??1,
  borderRadius:radius(p),
 };
 const fill=firstPaint(p.fillPaints);if(fill)Object.assign(s,paintStyle(fill));
 const stroke=firstPaint(p.strokePaints);
 if(stroke?.color)s.border=(p.strokeWeight??1)+'px solid '+rgba(stroke.color,stroke.opacity??1);
 if(p.clipsContent===true)s.overflow='hidden';
 const effects=Array.isArray(p.effects)?p.effects as {type:string;radius?:number;offset?:{x:number;y:number};color?:FigmaRGB;visible?:boolean;spread?:number}[]:[];
 const blur=effects.find(effect=>effect.visible!==false&&effect.type==='FOREGROUND_BLUR');
 if(blur?.radius)s.filter='blur('+blur.radius+'px)';
 const shadows=effects.filter(effect=>effect.visible!==false&&(effect.type==='DROP_SHADOW'||effect.type==='INNER_SHADOW'));
 if(shadows.length)s.boxShadow=shadows.map(effect=>(effect.type==='INNER_SHADOW'?'inset ':'')+(effect.offset?.x||0)+'px '+(effect.offset?.y||0)+'px '+(effect.radius||0)+'px '+(effect.spread||0)+'px '+rgba(effect.color||{r:0,g:0,b:0,a:.15})).join(',');
 if(p.fontSize){s.fontFamily='"'+(p.fontName?.family||'Noto Sans SC')+'","Microsoft YaHei",sans-serif';s.fontSize=p.fontSize;
  const fs=(p.fontName?.style||'').toLowerCase();
  s.fontWeight=fs.includes('black')?900:fs.includes('bold')?700:fs.includes('semibold')?600:fs.includes('medium')?500:400;
  s.lineHeight=p.lineHeight?.units==='PIXELS'?(p.lineHeight.value+'px'):'normal';
  if(p.letterSpacing?.units==='PIXELS')s.letterSpacing=p.letterSpacing.value+'px';
  s.whiteSpace='pre-wrap';s.overflowWrap='anywhere';s.display='flex';
  s.alignItems=p.textAlignVertical==='CENTER'?'center':p.textAlignVertical==='BOTTOM'?'flex-end':'flex-start';
  s.justifyContent=p.textAlignHorizontal==='CENTER'?'center':p.textAlignHorizontal==='RIGHT'?'flex-end':'flex-start';
 }
 return s;
}
