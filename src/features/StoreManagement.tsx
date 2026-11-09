import {storeDisplayName,storeConnection} from './store-display';
import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import FigmaCanvas from '../design/FigmaCanvas';
import source from '../design/generated/screens/UX07.json';
import type {FigmaLayer} from '../design/types';
import {useBackend} from './BackendProvider';
import type {Store} from './BackendProvider';

function find(n:FigmaLayer,id:string):FigmaLayer|undefined{return n.id===id?n:n.children.map(c=>find(c,id)).find(Boolean);}
const listSource=find(source as FigmaLayer,'8801:245')!;
const rowSource=find(listSource,'8801:298')!;
const doudianSource=find(listSource,'8801:302')!;
const suffix=(n:FigmaLayer)=>n.id.split(';').at(-1)!;
const platformName=(s:Store)=>s.platform==='pdd-web'?'拼多多':'抖店';
const connection=storeConnection;
function useWidth(fallback:number){const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(fallback);useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>setWidth(el.clientWidth||fallback));observer.observe(el);setWidth(el.clientWidth||fallback);return()=>observer.disconnect();},[fallback]);return {ref,width};}
function copy(n:FigmaLayer,patch:(n:FigmaLayer)=>void):FigmaLayer{const next=structuredClone(n);const visit=(node:FigmaLayer)=>{patch(node);node.children.forEach(visit)};visit(next);return next;}

export function StoreManagement({notice}:{notice:(s:string)=>void}){
 const b=useBackend(),{ref,width}=useWidth(1172);
 const [query,setQuery]=useState(''),[platform,setPlatform]=useState('all'),[group,setGroup]=useState('all'),[login,setLogin]=useState('all'),[page,setPage]=useState(0),[pageSize,setPageSize]=useState(10);
 const [remove,setRemove]=useState<Store|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');const restoreFocus=useRef<HTMLElement|null>(null);
 const stores=b.snapshot.stores,groups=[...new Set(stores.map(s=>s.group||'').filter(Boolean))];
 const groupExists=group==='all'||group==='none'||groups.some(g=>'group:'+g===group),effectiveGroup=groupExists?group:'all';
 useEffect(()=>{if(!groupExists){setGroup('all');setPage(0);}},[groupExists]);
 const filtered=stores.filter(s=>(platform==='all'||s.platform===platform)&&(effectiveGroup==='all'||(effectiveGroup==='none'?!s.group:'group:'+s.group===effectiveGroup))&&(login==='all'||(login==='online'?s.runtime.online:!s.runtime.online))&&(storeDisplayName(s)+' '+(s.group||'')+' '+platformName(s)).toLowerCase().includes(query.toLowerCase()));
 const last=Math.max(0,Math.ceil(filtered.length/pageSize)-1),current=Math.min(page,last),visible=filtered.slice(current*pageSize,(current+1)*pageSize);
 const online=stores.filter(s=>s.runtime.online).length;
 const design=useMemo(()=>copy(listSource,n=>{if(['8801:324','8801:325','8801:311','8801:314'].includes(n.id))n.props.constraints={vertical:'TOP',horizontal:'RIGHT'};if(n.id==='I8801:318;8801:7')n.props.size={x:180,y:16};}),[]);
 const cancel=()=>{if(pending)return;setRemove(null);setError('');requestAnimationFrame(()=>restoreFocus.current?.isConnected&&restoreFocus.current.focus());};
 const confirm=async()=>{if(!remove||pending)return;setPending(true);setError('');try{const r=await b.execute({action:'remove-store',storeId:remove.id,values:{confirmed:true}});setRemove(null);notice(r.message||'店铺账号已移除。');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}};
 const chooseLogin=(value:string)=>{setLogin(login===value?'all':value);setPage(0);};
 const render=(n:FigmaLayer)=>{
  if(['8801:299','8801:300','8801:301','8801:302','8801:303','8801:334','8801:337'].includes(n.id))return null;
  if(n.id==='8801:298')return <SourceStoreRows stores={visible} hasStores={stores.length>0} notice={notice} onRemove={s=>{restoreFocus.current=document.activeElement as HTMLElement;setRemove(s);setError('');}}/>;
  if(n.id==='8801:324')return <select className="source-store-control" aria-label="店铺平台筛选" value={platform} onChange={e=>{setPlatform(e.target.value);setPage(0);}}><option value="all">全部平台</option><option value="pdd-web">拼多多</option><option value="doudian-client">抖店</option></select>;
  if(n.id==='8801:325')return <select className="source-store-control" aria-label="店铺分组筛选" value={effectiveGroup} onChange={e=>{setGroup(e.target.value);setPage(0);}}><option value="all">全部分组</option><option value="none">未分组</option>{groups.map(g=><option key={g} value={'group:'+g}>{g}</option>)}</select>;
  if(n.id==='I8801:318;8801:5')return null;
  if(n.id==='I8801:318;8801:7')return <input className="source-store-search" aria-label="搜索店铺或分组" placeholder="搜店名、分组" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>;
  if(n.id==='8801:329')return <button type="button" className="source-store-control" aria-pressed={login==='offline'} onClick={()=>chooseLogin('offline')}>未登录 {stores.length-online}</button>;
  if(n.id==='8801:330')return <button type="button" className="source-store-control" aria-pressed={login==='online'} onClick={()=>chooseLogin('online')}>已登录 {online}</button>;
  if(n.id==='8801:332')return String(stores.length);
  if(n.id==='8801:305')return <select className="source-store-control" aria-label="每页店铺数量" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}>{[10,20,50].map(x=><option key={x} value={x}>{x} 条/页</option>)}</select>;
  if(n.id==='8801:311')return <button className="source-store-control" disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button>;
  if(n.id==='8801:312')return <button className="source-store-control" disabled={current>=last} onClick={()=>setPage(current+1)}>下一页</button>;
  if(n.id==='8801:314')return <span className="source-store-page">{current+1}</span>;
  if(n.id==='8801:316')return `第 ${filtered.length?current*pageSize+1:0}-${Math.min((current+1)*pageSize,filtered.length)} 条 / 共 ${filtered.length} 家店铺`;
  return undefined;
 };
 return <><div ref={ref} className="source-store-management"><FigmaCanvas design={design} screenId="UX07" scale={1} viewport={{width,height:616}} renderLayer={render} onAction={()=>{}}/></div>{remove&&createPortal(<div className="store-remove-mask" onKeyDown={e=>{if(e.key==='Escape')cancel();if(e.key==='Tab'){const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(buttons.length){e.preventDefault();const at=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(at+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}}}}><section role="alertdialog" aria-modal="true" aria-label="删除店铺账号" className="store-remove-dialog"><h2>删除店铺账号</h2><p>确定移除“<strong>{storeDisplayName(remove)}</strong>”吗？</p><p>将停止该店铺接待并关闭本地窗口。仅移除此软件中的账号，平台店铺和订单不受影响。本机记录会先备份。</p>{error&&<p role="alert">{error}</p>}<footer><button type="button" autoFocus disabled={pending} onClick={cancel}>取消删除</button><button type="button" disabled={pending} onClick={()=>void confirm()}>{pending?'正在删除…':'确认删除账号'}</button></footer></section></div>,document.body)}</>;
}

function SourceStoreRows({stores,hasStores,notice,onRemove}:{stores:Store[];hasStores:boolean;notice:(s:string)=>void;onRemove:(s:Store)=>void}){
 const b=useBackend(),{ref,width}=useWidth(1128);
 return <div ref={ref} className="source-store-rows" style={{width:'100%',height:496}}>{b.loading?<p>正在读取店铺…</p>:b.error?<p role="alert">{b.error}</p>:!stores.length?<p className="source-store-empty">{hasStores?'没有符合筛选条件的店铺':'尚未添加店铺'}</p>:stores.map(s=><SourceStoreRow key={s.id} store={s} width={width} notice={notice} onRemove={()=>onRemove(s)}/>)}</div>;
}

function SourceStoreRow({store:s,width,notice,onRemove}:{store:Store;width:number;notice:(s:string)=>void;onRemove:()=>void}){
 const b=useBackend(),[pending,setPending]=useState(false),[group,setGroup]=useState(s.group||'');
 useEffect(()=>setGroup(s.group||''),[s.group]);
 const template=s.platform==='doudian-client'?doudianSource:rowSource;
 const design=useMemo(()=>copy(template,n=>{const id=suffix(n);if(['8801:248','8801:254','8801:255','8801:263','8801:264','8801:270','8801:272','8801:278','8801:290','8801:292'].includes(id))n.props.constraints={vertical:'TOP',horizontal:'RIGHT'};if(id==='8801:247')n.props.constraints={vertical:'TOP',horizontal:'LEFT_RIGHT'};if(id==='8801:274')n.props.size={x:Math.min(120,Math.max(40,storeDisplayName(s).length*13)),y:17};if(id==='8801:256'&&n.props.transform)n.props.transform.m02=49+Math.min(120,Math.max(40,storeDisplayName(s).length*13))+8;if(id==='8801:296')n.props.size={x:88,y:14};if(id==='8801:257')n.props.size={x:94,y:17};}),[template,storeDisplayName(s)]);
 const perform=async(action:string,target?:string)=>{if(pending)return;setPending(true);try{const r=await b.execute({action,storeId:s.id});if(target)await window.lingtu?.openMain(target);else notice(r.message||'操作完成。');}catch(e){notice(e instanceof Error?e.message:String(e));}finally{setPending(false);}};
 const saveGroup=async()=>{const value=group.trim();if(value===(s.group||''))return;setPending(true);try{await b.execute({action:'set-store-group',storeId:s.id,values:{group:value}});setGroup(value);}catch(e){setGroup(s.group||'');notice(e instanceof Error?e.message:String(e));}finally{setPending(false);}};
 const actions:Record<string,{label:string;target?:string;unsupported?:boolean}>={'8801:249':{label:'转接人工',target:'UX08'},'8801:250':{label:'进店欢迎',target:'UX11'},'8801:251':{label:'自动操作',target:'UX12'},'8801:252':{label:'图片识别',target:'UX14'},'8801:253':{label:'同步他店',unsupported:true},'8801:254':{label:'查看商品',unsupported:true}};
 const hidden=new Set(['8801:258','8801:259','8801:260','8801:261','8801:262','8801:263','8801:264','8801:276','8801:280','8801:282','8801:284','8801:286','8801:288','8801:290','8801:292']);
 const render=(n:FigmaLayer)=>{const id=suffix(n);
  if(hidden.has(id))return null;
  if(id==='8801:274')return <span className="source-store-name" title={storeDisplayName(s)}>{storeDisplayName(s)}</span>;
  if(id==='8801:294')return platformName(s);
  if(id==='8801:296')return <span title={s.runtime.identityError||s.runtime.collectionError||s.runtime.lastError}>{connection(s)}</span>;
  if(id==='8801:268')return s.aiEnabled?'AI接待已开启':'AI接待未开启';
  if(id==='8801:272')return '未接入';
  if(id==='8801:256')return <input className="source-store-group" aria-label={storeDisplayName(s)+' 分组'} placeholder="分组" maxLength={30} value={group} disabled={pending} onChange={e=>setGroup(e.target.value)} onBlur={()=>void saveGroup()} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}/>;
  if(id==='8801:278')return <button className="source-store-delete" aria-label={'删除店铺账号 '+storeDisplayName(s)} disabled={pending} onClick={onRemove}>删除</button>;
  if(id==='8801:255')return <button className="source-store-action" disabled={pending||(s.runtime.online&&!s.runtime.identityError)} onClick={()=>void perform('open-store')} title={s.runtime.online?'商品学习尚未接入':'打开店铺完成平台登录'}><i className="source-dot inactive"/>{s.runtime.identityError?'重新获取店铺信息':s.runtime.online?'学习未接入':pending?'打开中…':'请先登录'}</button>;
  if(actions[id]){const a=actions[id];return <button className="source-store-action" disabled={pending||a.unsupported} title={a.unsupported?'此功能尚未接入':a.label==='转接人工'?'配置转人工关键词':'打开配置页面，业务能力以页面提示为准'} onClick={()=>void perform('select-store',a.target)}><i className={'source-dot '+(id==='8801:249'?'':'inactive')}/>{a.label}</button>;}
  return undefined;
 };
 return <article className="source-store-row" aria-label={'店铺 '+storeDisplayName(s)}><FigmaCanvas design={design} screenId="UX07" scale={1} viewport={{width,height:74}} renderLayer={render} onAction={()=>{}}/></article>;
}
