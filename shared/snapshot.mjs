/** Bounded data-only handoff: no imported code is executed. */
export const MAX_SNAPSHOT_BYTES=20*1024*1024;
export function parseSnapshot(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_SNAPSHOT_BYTES)throw new Error('快照不得超过 20 MB');
 let data;try{data=JSON.parse(text);}catch{throw new Error('不是有效的 JSON 文件');}
 if(!data||data.schema!=='lingtu.design-snapshot'||data.version!==1)throw new Error('需要灵兔本地设计快照 v1，不支持直接导入 .fig');
 if(!Array.isArray(data.nodes)||data.nodes.length<1||data.nodes.length>20)throw new Error('每个快照需要 1–20 个画板');
 const ids=new Set();
 const nodes=data.nodes.map(n=>{
  if(!n||typeof n.id!=='string'||!/^[\w:;-]{1,160}$/.test(n.id)||typeof n.name!=='string'||n.name.length>300)throw new Error('画板 ID 或名称无效');
  if(ids.has(n.id))throw new Error('快照包含重复的画板 ID');ids.add(n.id);
  if(!Number.isFinite(n.width)||!Number.isFinite(n.height)||n.width<=0||n.height<=0||n.width>50000||n.height>50000)throw new Error('画板尺寸超出范围');
  if(n.preview&&(typeof n.preview!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(n.preview)))throw new Error('预览仅允许内嵌 PNG');
  if(n.document!=null&&(typeof n.document!=='object'||Array.isArray(n.document)))throw new Error('图层结构无效');
  return {id:n.id,name:n.name,width:n.width,height:n.height,preview:n.preview||'',document:n.document||{},warning:typeof n.warning==='string'?n.warning:''};
 });
 return {schema:'lingtu.design-snapshot',version:1,fileName:typeof data.fileName==='string'?data.fileName.slice(0,300):'未命名文件',pageName:typeof data.pageName==='string'?data.pageName.slice(0,300):'',exportedAt:typeof data.exportedAt==='string'?data.exportedAt:'',nodes};
}
