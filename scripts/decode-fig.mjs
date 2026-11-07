import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {parseFig,nodeId} from 'openfig-core';

/** Read a locally exported, editable Figma file. No Figma API or MCP calls. */
const input=process.argv[2];
if(!input)throw new Error('Usage: npm run design:decode -- "C:\\path\\editable.fig"');
const sourcePath=resolve(input);
if(!sourcePath.toLowerCase().endsWith('.fig'))throw new Error('Only local .fig files are supported');
if(statSync(sourcePath).size>300*1024*1024)throw new Error('File exceeds 300 MB safety limit');
const bytes=new Uint8Array(readFileSync(sourcePath));
const hash=createHash('sha256').update(bytes).digest('hex').slice(0,16);
const doc=parseFig(bytes);
if(doc.header?.prelude!=='fig-kiwi')throw new Error('Not a fig-kiwi Figma file');
const pageId='2:129';
const page=doc.nodeMap.get(pageId);
if(page?.type!=='CANVAS')throw new Error('Expected editable page 2:129 not found; inspect the source before proceeding');

const definitions=[
 ['UX01','11:2'],['UX02','2:134'],['UX03','17:16'],['UX04','2:140'],
 ['UX05','2:141'],['UX06','2:142'],['UX07','2:135'],['UX08','2:143'],
 ['UX09','2:144'],['UX10','2:145'],['UX11','2:146'],['UX12','2:162'],
 ['UX13','2:163'],['UX14','2:164'],['UX15','2:165'],['UX16','2:166'],
 ['UX17','2:167'],['UX18','2:168'],['UX19','2:169'],['UX20','2:170'],
 ['UX21','2:171'],['UX22','2:172'],['UX23','2:173'],['UX24','2:174'],
 ['UX25','2:175'],['UX26','2:177'],['UX27','2:178'],['UX28','2:179'],
 ['UX29','2:180'],['UX30','2:181'],['UX31','2:182'],['UX32','2:183']
];
const retained=[
 'size','transform','opacity','visible','cornerRadius','rectangleTopLeftCornerRadius',
 'rectangleTopRightCornerRadius','rectangleBottomLeftCornerRadius','rectangleBottomRightCornerRadius',
 'fillPaints','strokePaints','strokeWeight','strokeAlign','effects','blendMode','clipsContent',
 'fontSize','fontName','lineHeight','letterSpacing','textAlignHorizontal','textAlignVertical',
 'textAutoResize','textCase','textDecoration','frameMaskDisabled','textTracking','symbolID',
 'symbolId','symbolData','symbolOverrides','symbolOverrideData','stackMode','stackSpacing',
 'stackPadding','stackPrimaryAlignItems','stackCounterAlignItems','stackWrap',
 'layoutMode','layoutGrow','layoutAlign','constraints','backgroundColor','imageHash'
];
function propsOf(n){
 const o={};
 for(const k of retained)if(n[k]!==undefined)o[k]=n[k];
 if(n.textData?.characters!==undefined)o.text=n.textData.characters;
 for(const k of Object.keys(n)){
   if(/^(stack|layout|constraint|grid|overflow|padding|font|textStyle|override)/i.test(k) && !(k in o)){
     const s=JSON.stringify(n[k]);
     if(s&&s.length<5000)o[k]=n[k];
   }
 }
 return o;
}
function tree(n,depth=0){
 if(depth>50)throw new Error('Unexpectedly deep nesting');
 const id=nodeId(n);
 return {id,name:n.name||'',type:n.type,props:propsOf(n),
  children:(doc.childrenMap.get(id)||[]).map(child=>tree(child,depth+1))};
}
const folder=resolve('design/snapshots',hash);
mkdirSync(join(folder,'screens'),{recursive:true});
mkdirSync(join(folder,'images'),{recursive:true});
const rows=[];
for(const [uxId,id] of definitions){
 const n=doc.nodeMap.get(id);
 if(!n || !['FRAME','SYMBOL'].includes(n.type))throw new Error('Missing editable root '+uxId+': '+id);
 const serialized=tree(n);
 writeFileSync(join(folder,'screens',uxId+'.json'),JSON.stringify(serialized,null,2),'utf8');
 rows.push({uxId,figmaNodeId:id,name:n.name,type:n.type,width:n.size?.x||0,height:n.size?.y||0,
  directChildren:doc.childrenMap.get(id)?.length||0,sourceSnapshotHash:hash,visualVerified:false});
}
const symbols=doc.nodes.filter(n=>n.type==='SYMBOL');
const registry=symbols.map(n=>({id:nodeId(n),name:n.name,width:n.size?.x||0,height:n.size?.y||0,
 children:doc.childrenMap.get(nodeId(n))?.length||0,screenRoot:rows.some(row=>row.figmaNodeId===nodeId(n))}));
writeFileSync(join(folder,'component-registry.json'),JSON.stringify(registry,null,2),'utf8');
const common=symbols.filter(n=>!rows.some(row=>row.figmaNodeId===nodeId(n)));
mkdirSync(join(folder,'components'),{recursive:true});
for(const n of common){
 const id=nodeId(n);
 writeFileSync(join(folder,'components',id.replace(':','_')+'.json'),JSON.stringify(tree(n),null,2),'utf8');
}
let imagesWritten=0;
for(const [name,data] of doc.images||[]){
 if(!/^[a-f0-9]{40}$/i.test(name))continue;
 const png=data[0]===0x89&&data[1]===0x50;
 const jpeg=data[0]===0xff&&data[1]===0xd8;
 const webp=String.fromCharCode(...data.slice(0,4))==='RIFF';
 const suffix=png?'.png':jpeg?'.jpg':webp?'.webp':'.bin';
 writeFileSync(join(folder,'images',name+suffix),Buffer.from(data));
 imagesWritten++;
}
let map={screens:[]};
try{map=JSON.parse(readFileSync(resolve('docs/figma-map.json'),'utf8'));}catch{}
map.version=3;
map.designSource='offline fig-kiwi / openfig-core; editable Figma page "我们的设计方案"';
map.sourceFile=basename(sourcePath);
map.sourceSnapshotHash=hash;
map.editableCanvasId=pageId;
map.visualVerified=false;
map.screens=map.screens.map(screen=>{
 const source=rows.find(row=>row.uxId===screen.uxId);
 return {...screen,figmaNodeId:source?.figmaNodeId??null,snapshotHash:hash,
  sourceName:source?.name??null,sourceNodeType:source?.type??null,
  sourceSize:source?[source.width,source.height]:null,
  prototypeStatus:screen.prototypeStatus||'legacy-prototype',
  status:'editable-source-extracted',visualVerified:false};
});
writeFileSync(resolve('docs/figma-map.json'),JSON.stringify(map,null,2)+'\n','utf8');
const report={hash,sourceName:basename(sourcePath),header:doc.header,nodeCount:doc.nodes.length,
 pageName:page.name,editableCanvasId:pageId,pageDirectChildren:doc.childrenMap.get(pageId)?.length,
 componentDefinitions:symbols.length,sharedComponents:common.length,
 sourceImages:imagesWritten,screens:rows,components:registry.filter(n=>!n.screenRoot)};
writeFileSync(join(folder,'inventory.json'),JSON.stringify(report,null,2),'utf8');
writeFileSync(resolve('docs/figma-component-registry.json'),JSON.stringify({hash,page:page.name,
 components:registry},null,2)+'\n','utf8');
console.log('PARSED '+basename(sourcePath)+' hash='+hash+' nodes='+doc.nodes.length+
 ' UX='+rows.length+' symbolDefinitions='+symbols.length+' reusableSymbols='+common.length+
 ' images='+imagesWritten);
console.log('PRIVATE_SNAPSHOTS '+folder);
console.log('TRACKED_INDEX docs/figma-map.json docs/figma-component-registry.json');
