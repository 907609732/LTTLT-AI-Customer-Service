import {ModelProfiles} from './ModelProfiles';
import {IntentKnowledge} from './IntentKnowledge';
import {ConversationQuality} from './ConversationQuality';
import {StoreWorkspaceGate} from './StoreWorkspaceGate';
import {storeDisplayName,storeConnection} from './store-display';
import {ManagedAccountPanel} from './ManagedAccess';
import {StoreManagement} from './StoreManagement';
import {ModelSettings} from './ModelSettings';
import {TrainingGround} from './TrainingGround';
import {WorkOrders} from './WorkOrders';
import {LiveDashboard} from './LiveDashboard';
import {AutomationSettings} from './AutomationSettings';
import {CheckUpdateLink} from './Updates';import {version as appVersion} from '../../package.json';
import {useEffect,useRef,useState} from 'react';import type {FormEvent,RefObject} from 'react';import {AddStore} from './AddStorePlatform';
import {useBackend} from './BackendProvider';import type {Store} from './BackendProvider';import type {FigmaLayer} from '../design/types';
const status=storeConnection;
export function useBackendLayers(screen:string,notice:(s:string)=>void,openAccount:()=>void){
 const b=useBackend(),handoffDrafts=useRef<Record<string,string>>({});return (n:FigmaLayer)=>{
  if(n.id.endsWith(';8835:25579')||n.id==='8835:25579')return null;
  if(screen==='UX25'&&n.id==='8801:2697')return <ManagedAccountPanel/>;
  if(!b.available)return undefined;
  if(n.type==='TEXT'&&n.props.text==='检测更新')return <CheckUpdateLink/>;
  if(n.type==='TEXT'&&/^v\d+\.\d+\.\d+$/.test(String(n.props.text||'')))return 'v'+appVersion;
  if(n.name==='商品自动学习 / 标题栏/商品自动学习')return screen==='UX07'?<div className="source-auto-learning" title="商品自动学习尚未接入"><span>商品自动学习</span><button role="switch" aria-label="商品自动学习" aria-checked={false} disabled><i/></button></div>:null;
  if(n.name==='顶部操作 · 接待与一键操作')return <LiveReception notice={notice} openAccount={openAccount}/>;
  if((screen==='UX01'&&n.id==='11:84')||(screen==='UX02'&&n.name==='平台店铺 / 9 个渠道'))return <StoreWorkspaceGate><StoreList notice={notice}/></StoreWorkspaceGate>;
  if((screen==='UX04'&&n.id==='8801:448')||(screen==='UX05'&&n.id==='8801:596')||(screen==='UX06'&&n.id==='8801:773'))return <LiveDashboard/>;
  if(screen==='UX08'&&n.id==='8801:838')return <HandoffPage notice={notice} drafts={handoffDrafts}/>;
  if(screen==='UX17'&&n.id==='8801:1892')return <ModelProfiles/>;
  if(screen==='UX15'&&n.id==='8801:1533')return <IntentKnowledge/>;
  if(screen==='UX12'&&n.id==='8801:1260')return <AutomationSettings notice={notice}/>;
  if(screen==='UX03'&&n.id==='8801:3075')return <AddStore notice={notice}/>;
  if(screen==='UX07'&&n.id==='8801:348')return '登录店铺 → 配置接待。支持按平台、分组筛选；商品学习功能待接入。';
  if(screen==='UX07'&&n.id==='8801:346')return <button className="source-store-control" onClick={()=>void b.execute({action:'refresh'}).then(()=>notice('店铺状态已刷新。')).catch(e=>notice(e.message))}>刷新</button>;
  if(screen==='UX07'&&n.id==='8801:245')return <StoreWorkspaceGate><StoreManagement notice={notice}/></StoreWorkspaceGate>;
  if(screen==='UX16'&&n.id==='8801:1803')return <TrainingGround/>;
  if(screen==='UX21'&&n.id==='8801:2258')return <ConversationQuality openAccount={openAccount}/>;
  if(screen==='UX20'&&n.id==='8801:2186')return <WorkOrders/>;
  if(Number(screen.slice(2))>=26&&Number(screen.slice(2))<32&&/^(会话行|空状态|已选会话|消息回复输入区)/.test(n.name))return null;
  if(screen==='UX17'&&n.id==='8801:1902')return <div className="live-global-rule"><b>全局模型规则</b><p>当前规则应用于全部店铺。</p><p>多方案与店铺独立绑定尚未接入。</p></div>;
  if(screen==='UX17'&&n.id==='10824:6117')return <div className="live-global-rule"><b>应用店铺（全部）</b>{b.snapshot.stores.map(s=><p key={s.id}>{storeDisplayName(s)}</p>)}</div>;
  if(n.type==='TEXT'){
   const tab=String(n.props.text||'').match(/^(咨询|预警|工单|售后)\s*\d+$/);if(tab)return tab[1]+' '+b.snapshot.conversations.filter(c=>tab[1]==='咨询'?c.status==='pending':tab[1]==='预警'?c.status==='handoff':false).length;
   if(n.id==='11:79')return String(b.snapshot.stores.filter(s=>s.runtime?.online).length);
   if(n.id==='11:83')return String(b.snapshot.stores.filter(s=>!s.runtime?.online).length);
   if(n.id==='11:297')return '已接入拼多多网页版、抖店客户端';
   if(screen==='UX17'&&['8801:1984','8801:1987','8801:1989','8801:1903','8801:1904'].includes(n.id))return n.id==='8801:1984'?'编辑全局模型规则':n.id==='8801:1987'?'保存后应用于全部店铺':'';
   const text=String(n.props.text||'');const selected=b.snapshot.stores.find(s=>s.id===b.snapshot.selection.storeId);
   if(/^(米配匠|店口五金店|拼多多 · 未登录|店口五金店 · 主账号)$/.test(text))return selected?storeDisplayName(selected):'尚未选择店铺';
   if(/^(待回复|已回复)\s*\d+$/.test(text)){const replied=text.startsWith('已回复');return `${replied?'已回复':'待回复'} ${b.snapshot.conversations.filter(c=>replied?c.status==='replied':c.status==='pending').length}`;}
  }
  return undefined;
 };
}
function StoreList({notice,wide=false}:{notice:(s:string)=>void;wide?:boolean}){
 const b=useBackend();const [query,setQuery]=useState('');const perform=(action:string,s:Store,values?:Record<string,unknown>)=>void b.execute({action,storeId:s.id,values}).then(r=>notice(r.message||'操作完成')).catch(e=>notice(e.message));
 return <section className={'live-stores '+(wide?'is-wide':'')} aria-label="真实店铺列表"><input aria-label="筛选已添加店铺" placeholder="搜索店铺 / 平台" value={query} onChange={e=>setQuery(e.target.value)}/>{b.loading?<p>正在读取店铺…</p>:b.error?<p role="alert">{b.error}</p>:!b.snapshot.stores.length?<p>尚未添加店铺</p>:b.snapshot.stores.filter(s=>(storeDisplayName(s)+s.platform).toLowerCase().includes(query.toLowerCase())).map(s=><article key={s.id} className={b.snapshot.selection.storeId===s.id?'selected':''}><button className="store-select" onClick={()=>perform('select-store',s)}><b>{storeDisplayName(s)}</b>{s.platform==='pdd-web'&&<small>{s.customerServiceName||'账号信息待获取'}</small>}<span>{s.platform==='pdd-web'?'拼多多':'抖店'} · {status(s)}</span></button><div><button onClick={()=>perform('open-store',s)}>打开</button>{wide&&s.aiEnabled&&<button onClick={()=>perform(b.snapshot.engine[s.id]?.paused?'resume-ai':'pause-ai',s)}>{b.snapshot.engine[s.id]?.paused?'恢复AI':'暂停AI'}</button>}<button role="switch" aria-label={storeDisplayName(s)+' AI'} aria-checked={s.aiEnabled} onClick={()=>perform('set-ai',s,{enabled:!s.aiEnabled})}>AI {s.aiEnabled?'开':'关'}</button>{s.platform==='doudian-client'&&s.runtime?.open&&<button onClick={()=>perform('restart-client',s)}>重启客户端</button>}{wide&&s.runtime?.open&&<button onClick={()=>perform('close-store',s)}>关闭平台</button>}</div>{(s.runtime?.lastError||s.runtime?.identityError||s.runtime?.collectionError)&&<small>{s.runtime.identityError||s.runtime.collectionError||s.runtime.lastError}</small>}</article>)}</section>;
}
export function BackendChrome({screen,notice,openAccount}:{screen:string;notice:(s:string)=>void;openAccount:()=>void}){
 const b=useBackend();if(!b.available)return null;
 return <>{!['UX01','UX02','UX03','UX04','UX05','UX06','UX07','UX12','UX15','UX16','UX17','UX19','UX20','UX21','UX25','UX26','UX27','UX30','UX32'].includes(screen)&&<div className="live-capability-note">{screen==='UX08'?'命中后会标记会话并暂停 AI；平台自动转接尚未接入。':'此页面为设计预览，当前后端尚未提供该业务能力。'}</div>}{b.error&&<div role="alert" className="live-service-error">服务读取失败：{b.error}</div>}{Number(screen.slice(2))>=26&&Number(screen.slice(2))<32&&<LiveConversations screen={screen} notice={notice}/>} {b.settings&&<ModelSettings notice={notice}/>}</>;
}
function LiveConversations({screen,notice}:{screen:string;notice:(s:string)=>void}){
 const b=useBackend();const selected=b.snapshot.conversations.find(c=>c.storeId===b.snapshot.selection.storeId&&c.uid===b.snapshot.selection.conversationId);const [drafts,setDrafts]=useState<Record<string,string>>({}),[pending,setPending]=useState(false);const key=selected?selected.storeId+':'+selected.uid:'none',reply=drafts[key]||'';
 const entries=b.snapshot.conversations.filter(c=>screen==='UX30'?c.status==='replied':screen==='UX27'?c.status==='handoff':screen==='UX26'?c.status==='pending':false);
 const send=async()=>{if(!selected||!reply.trim()||pending)return;const text=reply,scope=key;setPending(true);try{const r=await b.execute({action:'send-reply',storeId:selected.storeId,conversationId:selected.uid,values:{reply:text}});setDrafts(old=>old[scope]===text?{...old,[scope]:''}:old);notice(r.message||'回复已发送')}catch(e){notice(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 return <section className="live-conversations" aria-label="真实会话"><div className="live-conversation-list">{!entries.length?<p>{['UX28','UX29','UX31'].includes(screen)?'该业务能力尚未接入':'暂无采集会话'}</p>:entries.map(c=><button key={c.storeId+':'+c.uid} className={selected===c?'selected':''} onClick={()=>void b.execute({action:'select-conversation',storeId:c.storeId,conversationId:c.uid}).catch(e=>notice(e.message))}><b>{c.name}</b><small>{(()=>{const store=b.snapshot.stores.find(s=>s.id===c.storeId);return store?storeDisplayName(store):'店铺已移除'})()}</small><span>{c.messages.at(-1)?.content}</span></button>)}</div><div className="live-history" aria-label="会话记录">{selected&&b.snapshot.engine[selected.storeId]?.running&&<button className="resume-conversation" onClick={()=>void b.execute({action:'resume-conversation',storeId:selected.storeId,conversationId:selected.uid}).then(r=>notice(r.message||'已恢复')).catch(e=>notice(e.message))}>恢复本会话AI</button>}{selected?selected.messages.map((m,i)=><p key={i} className={m.from==='seller'?'seller':'buyer'}><small>{m.from==='seller'?'我':selected.name}</small>{m.content}</p>):<p>选择会话后查看记录</p>}</div><form className="live-reply" onSubmit={e=>{e.preventDefault();void send()}}><label>{selected?'发给 '+selected.name:'选择会话后回复'}<textarea aria-label="实际回复内容" disabled={!selected||pending} value={reply} maxLength={2000} onChange={e=>setDrafts({...drafts,[key]:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/></label><button disabled={!selected||!reply.trim()||pending}>发送</button></form></section>;
}
function LiveReception({notice,openAccount}:{notice:(s:string)=>void;openAccount:()=>void}){
 const b=useBackend(),s=b.snapshot.stores.find(s=>s.id===b.snapshot.selection.storeId);const [pending,setPending]=useState(false);
 const run=async(action:string,values?:Record<string,unknown>)=>{if(pending)return;setPending(true);try{const r=await b.execute({action,storeId:s?.id,values});notice(r.message||'操作完成');const failed=(r.data?.results as {ok:boolean;message?:string}[]|undefined)?.filter(r=>!r.ok);if(failed?.length)notice((r.message||'')+' '+failed.map(r=>r.message).join('；'));}catch(e){notice(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 return <div className="live-reception"><button disabled={pending||!s} onClick={()=>b.snapshot.modelIssue?void window.lingtu?.openMain('UX21'):void run('set-ai',{enabled:!s?.aiEnabled})}><i className={s?.aiEnabled?'on':''}/>{b.snapshot.modelIssue?'服务异常 · 查看':s?.aiEnabled?(b.snapshot.engine[s.id]?.paused?'AI已暂停':'全自动接待'):'AI已关闭'}</button><button onClick={()=>{b.setSettings(true);}}>模型设置⌄</button><select aria-label="一键操作" disabled={pending} value="" onChange={e=>void run('batch',{operation:e.target.value})}><option value="" disabled>一键操作⌄</option><option value="open">一键加载店铺</option><option value="pause">一键暂停AI</option><option value="close">一键离线</option><option value="enable">一键开启AI</option><option value="disable">一键关闭AI</option></select></div>;
}
export function ManagedModelIssueNotice(){
 const b=useBackend(),issue=b.snapshot.modelIssue;const [review,setReview]=useState(false),[collapsed,setCollapsed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setCollapsed(false);setReview(false);},[issue?.at]);
 if(!issue)return null;
 if(collapsed)return <aside className="managed-model-issue" role="alert" aria-label="托管 AI 暂停提示"><strong>托管 AI 已暂停</strong><button onClick={()=>setCollapsed(false)}>查看异常记录</button></aside>;
 const acknowledge=async()=>{if(pending)return;setPending(true);setError('');try{await b.execute({action:'acknowledge-model-issue',values:{confirmed:true,code:issue.code,at:issue.at}});setReview(false);}catch(e){setError(e instanceof Error?e.message:'操作未完成');}finally{setPending(false);}};
 return <aside className="managed-model-issue" role="alert" aria-label="托管 AI 暂停提示"><strong>托管 AI 已暂停</strong><button className="model-issue-collapse" onClick={()=>setCollapsed(true)}>收起</button><p>{issue.message}</p>
  <p>{issue.requiresReview?'请对照下面的记录检查原会话，确认后再处理。':'请检查服务或额度后再处理。'}</p>
  {issue.requiresReview&&(issue.context?<section className="model-issue-detail" aria-label="待核对记录">
   <p><b>店铺</b> {issue.context.storeName||issue.context.storeId||'模型请求'}</p>
   <p><b>会话</b> {issue.context.buyerName||issue.context.uid||'未关联买家会话'}</p>
   <p><b>发生时间</b> {new Date(issue.at).toLocaleString('zh-CN')}</p>
   {issue.context.requestId&&<p><b>请求编号</b> {issue.context.requestId}</p>}
   {issue.context.buyerMessage&&<><b>买家消息</b><p className="model-issue-text">{issue.context.buyerMessage}</p></>}
   {issue.context.reply&&<><b>待核对回复</b><p className="model-issue-text">{issue.context.reply}</p></>}
   {issue.context.storeId&&issue.context.uid&&<button disabled={pending} onClick={()=>{setPending(true);setError('');void b.execute({action:'review-model-issue',values:{code:issue.code,at:issue.at}}).catch(e=>setError(e.message)).finally(()=>setPending(false));}}>定位原会话</button>}
  </section>:<p className="model-issue-missing">当前记录缺少店铺、会话和回复明细，无法展示原回复。</p>)}
  {review?<div role="alertdialog" aria-label="确认清除异常记录"><p>{issue.context?'确认处理这条异常记录后，AI 仍需手动开启。':'这条旧记录缺少明细。清除后，AI 仍需手动开启。'}</p><button disabled={pending} onClick={()=>void acknowledge()}>确认清除记录</button><button disabled={pending} onClick={()=>setReview(false)}>保留记录</button></div>:<button disabled={pending} onClick={()=>issue.requiresReview?setReview(true):void acknowledge()}>{issue.requiresReview?'处理这条记录':'清除提示'}</button>}
  {error&&<p>{error}</p>}
 </aside>;
}

function HandoffKeywords({notice,drafts}:{notice:(s:string)=>void;drafts:RefObject<Record<string,string>>}){
 const b=useBackend(),selectedStore=b.snapshot.selection.storeId,[globalMode,setGlobalMode]=useState(false),storeId=globalMode?'':selectedStore,draftKey=storeId||'global',global=b.snapshot.config.safety.handoffKeywords,custom=b.snapshot.handoffByStore?.[storeId];
 const [keywords,setKeywords]=useState(drafts.current[draftKey]??(custom?.keywords||global).join('，')),[pending,setPending]=useState(false),[error,setError]=useState('');
 const save=async(e:FormEvent)=>{e.preventDefault();if(pending)return;setPending(true);setError('');try{const list=keywords.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);if(storeId){await b.execute({action:'save-store-handoff',storeId,values:{mode:'custom',keywords:list}});notice('本店关键词已保存。')}else{await b.execute({action:'save-config',screenId:'UX08',values:{handoffKeywords:list}});notice('全局转人工关键词已保存。')}delete drafts.current[draftKey]}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 const inherit=async()=>{if(pending||!storeId)return;setPending(true);setError('');try{await b.execute({action:'save-store-handoff',storeId,values:{mode:'inherit'}});delete drafts.current[draftKey];setKeywords(global.join('，'));notice('已恢复使用全局关键词。')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setPending(false)}};
 const changeScope=()=>{const nextGlobal=!globalMode;setGlobalMode(nextGlobal);const nextKey=nextGlobal?'global':selectedStore;setKeywords(drafts.current[nextKey]??(nextGlobal?global:b.snapshot.handoffByStore?.[selectedStore]?.keywords||global).join('，'));setError('')};
 return <form id="handoff-keyword-settings" className="live-handoff-keywords" aria-label="转人工关键词设置" onSubmit={save}><label>转人工关键词<textarea aria-label="转人工关键词" value={keywords} disabled={pending} onChange={e=>{drafts.current[draftKey]=e.target.value;setKeywords(e.target.value)}}/></label><footer><span>{storeId?(custom?'本店单独设置':'本店使用全局关键词'):'全局关键词'}；逗号或换行分隔。</span><div>{selectedStore&&<button type="button" className="handoff-inherit" disabled={pending} onClick={changeScope}>{globalMode?'返回本店关键词':'编辑全局关键词'}</button>}{storeId&&<button type="button" className="handoff-inherit" disabled={pending||!custom} onClick={()=>void inherit()}>恢复全局关键词</button>}<button type="submit" disabled={pending}>{pending?'正在保存…':storeId?'保存本店关键词':'保存转人工关键词'}</button></div></footer>{error&&<p role="alert">{error}</p>}</form>;
}

function HandoffPage({notice,drafts}:{notice:(s:string)=>void;drafts:RefObject<Record<string,string>>}){
 const b=useBackend(),[switching,setSwitching]=useState(false),switchBusy=useRef(false);
 const selectStore=async(storeId:string)=>{if(switchBusy.current)return;switchBusy.current=true;setSwitching(true);try{await b.execute({action:'select-store',storeId})}catch(e){notice(e instanceof Error?e.message:String(e))}finally{switchBusy.current=false;setSwitching(false)}};
 return <section className="handoff-page" aria-label="转接人工配置"><header><h1>转接人工</h1><p>设置需要人工处理的关键词；当前会话会标记预警并暂停 AI。</p>{b.snapshot.stores.length>0&&<label className="handoff-store-picker">配置店铺<select aria-label="转人工配置店铺" value={b.snapshot.selection.storeId} disabled={switching} onChange={e=>void selectStore(e.target.value)}><option value="" disabled>请选择店铺</option>{b.snapshot.stores.map(s=><option key={s.id} value={s.id}>{storeDisplayName(s)}</option>)}</select></label>}</header>
  <article className="handoff-card"><div className="handoff-row"><div><h2>平台自动转接</h2><p>平台自动转接尚未接入，命中关键词后需要人工接手。</p></div><button type="button" role="switch" aria-label="平台自动转接" aria-checked={false} disabled>暂未接入</button></div></article>
  <article className="handoff-card"><h2>关键词触发</h2><p>买家消息包含关键词时，标记会话并暂停该会话的 AI 自动回复。</p>{b.loading?<p>正在读取关键词…</p>:b.error?<p role="alert">关键词读取失败，请稍后重试。</p>:<fieldset className="handoff-scope-fields" disabled={switching}><HandoffKeywords key={b.snapshot.selection.storeId||'global'} notice={notice} drafts={drafts}/></fieldset>}</article>
  <article className="handoff-card"><div className="handoff-row"><div><h2>客服接收与无人在线兜底</h2><p>客服名单、平台转接及无人在线兜底正在接入。</p></div><span>暂未接入</span></div></article>
 </section>;
}
