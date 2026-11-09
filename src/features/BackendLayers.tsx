import {ManagedAccountPanel} from './ManagedAccess';
import {StoreManagement} from './StoreManagement';
import {ModelSettings} from './ModelSettings';
import {CheckUpdateLink} from './Updates';import {version as appVersion} from '../../package.json';
import {useState} from 'react';import {AddStore} from './AddStorePlatform';
import {useBackend} from './BackendProvider';import type {Store} from './BackendProvider';import type {FigmaLayer} from '../design/types';
const status=(s:Store)=>s.runtime?.collectionError?'采集中断':s.runtime?.online?'已连接':s.runtime?.awaitingClient?'等待客户端':s.runtime?.lastError?'连接失败':s.runtime?.open?'请完成登录':'未打开';
export function useBackendLayers(screen:string,notice:(s:string)=>void){
 const b=useBackend();return (n:FigmaLayer)=>{
  if(screen==='UX25'&&n.id==='8801:2697')return <ManagedAccountPanel/>;
  if(!b.available)return undefined;
  if(n.type==='TEXT'&&n.props.text==='检测更新')return <CheckUpdateLink/>;
  if(n.type==='TEXT'&&/^v\d+\.\d+\.\d+$/.test(String(n.props.text||'')))return 'v'+appVersion;
  if(n.name==='商品自动学习 / 标题栏/商品自动学习')return screen==='UX07'?<div className="source-auto-learning" title="商品自动学习尚未接入"><span>商品自动学习</span><button role="switch" aria-label="商品自动学习" aria-checked={false} disabled><i/></button></div>:null;
  if(n.name==='顶部操作 · 接待与一键操作')return <LiveReception notice={notice}/>;
  if((screen==='UX01'&&n.id==='11:84')||(screen==='UX02'&&n.name==='平台店铺 / 9 个渠道'))return <StoreList notice={notice}/>;
  if(screen==='UX03'&&n.id==='8801:3075')return <AddStore notice={notice}/>;
  if(screen==='UX07'&&n.id==='8801:348')return '登录店铺 → 配置接待。支持按平台、分组筛选；商品学习功能待接入。';
  if(screen==='UX07'&&n.id==='8801:346')return <button className="source-store-control" onClick={()=>void b.execute({action:'refresh'}).then(()=>notice('店铺状态已刷新。')).catch(e=>notice(e.message))}>刷新</button>;
  if(screen==='UX07'&&n.id==='8801:245')return <StoreManagement notice={notice}/>;
  if(Number(screen.slice(2))>=26&&Number(screen.slice(2))<32&&/^(会话行|空状态|已选会话|消息回复输入区)/.test(n.name))return null;
  if(screen==='UX17'&&n.id==='8801:1902')return <div className="live-global-rule"><b>全局模型规则</b><p>当前规则应用于全部店铺。</p><p>多方案与店铺独立绑定尚未接入。</p></div>;
  if(screen==='UX17'&&n.id==='10824:6117')return <div className="live-global-rule"><b>应用店铺（全部）</b>{b.snapshot.stores.map(s=><p key={s.id}>{s.storeName}</p>)}</div>;
  if(n.type==='TEXT'){
   const tab=String(n.props.text||'').match(/^(咨询|预警|工单|售后)\s*\d+$/);if(tab)return tab[1]+' '+b.snapshot.conversations.filter(c=>tab[1]==='咨询'?c.status==='pending':tab[1]==='预警'?c.status==='handoff':false).length;
   if(n.id==='11:79')return String(b.snapshot.stores.filter(s=>s.runtime?.online).length);
   if(n.id==='11:83')return String(b.snapshot.stores.filter(s=>!s.runtime?.online).length);
   if(n.id==='11:297')return '已接入拼多多网页版、抖店客户端';
   if(screen==='UX17'&&['8801:1984','8801:1987','8801:1989','8801:1903','8801:1904'].includes(n.id))return n.id==='8801:1984'?'编辑全局模型规则':n.id==='8801:1987'?'保存后应用于全部店铺':'';
   const text=String(n.props.text||'');const selected=b.snapshot.stores.find(s=>s.id===b.snapshot.selection.storeId);
   if(/^(米配匠|店口五金店|拼多多 · 未登录|店口五金店 · 主账号)$/.test(text))return selected?.storeName||'尚未选择店铺';
   if(/^(待回复|已回复)\s*\d+$/.test(text)){const replied=text.startsWith('已回复');return `${replied?'已回复':'待回复'} ${b.snapshot.conversations.filter(c=>replied?c.status==='replied':c.status==='pending').length}`;}
  }
  return undefined;
 };
}
function StoreList({notice,wide=false}:{notice:(s:string)=>void;wide?:boolean}){
 const b=useBackend();const [query,setQuery]=useState('');const perform=(action:string,s:Store,values?:Record<string,unknown>)=>void b.execute({action,storeId:s.id,values}).then(r=>notice(r.message||'操作完成')).catch(e=>notice(e.message));
 return <section className={'live-stores '+(wide?'is-wide':'')} aria-label="真实店铺列表"><input aria-label="筛选已添加店铺" placeholder="搜索店铺 / 平台" value={query} onChange={e=>setQuery(e.target.value)}/>{b.loading?<p>正在读取店铺…</p>:b.error?<p role="alert">{b.error}</p>:!b.snapshot.stores.length?<p>尚未添加店铺</p>:b.snapshot.stores.filter(s=>(s.storeName+s.platform).toLowerCase().includes(query.toLowerCase())).map(s=><article key={s.id} className={b.snapshot.selection.storeId===s.id?'selected':''}><button className="store-select" onClick={()=>perform('select-store',s)}><b>{s.storeName}</b><span>{s.platform==='pdd-web'?'拼多多':'抖店'} · {status(s)}</span></button><div><button onClick={()=>perform('open-store',s)}>打开</button>{wide&&s.aiEnabled&&<button onClick={()=>perform(b.snapshot.engine[s.id]?.paused?'resume-ai':'pause-ai',s)}>{b.snapshot.engine[s.id]?.paused?'恢复AI':'暂停AI'}</button>}<button role="switch" aria-label={s.storeName+' AI'} aria-checked={s.aiEnabled} onClick={()=>perform('set-ai',s,{enabled:!s.aiEnabled})}>AI {s.aiEnabled?'开':'关'}</button>{s.platform==='doudian-client'&&s.runtime?.open&&<button onClick={()=>perform('restart-client',s)}>重启客户端</button>}{wide&&s.runtime?.open&&<button onClick={()=>perform('close-store',s)}>关闭平台</button>}</div>{(s.runtime?.lastError||s.runtime?.collectionError)&&<small>{s.runtime.collectionError||s.runtime.lastError}</small>}</article>)}</section>;
}
export function BackendChrome({screen,notice}:{screen:string;notice:(s:string)=>void}){
 const b=useBackend();if(!b.available)return null;
 return <>{!['UX01','UX02','UX03','UX07','UX17','UX25','UX26','UX27','UX30','UX32'].includes(screen)&&<div className="live-capability-note">{screen==='UX08'?'支持全局转人工关键词设置，其它转接规则尚未接入。':'此页面为设计预览，当前后端尚未提供该业务能力。'}</div>}{b.error&&<div role="alert" className="live-service-error">服务读取失败：{b.error}</div>}{Number(screen.slice(2))>=26&&Number(screen.slice(2))<32&&<LiveConversations screen={screen} notice={notice}/>} {b.settings&&<ModelSettings notice={notice}/>}<ManagedModelIssueNotice key={b.snapshot.workspaceId}/></>;
}
function LiveConversations({screen,notice}:{screen:string;notice:(s:string)=>void}){
 const b=useBackend();const selected=b.snapshot.conversations.find(c=>c.storeId===b.snapshot.selection.storeId&&c.uid===b.snapshot.selection.conversationId);const [drafts,setDrafts]=useState<Record<string,string>>({}),[pending,setPending]=useState(false);const key=selected?selected.storeId+':'+selected.uid:'none',reply=drafts[key]||'';
 const entries=b.snapshot.conversations.filter(c=>screen==='UX30'?c.status==='replied':screen==='UX27'?c.status==='handoff':screen==='UX26'?c.status==='pending':false);
 const send=async()=>{if(!selected||!reply.trim()||pending)return;const text=reply,scope=key;setPending(true);try{const r=await b.execute({action:'send-reply',storeId:selected.storeId,conversationId:selected.uid,values:{reply:text}});setDrafts(old=>old[scope]===text?{...old,[scope]:''}:old);notice(r.message||'回复已发送')}catch(e){notice(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 return <section className="live-conversations" aria-label="真实会话"><div className="live-conversation-list">{!entries.length?<p>{['UX28','UX29','UX31'].includes(screen)?'该业务能力尚未接入':'暂无采集会话'}</p>:entries.map(c=><button key={c.storeId+':'+c.uid} className={selected===c?'selected':''} onClick={()=>void b.execute({action:'select-conversation',storeId:c.storeId,conversationId:c.uid}).catch(e=>notice(e.message))}><b>{c.name}</b><small>{b.snapshot.stores.find(s=>s.id===c.storeId)?.storeName}</small><span>{c.messages.at(-1)?.content}</span></button>)}</div><div className="live-history" aria-label="会话记录">{selected&&b.snapshot.engine[selected.storeId]?.running&&<button className="resume-conversation" onClick={()=>void b.execute({action:'resume-conversation',storeId:selected.storeId,conversationId:selected.uid}).then(r=>notice(r.message||'已恢复')).catch(e=>notice(e.message))}>恢复本会话AI</button>}{selected?selected.messages.map((m,i)=><p key={i} className={m.from==='seller'?'seller':'buyer'}><small>{m.from==='seller'?'我':selected.name}</small>{m.content}</p>):<p>选择会话后查看记录</p>}</div><form className="live-reply" onSubmit={e=>{e.preventDefault();void send()}}><label>{selected?'发给 '+selected.name:'选择会话后回复'}<textarea aria-label="实际回复内容" disabled={!selected||pending} value={reply} maxLength={2000} onChange={e=>setDrafts({...drafts,[key]:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/></label><button disabled={!selected||!reply.trim()||pending}>发送</button></form></section>;
}
function LiveReception({notice}:{notice:(s:string)=>void}){
 const b=useBackend(),s=b.snapshot.stores.find(s=>s.id===b.snapshot.selection.storeId);const [pending,setPending]=useState(false);
 const run=async(action:string,values?:Record<string,unknown>)=>{if(pending)return;setPending(true);try{const r=await b.execute({action,storeId:s?.id,values});notice(r.message||'操作完成');const failed=(r.data?.results as {ok:boolean;message?:string}[]|undefined)?.filter(r=>!r.ok);if(failed?.length)notice((r.message||'')+' '+failed.map(r=>r.message).join('；'));}catch(e){notice(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 return <div className="live-reception"><button disabled={pending||!s} onClick={()=>void run('set-ai',{enabled:!s?.aiEnabled})}><i className={s?.aiEnabled?'on':''}/>{s?.aiEnabled?(b.snapshot.engine[s.id]?.paused?'AI已暂停':'全自动接待'):'AI已关闭'}</button><button onClick={()=>{if(window.lingtu?.managedAction)void window.lingtu.openMain('UX25');else b.setSettings(true);}}>模型设置⌄</button><select aria-label="一键操作" disabled={pending} value="" onChange={e=>void run('batch',{operation:e.target.value})}><option value="" disabled>一键操作⌄</option><option value="open">一键加载店铺</option><option value="pause">一键暂停AI</option><option value="close">一键离线</option><option value="enable">一键开启AI</option><option value="disable">一键关闭AI</option></select></div>;
}
function ManagedModelIssueNotice(){
 const b=useBackend(),issue=b.snapshot.modelIssue;const [review,setReview]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 if(!issue)return null;
 const acknowledge=async()=>{if(pending)return;setPending(true);setError('');try{await b.execute({action:'acknowledge-model-issue',values:{confirmed:true,code:issue.code,at:issue.at}});setReview(false);}catch(e){setError(e instanceof Error?e.message:'操作未完成');}finally{setPending(false);}};
 return <aside className="managed-model-issue" role="alert" aria-label="托管 AI 暂停提示"><strong>托管 AI 已暂停</strong><p>{issue.message}</p>
  <p>{issue.requiresReview?'结果待核对：已保留原输入，不会自动重发或发送超时兜底。请先检查平台回复与服务端请求记录；尚未确认时不要重新生成。':'当前不会自动重试或切换模型。检查服务或额度后，确认提示，再手动开启 AI。'}</p>
  {review?<div role="alertdialog" aria-label="确认已核对托管请求"><p>请确认你已核对原请求及买家会话。清除提示不会重发原请求，也不会自动开启 AI。</p><button disabled={pending} onClick={()=>void acknowledge()}>我已核对，清除提示</button><button disabled={pending} onClick={()=>setReview(false)}>继续保留提示</button></div>:<button disabled={pending} onClick={()=>issue.requiresReview?setReview(true):void acknowledge()}>{issue.requiresReview?'核对后处理':'清除提示'}</button>}
  {error&&<p>{error}</p>}
 </aside>;
}
