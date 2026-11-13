'use strict';
const {isIP}=require('node:net');
function invalid(){return Object.assign(Error('图片输入格式或地址不受支持'),{code:'vision_invalid_input'});}
function publicImageUrl(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>2048||raw!==raw.trim()||!raw.startsWith('https://'))throw invalid();
 let url;try{url=new URL(raw);}catch{throw invalid();}
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||isIP(host)||!host.includes('.')||host.endsWith('.')||/(^|\.)(localhost|local|internal|lan|home|invalid)$/.test(host))throw invalid();
 return raw;
}
function validateMessages(messages){
 if(!Array.isArray(messages)||!messages.length||messages.length>64)throw invalid();let images=0;
 const out=messages.map(m=>{
  if(!m||!['system','user','assistant'].includes(m.role))throw invalid();
  if(typeof m.content==='string'){if(!m.content||Buffer.byteLength(m.content)>32768)throw invalid();return {role:m.role,content:m.content};}
  if(m.role!=='user'||!Array.isArray(m.content)||!m.content.length||m.content.length>8)throw invalid();
  const content=m.content.map(p=>{
   if(!p||typeof p!=='object'||Object.keys(p).length!==2)throw invalid();
   if(p.type==='text'&&typeof p.text==='string'&&p.text.length&&Buffer.byteLength(p.text)<=32768)return {type:'text',text:p.text};
   if(p.type==='image_url'&&p.image_url&&Object.keys(p.image_url).length===1&&++images<=4)return {type:'image_url',image_url:{url:publicImageUrl(p.image_url.url)}};
   throw invalid();
  });return {role:m.role,content};
 });
 if(Buffer.byteLength(JSON.stringify(out))>128*1024-512)throw invalid();return out;
}
function imageInputs(thread){const list=Array.isArray(thread)?thread:[];let start=0;list.forEach((m,i)=>{if(m?.from==='seller')start=i+1;});const images=list.slice(start).filter(m=>m?.from==='buyer'&&m.type==='image');if(images.length>4)throw invalid();return images.map(m=>publicImageUrl(m.content));}
module.exports={publicImageUrl,validateMessages,imageInputs};

