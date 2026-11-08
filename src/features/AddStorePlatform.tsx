import {useState} from 'react';
import type {FormEvent} from 'react';
import FigmaCanvas from '../design/FigmaCanvas';
import source from '../design/generated/screens/UX03.json';
import type {FigmaLayer} from '../design/types';
import {useBackend} from './BackendProvider';
const popup=(source as unknown as FigmaLayer).children.find(n=>n.id==='8801:3075')!;
const platforms:Record<string,string>={'8801:3091':'pdd-web','8801:3107':'doudian-client'};
const cards=popup.children.filter(n=>n.type==='INSTANCE'&&n.name.includes('店铺接入/平台卡'));
function cardName(n:FigmaLayer){return n.children.filter(c=>c.type==='TEXT'&&!String(c.props.text).includes('教程')).map(c=>c.props.text).join(' · ');}
export function AddStore({notice}:{notice:(s:string)=>void}){
 const b=useBackend();const [selected,setSelected]=useState(''),[naming,setNaming]=useState(false),[name,setName]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const selectedCard=cards.find(c=>c.id===selected);const platform=platforms[selected];
 const enabled=(id:string)=>Boolean(platforms[id]&&b.snapshot.capabilities.platforms.some(p=>p.id===platforms[id]));
 const close=()=>void window.lingtu?.openMain('UX01');
 const submit=async(e:FormEvent)=>{e.preventDefault();if(pending||!enabled(selected))return;setPending(true);setError('');try{const r=await b.execute({action:'add-store',values:{storeName:name,platform}});notice(r.message||'店铺已添加');await window.lingtu?.openMain('UX01');}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 if(naming)return <form className="live-add-store" onSubmit={submit}><h2>添加店铺<button type="button" aria-label="关闭添加店铺" onClick={close}>×</button></h2><p>{selectedCard&&cardName(selectedCard)}</p><label>店铺名称<input aria-label="店铺名称" autoFocus value={name} maxLength={60} onChange={e=>setName(e.target.value)} required/></label><p>添加后打开店铺完成登录。新店铺默认关闭 AI 自动回复。</p>{error&&<p role="alert">{error}</p>}<button type="button" onClick={()=>setNaming(false)}>返回平台选择</button><button type="submit" disabled={pending||b.loading}>{pending?'正在添加…':'确认添加'}</button></form>;
 const render=(n:FigmaLayer)=>{
  if(cards.some(c=>c.id===n.id)){const ready=enabled(n.id),label=cardName(n);return <button type="button" className={'platform-source-card '+(selected===n.id?'is-selected':'')} aria-label={label+(ready?'':' · 暂没开通')} aria-pressed={selected===n.id} disabled={!ready||b.loading} onClick={()=>setSelected(n.id)}><span aria-hidden="true"><FigmaCanvas screenId="UX03" design={n} scale={1} onAction={()=>{}}/></span>{!ready&&<span className="platform-unavailable">暂没开通</span>}</button>;}
  if(n.id==='8801:3124')return <button className="platform-source-control" aria-label="关闭添加店铺" onClick={close}>×</button>;
  if(n.id==='8801:3121')return <button className="platform-source-control" onClick={close}>取消</button>;
  if(n.id==='8801:3119')return <button className="platform-source-control primary" disabled={!enabled(selected)||b.loading} onClick={()=>setNaming(true)}>确认添加</button>;
  if(n.id==='8801:3116')return null;
  if(n.id==='8801:3128')return selectedCard?cardName(selectedCard):'请选择一个平台';
  return undefined;
 };
 return <section className="source-platform-picker" aria-label="添加店铺 · 平台选择"><FigmaCanvas screenId="UX03" design={popup} scale={1} onAction={()=>{}} renderLayer={render}/></section>;
}
