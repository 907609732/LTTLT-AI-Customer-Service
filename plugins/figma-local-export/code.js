/* Read-only plugin: no fetch, tokens, cloud services or document writes. */
figma.showUI(__html__,{width:420,height:460,themeColors:true});
let busy=false;
function selectionStatus(){figma.ui.postMessage({type:'selection',items:figma.currentPage.selection.map(n=>({id:n.id,name:n.name,type:n.type}))});}
figma.on('selectionchange',selectionStatus);selectionStatus();
figma.ui.onmessage=async function(message){
 if(!message||message.type!=='export'||busy)return;busy=true;
 try{
  const nodes=figma.currentPage.selection.slice();
  if(nodes.length<1||nodes.length>20)throw new Error('请选中 1–20 个正式画板，建议一次导出一个页面。');
  if(nodes.some(n=>!['FRAME','COMPONENT','INSTANCE','COMPONENT_SET','GROUP'].includes(n.type)))throw new Error('请选择画板、组件、实例或组，不要只选文本。');
  const result={schema:'lingtu.design-snapshot',version:1,fileName:figma.root.name,pageName:figma.currentPage.name,exportedAt:new Date().toISOString(),nodes:[]};
  for(let i=0;i<nodes.length;i++){
   const n=nodes[i];figma.ui.postMessage({type:'progress',text:'正在导出 '+(i+1)+' / '+nodes.length+'：'+n.name});
   const data=await n.exportAsync({format:'JSON_REST_V1'});let preview='';let warning='';
   if(message.includePreview!==false){try{const scale=Math.min(1,1920/Math.max(n.width,1),1920/Math.max(n.height,1));const png=await n.exportAsync({format:'PNG',constraint:{type:'SCALE',value:scale}});preview='data:image/png;base64,'+figma.base64Encode(png);}catch(e){warning='PNG 预览导出失败：'+String(e);}}
   result.nodes.push({id:n.id,name:n.name,width:n.width,height:n.height,document:data.document||data,preview:preview,warning:warning});
  }
  figma.ui.postMessage({type:'result',snapshot:result});
 }catch(error){figma.ui.postMessage({type:'error',text:String(error.message||error)});}finally{busy=false;}
};
