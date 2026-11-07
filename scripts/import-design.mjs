import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseSnapshot,MAX_SNAPSHOT_BYTES} from '../shared/snapshot.mjs';
const normalize = value => String(value||'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
function matchScreen(node,screens){
 const names=[node.name,...(node.path||[]).map(item=>item.name)];
 for(const name of names){const m=String(name).match(/UX[\s_-]?(\d{1,2})/i);if(m){const id='UX'+m[1].padStart(2,'0');const screen=screens.find(x=>x.uxId===id);if(screen)return screen;}}
 for(const screen of screens){const target=normalize(screen.title);if(target&&names.some(name=>normalize(name)===target))return screen;}
 return null;
}
try{
 if(!process.argv[2])throw new Error('用法: npm run design:import -- "设计快照.json"');
 const source=resolve(process.argv[2]);
 if((await stat(source)).size>MAX_SNAPSHOT_BYTES)throw new Error('快照不得超过 20 MB');
 const raw=await readFile(source,'utf8');
 const data=parseSnapshot(raw);
 const hash=createHash('sha256').update(raw).digest('hex').slice(0,12);
 const folder=resolve('design/snapshots',hash);
 await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'snapshot.json'),JSON.stringify(data,null,2));
 let screenMap={screens:[]};
 try{const rawMap=await readFile(resolve('docs/figma-map.json'),'utf8');const mapText=rawMap.charCodeAt(0)===0xFEFF?rawMap.slice(1):rawMap;screenMap=JSON.parse(mapText);}catch{}
 const index=[];
 for(const [i,node] of data.nodes.entries()){
  const prefix=String(i+1).padStart(2,'0')+'-'+node.id.replace(/[^\w-]/g,'_');
  await writeFile(join(folder,prefix+'.json'),JSON.stringify(node,null,2));
  await writeFile(join(folder,prefix+'.document.json'),JSON.stringify(node.document,null,2));
  if(Object.keys(node.components).length)await writeFile(join(folder,prefix+'.components.json'),JSON.stringify(node.components,null,2));
  if(Object.keys(node.styles).length)await writeFile(join(folder,prefix+'.styles.json'),JSON.stringify(node.styles,null,2));
  if(node.preview)await writeFile(join(folder,prefix+'.png'),Buffer.from(node.preview.split(',')[1],'base64'));
  const screen=matchScreen(node,screenMap.screens||[]);
  const document=node.document||{};
  index.push({
   id:node.id,name:node.name,type:node.type,width:node.width,height:node.height,
   pageName:data.pageName,path:node.path,uxId:screen?.uxId||null,uxTitle:screen?.title||null,
   directLayerCount:Array.isArray(document.children)?document.children.length:0,
   componentCount:Object.keys(node.components).length,styleCount:Object.keys(node.styles).length,
   structure:prefix+'.document.json',metadata:prefix+'.json',
   components:Object.keys(node.components).length?prefix+'.components.json':null,
   styles:Object.keys(node.styles).length?prefix+'.styles.json':null,
   preview:node.preview?prefix+'.png':null
  });
 }
 await writeFile(join(folder,'index.json'),JSON.stringify(index,null,2));
 const generatedMap={
  sourceSnapshot:hash,fileName:data.fileName,pageName:data.pageName,
  screens:(screenMap.screens||[]).map(screen=>{
   const found=index.find(node=>node.uxId===screen.uxId);
   return {...screen,figmaNodeId:found?.id||null,snapshotHash:found?hash:null,status:found?'editable-frame-imported':'awaiting-editable-frame'};
  })
 };
 await writeFile(join(folder,'figma-map.generated.json'),JSON.stringify(generatedMap,null,2));
 const mapped=index.filter(x=>x.uxId).length;
 console.log('已导入 '+index.length+' 个可编辑画板 → '+folder);
 console.log('已自动匹配 UX 编号：'+mapped+'/'+index.length+'；未匹配画板：'+(index.length-mapped));
 console.log('每个画板已保存完整图层 JSON、组件/样式引用和可选 PNG。原始快照默认不提交 Git。');
}catch(error){console.error(error.message);process.exitCode=1;}
