import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const source=process.argv[3];
if(!source)throw Error('Usage: npm run design:prepare -- --current design/snapshots/current.json');
const raw=fs.readFileSync(source,'utf8');
const snapshot=JSON.parse(raw);
if(snapshot.schema!=='lingtu.current-editable-design'||snapshot.pageId!=='2:129')throw Error('Expected current editable design export');
const map=JSON.parse(fs.readFileSync('docs/figma-map.json','utf8'));
const previousAssets=JSON.parse(fs.readFileSync('src/design/generated/assets.json','utf8'));
const hash=createHash('sha256').update(raw).digest('hex');
const assets={};
function paint(p){
 const out={...p,stops:p.gradientStops,gradientHandles:p.gradientHandlePositions};
 if(p.imageRef){assets[p.imageRef]=previousAssets[p.imageRef]||'./figma-assets/'+p.imageRef+'.png';out.imageRef=p.imageRef;}
 out.imageScaleMode=p.scaleMode;
 return out;
}
function overlaps(a,b){return a.x+a.width>=b.x&&a.x<=b.x+b.width&&a.y+a.height>=b.y&&a.y<=b.y+b.height;}
function layer(n,parentBounds,inheritedCrop){
 const g=snapshot.geometry[n.id]||{};
 const box=n.absoluteBoundingBox||{x:0,y:0,width:0,height:0};
 const crop=n.name.startsWith('原型滚动补充')?box:inheritedCrop;
 const m=g.relativeTransform;
 const style=n.style||{};
 return {id:n.id,name:n.name,type:n.type,props:{
  size:{x:g.width??box.width,y:g.height??box.height},
  transform:{m00:m?.[0]?.[0]??1,m01:m?.[0]?.[1]??0,m02:g.x??box.x-(parentBounds?.x??box.x),
   m10:m?.[1]?.[0]??0,m11:m?.[1]?.[1]??1,m12:g.y??box.y-(parentBounds?.y??box.y)},
  visible:n.visible!==false,opacity:n.opacity??1,clipsContent:n.clipsContent,overflow:inheritedCrop?'NONE':g.overflow,
  constraints:n.constraints,layoutMode:g.layoutMode,
  fillPaints:(n.fills||[]).map(paint),strokePaints:(n.strokes||[]).map(paint),strokeWeight:n.strokeWeight,
  strokeAlign:n.strokeAlign,cornerRadius:n.cornerRadius,rectangleTopLeftCornerRadius:n.rectangleCornerRadii?.[0],
  rectangleTopRightCornerRadius:n.rectangleCornerRadii?.[1],rectangleBottomRightCornerRadius:n.rectangleCornerRadii?.[2],
  rectangleBottomLeftCornerRadius:n.rectangleCornerRadii?.[3],effects:n.effects,
  ...(n.type==='TEXT'?{text:n.characters,textAutoResize:style.textAutoResize,fontSize:style.fontSize,fontName:{family:style.fontFamily,style:style.fontPostScriptName},
   fontWeight:style.fontWeight,lineHeight:{value:style.lineHeightPx,units:'PIXELS'},letterSpacing:{value:style.letterSpacing||0,units:'PIXELS'},
   textAlignHorizontal:style.textAlignHorizontal,textAlignVertical:style.textAlignVertical}:{}),
  componentId:n.componentId||g.componentId,componentSetId:g.componentSetId,parentId:g.parentId,expanded:true,interactions:n.interactions||[],vectorPaths:g.vectorPaths
 },children:(n.children||[]).filter(c=>!crop||!c.absoluteBoundingBox||overlaps(c.absoluteBoundingBox,crop)).map(c=>layer(c,box,crop))};
}
const generated='src/design/generated';
fs.mkdirSync(generated+'/screens',{recursive:true});
const documents=snapshot.documents;
const registry=Object.fromEntries(Object.entries(documents).map(([id,n])=>[id,layer(n)]));
const screenIds=new Set(map.screens.map(s=>s.uxId==='UX01'?'8836:4283':s.uxId==='UX03'?'8836:4284':s.figmaNodeId));
const shared=Object.fromEntries(Object.entries(registry).filter(([id])=>!screenIds.has(id)));
fs.writeFileSync(generated+'/components.json',JSON.stringify(shared));
const files=map.screens.map(s=>{
 const id=s.uxId==='UX01'?'8836:4283':s.uxId==='UX03'?'8836:4284':s.figmaNodeId;
 const n=registry[id];if(!n)throw Error('Missing editable source: '+s.uxId+' '+id);
 const expected=Number(s.uxId.slice(2))>=26?300:1440;
 if(n.props.size.x!==expected||n.props.size.y!==900)throw Error('Unexpected viewport '+s.uxId);
 fs.writeFileSync(generated+'/screens/'+s.uxId+'.json',JSON.stringify(n));
 Object.assign(s,{figmaNodeId:id,snapshotHash:hash,status:'current-editable-source-imported',sourceSize:[expected,900],
  sourceName:n.name,visualVerified:false,prototypeStatus:'current-interactions-imported'});
 return {uxId:s.uxId,source:n.name,nodeId:id,width:expected,height:900};
});
const missing=Object.entries(assets).filter(([,url])=>!fs.existsSync(path.join('public',url)));
if(missing.length)throw Error('Missing local assets: '+missing.map(([id])=>id).join(','));
fs.writeFileSync(generated+'/assets.json',JSON.stringify(assets));
fs.writeFileSync(generated+'/manifest.json',JSON.stringify({hash,fileKey:snapshot.fileKey,pageId:snapshot.pageId,exportedAt:snapshot.exportedAt,files}));
Object.assign(map,{version:4,designSource:'Figma local PluginAPI JSON_REST_V1 / current editable canvas',fileKey:snapshot.fileKey,
 baseViewport:{width:1440,height:900},auxiliaryViewport:{width:300,height:900},sourceSnapshotHash:hash});
fs.writeFileSync('docs/figma-map.json',JSON.stringify(map,null,2)+'\n');
console.log('Prepared '+files.length+' current editable sources, '+Object.keys(shared).length+' shared component definitions, '+Object.keys(assets).length+' local image references');
