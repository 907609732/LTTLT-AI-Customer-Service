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
// Compatibility input for main-process knowledge tiles; buyer messages still use publicImageUrl.
function modelImageInput(raw){
 if(typeof raw!=='string'||!raw.startsWith('data:image/png;base64,'))return publicImageUrl(raw);
 const encoded=raw.slice(22);if(encoded.length>12*1024*1024||!encoded.length||encoded.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw invalid();
 const bytes=Buffer.from(encoded,'base64');if(bytes.length<33||bytes.length>8*1024*1024||bytes.toString('base64')!==encoded||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw invalid();
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>1400||height>1400)throw invalid();return raw;
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
   if(p.type==='image_url'&&p.image_url&&Object.keys(p.image_url).length===1&&++images<=4)return {type:'image_url',image_url:{url:modelImageInput(p.image_url.url)}};
   throw invalid();
  });return {role:m.role,content};
 });
 const textOnly=out.map(m=>typeof m.content==='string'?m:{...m,content:m.content.map(p=>p.type==='image_url'?{type:'image_url',image_url:{url:''}}:p)});
 if(Buffer.byteLength(JSON.stringify(textOnly))>128*1024-512||Buffer.byteLength(JSON.stringify(out))>16*1024*1024-512)throw invalid();return out;
}
function imageInputs(thread){const list=Array.isArray(thread)?thread:[];let start=0;list.forEach((m,i)=>{if(m?.from==='seller')start=i+1;});const images=list.slice(start).filter(m=>m?.from==='buyer'&&m.type==='image');if(images.length>4)throw invalid();return images.map(m=>publicImageUrl(m.content));}
module.exports={publicImageUrl,validateMessages,imageInputs};

