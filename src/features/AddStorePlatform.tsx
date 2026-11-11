import {StoreWorkspaceGate} from './StoreWorkspaceGate';
import {useManagedAccess} from './ManagedAccess';
import {useState} from 'react';
import type {FormEvent} from 'react';
import FigmaCanvas from '../design/FigmaCanvas';
import source from '../design/generated/screens/UX03.json';
import type {FigmaLayer} from '../design/types';
import {useBackend} from './BackendProvider';
const popup=(source as unknown as FigmaLayer).children.find(n=>n.id==='8801:3075')!;
const platforms:Record<string,string>={'8801:3091':'pdd-web','8801:3107':'doudian-client'};
const cards=popup.children.filter(n=>n.type==='INSTANCE'&&n.name.includes('店铺接入/平台卡'));
const bodyTop=80,footerTop=768;
function band(id:string,nodes:FigmaLayer[],offset:number,height:number):FigmaLayer{
 return {id,name:id,type:'FRAME',props:{size:{x:630,y:height}},children:nodes.map(n=>({...n,props:{...n.props,transform:{...n.props.transform!,m12:(n.props.transform?.m12||0)-offset},...(n.id==='8801:3114'||n.id==='8801:3115'?{size:{x:n.props.size!.x,y:154.125}}:{})}}))};
}
const headerDesign=band('platform-header',popup.children.filter(n=>(n.props.transform?.m12||0)<bodyTop),0,bodyTop);
const bodyDesign=band('platform-body',popup.children.filter(n=>(n.props.transform?.m12||0)>=bodyTop&&(n.props.transform?.m12||0)<footerTop&&n.id!=='8801:3118'),bodyTop,752);
const footerDesign=band('platform-footer',popup.children.filter(n=>(n.props.transform?.m12||0)>=footerTop),footerTop,87);
function cardName(n:FigmaLayer){return n.children.filter(c=>c.type==='TEXT'&&!String(c.props.text).includes('教程')).map(c=>c.props.text).join(' · ');}
function PlatformPicker({notice}:{notice:(s:string)=>void}){
 const managed=useManagedAccess();
 const b=useBackend();const [selected,setSelected]=useState(''),[naming,setNaming]=useState(false),[name,setName]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const selectedCard=cards.find(c=>c.id===selected);const platform=platforms[selected];
 const enabled=(id:string)=>Boolean(platforms[id]&&b.snapshot.capabilities.platforms.some(p=>p.id===platforms[id]));
 const close=()=>void window.lingtu?.openMain('UX01');
 const add=async()=>{if(pending||!enabled(selected))return;setPending(true);setError('');try{const r=await b.execute({action:'add-store',values:platform==='pdd-web'?{platform,openAfterAdd:true}:{storeName:name,platform}});notice(r.message||'店铺已添加');await window.lingtu?.openMain('UX01');}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 const submit=(e:FormEvent)=>{e.preventDefault();void add();};
 const binding=managed.state.workspace.externalClient;
 const needsBinding=platform==='doudian-client'&&binding&&!binding.allowed;
 const bind=async()=>{
  if(pending)return;
  setPending(true);setError('');
  try{await managed.action('claim-native');await b.refresh();notice('本机抖店客户端已绑定，请选择抖店继续添加。');setNaming(false);}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setPending(false);}
 };
 if(naming&&needsBinding)return <section className="live-add-store live-add-store-readable">
  <h2>添加抖店<button type="button" aria-label="关闭添加店铺" onClick={close}>×</button></h2>
  <section aria-label="本机抖店客户端绑定"><h3>确认使用本机抖店客户端</h3>{binding.canClaim?<><p>添加前，请确认这台电脑上的抖店客户端归当前账号「{managed.state.session.account?.displayName}」使用。绑定后仅此账号可用，当前不支持更换绑定账号。</p><button type="button" disabled={pending} onClick={()=>void bind()}>确认绑定本机抖店客户端</button></>:<p>本机抖店客户端已绑定其他账号，请登录原账号使用。</p>}</section>
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={pending} onClick={()=>setNaming(false)}>返回平台选择</button>
 </section>;
 if(naming)return <form className="live-add-store live-add-store-readable" onSubmit={submit}><h2>添加店铺<button type="button" aria-label="关闭添加店铺" onClick={close}>×</button></h2><p>{selectedCard&&cardName(selectedCard)}</p><label>店铺名称<input aria-label="店铺名称" autoFocus value={name} maxLength={60} onChange={e=>setName(e.target.value)} required/></label><p>添加后打开店铺完成登录。新店铺默认关闭 AI 自动回复。</p>{error&&<p role="alert">{error}</p>}<button type="button" onClick={()=>setNaming(false)}>返回平台选择</button><button type="submit" disabled={pending||b.loading||Boolean(needsBinding)}>{pending?'正在添加…':'确认添加'}</button></form>;
 if(b.loading||b.error||b.snapshot.capabilities.platforms.length===0)return <section className="live-add-store" aria-label="读取平台列表">
  <h2>添加店铺</h2><p role={b.error?'alert':'status'}>{b.error||'正在连接店铺服务，请稍候。'}</p>
  <button onClick={()=>void b.refresh()}>重新读取</button><button onClick={close}>返回</button>
 </section>;
 const render=(n:FigmaLayer)=>{
  if(cards.some(c=>c.id===n.id)){const ready=enabled(n.id),label=cardName(n);return <button type="button" className={'platform-source-card '+(selected===n.id?'is-selected':'')+((n.props.size?.y||0)<110?' is-compact':'')} aria-label={label+(ready?'':' · 暂没开通')} aria-pressed={selected===n.id} disabled={!ready||b.loading||pending} onClick={()=>setSelected(n.id)}><span aria-hidden="true"><FigmaCanvas screenId="UX03" design={n} scale={1} onAction={()=>{}}/></span>{!ready&&<span className="platform-unavailable">暂没开通</span>}</button>;}
  if(n.id==='8801:3124')return <button className="platform-source-control" aria-label="关闭添加店铺" onClick={close}>×</button>;
  if(n.id==='8801:3121')return <button className="platform-source-control" onClick={close}>取消</button>;
  if(n.id==='8801:3119')return <button className="platform-source-control primary" disabled={!enabled(selected)||b.loading||pending} onClick={()=>platform==='pdd-web'?void add():setNaming(true)}>{pending?'正在打开登录…':'确认添加'}</button>;
  if(n.id==='8801:3116')return null;
  if(n.id==='8801:3128')return selectedCard?cardName(selectedCard):'请选择一个平台';
  return undefined;
 };
 return <section className="source-platform-picker" aria-label="添加店铺 · 平台选择"><div className="platform-picker-header"><FigmaCanvas screenId="UX03" design={headerDesign} scale={1} onAction={()=>{}} renderLayer={render}/></div><div className="platform-picker-body" role="region" aria-label="可滚动平台列表" tabIndex={0}><FigmaCanvas screenId="UX03" design={bodyDesign} scale={1} onAction={()=>{}} renderLayer={render}/></div><div className="platform-picker-footer"><FigmaCanvas screenId="UX03" design={footerDesign} scale={1} onAction={()=>{}} renderLayer={render}/></div>{error&&<p role="alert">{error}</p>}</section>;
}

export function AddStore({notice}:{notice:(s:string)=>void}){return <StoreWorkspaceGate><PlatformPicker notice={notice}/></StoreWorkspaceGate>;}
