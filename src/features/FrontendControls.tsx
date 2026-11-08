import {createContext,useContext,useEffect,useLayoutEffect,useMemo,useReducer,useState} from 'react';
import type {ReactNode,CSSProperties} from 'react';
import type {FigmaLayer} from '../design/types';
import {createDraftStore,parseBannedWords} from './drafts.mjs';
import {useBackend} from './BackendProvider';
import {frontendServices} from '../services/demo';
import type {FrontendServices,FrontendCommand,FrontendResult} from '../services/contracts';

export type ControlBinding={kind:'text'|'textarea'|'switch'|'tags'|'tasks';field:string;label:string;max?:number;initial?:string|boolean;placeholder?:string;disabled?:boolean};
export type TaskSourceRender=(options:{componentId:string;onAction:(label:string)=>void;renderLayer:(layer:FigmaLayer)=>ReactNode|undefined})=>ReactNode;
const fields:Record<string,Omit<ControlBinding,'kind'>&{kind?:ControlBinding['kind']}>= {
 '11:67':{field:'search',label:'搜索账号 / 平台'},'8801:162':{field:'search',label:'搜索账号 / 平台'},
 '8801:318':{field:'search',label:'搜索店铺或分组'},'8801:1468':{kind:'textarea',field:'prompt',label:'识别提示词',max:300},
 '8801:1487':{kind:'switch',field:'enabled',label:'启用图片识别提示',initial:false},
 '8801:1623':{field:'storeQuery',label:'搜索店铺 / 平台'},'8801:1644':{field:'packageQuery',label:'搜索意图包'},
 '8801:1646':{field:'packageQuery2',label:'搜索意图包分组'},'8801:1649':{field:'intentQuery',label:'搜索意图'},
 '8801:1820':{kind:'textarea',field:'message',label:'训练问题',placeholder:'以买家身份输入问题',max:2000},
 '8801:1894':{kind:'textarea',field:'prompt',label:'模型规则',max:1400},'8801:1964':{field:'storeQuery',label:'搜索店铺 / 平台'},
 '8801:2127':{kind:'textarea',field:'word',label:'禁用词',placeholder:'禁用词，如：微信',max:1000},'8801:2125':{field:'replacement',label:'替换成',placeholder:'替换成（空=删除）',max:200},
 '8801:2129':{field:'search',label:'搜索禁用词',placeholder:'搜索禁用词…'},'8801:2140':{kind:'tags',field:'items',label:'禁用词列表'},
 '8801:2205':{field:'search',label:'搜索订单、买家或负责人'},'8801:2372':{field:'storeQuery',label:'搜索质检店铺'},
 '8801:2752':{field:'memberQuery',label:'搜索手机号或备注名'},
 '8801:2834':{field:'reply',label:'回复内容',placeholder:'选择会话后可输入回复',disabled:true},
 '8801:2854':{field:'reply',label:'预警回复',placeholder:'选择预警后可输入回复',disabled:true},
 '8801:2945':{field:'reply',label:'回复内容',placeholder:'输入回复内容',max:2000},
 '8801:2640':{kind:'switch',field:'filterLinks',label:'AI回复链接过滤',initial:true},
 '8801:2645':{kind:'switch',field:'dockClient',label:'客户端版本吸附',initial:true},
 'I8801:2637;8801:2632':{kind:'switch',field:'includeHumanHistory',label:'使用人工客服对话历史',initial:false},
 'I8801:2643;8801:2632':{kind:'switch',field:'reasoning',label:'是否推理',initial:false},
};
function texts(n:FigmaLayer):string[]{if(n.props.visible===false)return [];return n.type==='TEXT'?[String(n.props.text||'')]:n.children.flatMap(texts);}
export function controlBinding(n:FigmaLayer):ControlBinding|undefined{
 if(n.name==='欢迎语 / 输入文本')return {kind:'textarea',field:'welcome',label:'欢迎语',max:200,initial:String(n.props.text||'')};
 if(n.props.size?.x===520&&n.props.size?.y===410&&n.props.componentId)return {kind:'tasks',field:'tasks',label:'定时任务'};
 const found=fields[n.id];if(!found)return;
 const initial=found.initial??(n.id==='8801:1894'?texts(n).join('\n'):'');
 return {...found,kind:found.kind||'text',initial,placeholder:n.type==='TEXT'?String(n.props.text||found.placeholder||found.label):found.placeholder||(found.kind==='textarea'?texts(n).join('\n'):found.label)};
}
export function buttonLabel(n:FigmaLayer):string{
 if(n.type==='TEXT')return '';
 const text=texts(n).join('').trim();
 if((n.props.size?.y||0)>60||(n.props.size?.x||0)>350)return '';
 return text.length<35?text:'';
}
export function isFrontendAction(n:FigmaLayer){const label=buttonLabel(n);return /^保存/.test(label)||/^(放弃|放弃更改|还原|恢复已保存内容|添加|清空|默认问候|热情问候|预览效果|发送|刷新|同步到其他店铺|同步他店|同步其他店铺|复制方案|删除方案|预览模板|重命名|AI 润化|纠错|\+新建方案)$/.test(label);}
export function isFrontendDisabled(n:FigmaLayer,screen:string){return ['UX26','UX27'].includes(screen)&&buttonLabel(n)==='发送';}

type Controller={drafts:ReturnType<typeof createDraftStore>;scope:(screen:string)=>string;handle:(n:FigmaLayer,screen:string)=>boolean;notice:(text:string)=>void;submit:(command:Omit<FrontendCommand,'storeId'|'requestId'>)=>Promise<FrontendResult>};
const Context=createContext<Controller|null>(null);
function useController(){const value=useContext(Context);if(!value)throw Error('Frontend controls require provider');return value;}
function useDraft(screen:string){const c=useController();const [,tick]=useReducer(n=>n+1,0);useLayoutEffect(()=>c.drafts.subscribe(tick),[c]);return {controller:c,key:c.scope(screen),entry:c.drafts.get(c.scope(screen))};}

export function FrontendProvider({children,onNotice,onOverlay,services=frontendServices}:{children:ReactNode;onNotice:(s:string)=>void;onOverlay?:(id:string)=>void;services?:FrontendServices}){
 const backend=useBackend();const selectedStore=backend.snapshot.selection.storeId;
 const [drafts]=useState(()=>{const d=createDraftStore();if(backend.available)d.seed('UX17:account',{prompt:backend.snapshot.config.ai.systemPrompt});d.seed('UX11:demo-store-001',{enabled:false,welcomeTemplate:'default'});return d});
 useEffect(()=>{if(backend.available)drafts.hydrate('UX17:account',{prompt:backend.snapshot.config.ai.systemPrompt})},[backend.available,backend.snapshot.config.ai.systemPrompt,drafts]);
 const c=useMemo<Controller>(()=>{
  const scope=(screen:string)=>screen+':'+(['UX19','UX24','tasks',...(backend.available?['UX17']:[])].includes(screen)?'account':(backend.available?selectedStore:'demo-store-001'));
  const submit:Controller['submit']=async command=>{const result=await (backend.available?backend.execute({...command,storeId:selectedStore,conversationId:backend.snapshot.selection.conversationId}):services.execute({...command,storeId:'demo-store-001',requestId:crypto.randomUUID()}));if(result.status==='not-connected')throw Error(result.message||'服务尚未接入');return result;};
  return {drafts,scope,submit,notice:onNotice,handle(n,screen){
   const label=buttonLabel(n),key=scope(screen);
   if(backend.available){
    if(/^(复制方案|删除方案|预览模板|重命名|AI 润化|纠错|\+新建方案)$/.test(label)){onNotice('该功能的后端能力尚未接入。');return true;}
    const operations:Record<string,string>={'一键上线':'open','一键加载店铺':'open','一键离线':'close','一键小休':'pause','一键开启AI':'enable','一键关闭AI':'disable'};
    const operation=Object.entries(operations).find(([name])=>label===name||n.name.endsWith(name))?.[1];
    if(operation){void backend.execute({action:'batch',values:{operation}}).then(r=>onNotice(r.message||'操作完成')).catch(e=>onNotice(e.message));return true;}
    if(screen==='UX08'&&/^保存/.test(label)){backend.setSettings(true);return true;}
    if(/^同步/.test(label)){onNotice('当前模型与转人工配置为全局设置，其它页面的跨店同步尚未接入。');return true;}
   }
   if(screen==='UX11'&&n.name==='欢迎开关 / 热区')drafts.edit(key,{enabled:!drafts.get(key).draft.enabled});
   const toggles:Record<string,[string,boolean]>={'切换转人工总开关':['enabled',true],'切换自动收藏重要会话':['autoCollect',true],'切换智能转接':['smartTransfer',true],'切换无人在线兜底':['offlineFallback',true]};
   if(toggles[n.name]){const [field,initial]=toggles[n.name];drafts.edit(key,{[field]:!(drafts.get(key).draft[field]??initial)});}
   if(label==='默认问候'||label==='热情问候')drafts.edit(key,{welcomeTemplate:label==='热情问候'?'warm':'default',welcome:label==='默认问候'?'亲亲您好，欢迎光临本店，请问有什么可以帮您～':'亲亲您好，欢迎来到本店！看中的商品可直接发给我，为您介绍～'});
   if(screen==='UX11'&&label==='预览效果'&&onOverlay){const e=drafts.get(key);const warm=e.draft.welcomeTemplate==='warm',enabled=Boolean(e.draft.enabled);const ids=warm?(enabled?['8851:7326','8851:7344']:['8851:7290','8851:7308']):(enabled?['8851:7254','8851:7272']:['8851:7218','8851:7236']);onOverlay(ids[e.dirty?1:0]);return true;}
   if(/^(放弃|放弃更改|还原|恢复已保存内容)$/.test(label)){drafts.restore(key);onNotice('已恢复最近保存的前端配置。');return false;}
   if(screen==='UX19'&&label==='添加'){
    const v=drafts.get(key).draft;const input=String(v.word||'');if(!input.trim()){onNotice('请先输入禁用词。');return true;}
    const parsed=parseBannedWords(input);if(parsed.length===1&&v.replacement)parsed[0].replacement=String(v.replacement);
    const merged=new Map(((v.items||[]) as {word:string;replacement:string}[]).map(x=>[x.word,x]));for(const item of parsed)merged.set(item.word,item);
    drafts.edit(key,{items:[...merged.values()],word:'',replacement:''});return true;
   }
   if(screen==='UX19'&&label==='清空'){drafts.edit(key,{items:[]});return true;}
   const save=/^保存/.test(label);const serviceAction=save?'save-config':label==='发送'?(screen==='UX16'?'start-training':'send-reply'):label==='刷新'?'refresh':/^同步/.test(label)?'sync-config':'';
   if(label==='发送'&&!String(drafts.get(key).draft[screen==='UX16'?'message':'reply']||'').trim()){onNotice('请先输入发送内容。');return true;}
   if(serviceAction){
    const execute=async(values:Record<string,unknown>)=>{
     const result=await submit({action:serviceAction,screenId:screen,sourceNodeId:n.id,values});
     onNotice(result.message||'操作完成。');return result;
    };
    if(save)void drafts.save(key,execute).catch(error=>onNotice(error.message));else void execute(drafts.get(key).draft).catch(error=>onNotice(error.message));
    return backend.available;
   }
   return false;
  }};
 },[onNotice,onOverlay,services,backend.available,backend.execute,selectedStore,backend.snapshot.selection.conversationId,drafts]);
 return <Context.Provider value={c}>{children}</Context.Provider>;
}
export function useFrontendActions(){return useController().handle;}

export function BoundControl({binding,screenId,sourceNodeId,onClose,children,inputStyle,renderTaskSource}:{binding:ControlBinding;screenId:string;sourceNodeId:string;onClose?:()=>void;children?:ReactNode;inputStyle?:CSSProperties;renderTaskSource?:TaskSourceRender}){
 const {controller:c,key,entry}=useDraft(screenId);const initial=binding.initial??'';
 useEffect(()=>{if(binding.kind!=='tags'&&binding.kind!=='tasks')c.drafts.seed(key,{[binding.field]:initial});},[c,key,binding.field,initial,binding.kind]);
 const value=entry.draft[binding.field]??initial;
 const edit=(v:unknown)=>c.drafts.edit(key,{[binding.field]:v});
 if(binding.kind==='tasks')return <TaskManager onClose={onClose} renderSource={renderTaskSource}/>;
 if(binding.kind==='tags'){
  const items=(entry.draft.items||[]) as {word:string;replacement:string}[];const query=String(entry.draft.search||'').toLowerCase();const visible=items.filter(x=>x.word.toLowerCase().includes(query));
  if(!items.length&&children)return <>{children}</>;
  return <div className="banned-tags">{!items.length?<div className="banned-empty"><b>还没有禁用词</b><p>在上方输入后点添加，或直接粘贴一批词</p></div>:visible.length?visible.map(x=><span className="banned-tag" key={x.word}>{x.word}{x.replacement?' → '+x.replacement:''}<button aria-label={'删除禁用词 '+x.word} onClick={()=>edit(items.filter(y=>y.word!==x.word))}>×</button></span>):<p className="banned-empty">没有匹配的禁用词</p>}</div>;
 }
 if(binding.kind==='switch')return <button type="button" className={'bound-switch '+(value?'is-on':'')} style={{background:value===initial?'transparent':value?'#347fff':'#dce0e6',borderRadius:'inherit'}} role="switch" aria-label={binding.label} aria-checked={Boolean(value)} onClick={e=>{e.stopPropagation();edit(!value)}}>{value!==initial&&Boolean(value)&&<span/>}</button>;
 const common={value:String(value),disabled:binding.disabled,'aria-label':binding.label,placeholder:binding.placeholder,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>edit(binding.max?Array.from(e.target.value).slice(0,binding.max).join(''):e.target.value),onClick:(e:React.MouseEvent)=>e.stopPropagation(),onKeyDown:(e:React.KeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{
  if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||e.key!=='Enter'||e.shiftKey||!['message','reply'].includes(binding.field))return;e.preventDefault();e.stopPropagation();
  if(!String(value).trim()){c.notice('请先输入发送内容。');return;}
  void c.submit({action:screenId==='UX16'?'start-training':'send-reply',screenId,sourceNodeId,values:entry.draft}).then(result=>{c.notice(result.message||'请求完成。');if(result.status==='ok'&&c.drafts.get(key).draft[binding.field]===value)edit('');}).catch(error=>c.notice(error.message));
 }};
 const field=binding.kind==='textarea'?<textarea {...common} style={inputStyle} className="bound-field bound-textarea"/>:<input {...common} style={inputStyle} type="text" className="bound-field"/>;
 return children?<div className={'source-control '+(String(value)!==String(initial)?'is-edited':'')}><div className="source-control-art" aria-hidden="true">{children}</div>{field}</div>:field;
}

export function BoundText({text,screenId}:{text:string;screenId:string}){
 const {entry}=useDraft(screenId);let value=text;
 if(screenId==='UX11'){
  if(text.startsWith('亲亲'))value=String(entry.draft.welcome??text);
  if(/^\d+\/200$/.test(text))value=Array.from(String(entry.draft.welcome||'')).length+'/200';
  if(text.includes('已保存')&&entry.dirty)value=text.replace('已保存','待保存');
 }
 if(screenId==='UX14'&&/^\d+\/300$/.test(text))value=Array.from(String(entry.draft.prompt||'')).length+'/300';
 if(screenId==='UX17'&&/^\d+\s*\/\s*1400$/.test(text))value=Array.from(String(entry.draft.prompt||'')).length+' /1400';
 if(screenId==='UX19'&&text.startsWith('0 个标签'))value=((entry.draft.items||[]) as unknown[]).length+' 个标签　长词优先匹配 · 点标签可改 · ×';
 return <>{value}</>;
}

function TaskManager({onClose,renderSource}:{onClose?:()=>void;renderSource?:TaskSourceRender}){
 type Task={id:string;name:string;time:string;repeat:string;action:string};
 const {controller:c,key,entry}=useDraft('tasks');const items=(entry.draft.items||[]) as Task[];
 const [mode,setMode]=useState<'list'|'edit'|'delete'>('list');const [index,setIndex]=useState(-1);const [name,setName]=useState('');const [time,setTime]=useState('09:00');const [repeat,setRepeat]=useState('每天');const [action,setAction]=useState('一键上线');const [error,setError]=useState('');const [pending,setPending]=useState(false);
 const edit=(i:number)=>{setIndex(i);setName(items[i]?.name||'');setTime(items[i]?.time||'09:00');setRepeat(items[i]?.repeat||'每天');setAction(items[i]?.action||'一键上线');setError('');setMode('edit');};
 const persist=async(next:Task[])=>{setPending(true);setError('');try{const result=await c.submit({action:'save-tasks',screenId:'tasks',sourceNodeId:'scheduled-task-editor',values:{items:next}});c.drafts.edit(key,{items:next});setIndex(-1);setMode('list');c.notice(result.status==='demo'?'定时任务已保存为前端演示，实际调度待接入。':'定时任务已保存。');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}};
 const save=(e:React.FormEvent)=>{e.preventDefault();if(!name.trim()){setError('请填写任务名称后保存。');return;}if(!time){setError('请选择执行时间后保存。');return;}const next={id:items[index]?.id||crypto.randomUUID(),name:name.trim(),time,repeat,action};void persist(index<0?[...items,next]:items.map((x,i)=>i===index?next:x));};
 if(renderSource){
  const item=items[index>=0?index:0];
  const componentId=mode==='list'?(items.length?'8842:7071':'8842:7004'):mode==='delete'?'8842:7091':error?'8842:7035':index>=0?'8842:7106':'8842:7017';
  const onAction=(label:string)=>{if(pending)return;if(label==='关闭'||label==='关闭定时任务'||label==='完成')onClose?.();else if(label==='新建任务')edit(-1);else if(label==='取消')setMode('list');else if(label==='编辑')edit(0);else if(label==='删除'){setIndex(0);setMode('delete');}else if(label==='确认删除')void persist(items.filter((_,i)=>i!==index));else if(/^保存/.test(label))save({preventDefault(){}} as React.FormEvent);};
  const renderLayer=(n:FigmaLayer):ReactNode|undefined=>{
   if(n.name==='任务名称输入框')return <input className="task-native-name" aria-label="任务名称" disabled={pending} value={name} maxLength={40} placeholder="请输入任务名称" onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();onAction('保存任务');}}}/>;
   if(n.name==='任务参数')return <div className="task-native-parameters"><label><span>执行动作</span><select aria-label="操作类型" disabled={pending} value={action} onChange={e=>setAction(e.target.value)}><option>一键上线</option><option>一键离线</option></select></label><label><span>执行时间</span><input type="time" aria-label="执行时间" disabled={pending} value={time} onChange={e=>setTime(e.target.value)}/></label><label><span>重复方式</span><select aria-label="重复方式" disabled={pending} value={repeat} onChange={e=>setRepeat(e.target.value)}><option>每天</option><option>工作日</option><option>仅一次</option></select></label></div>;
   if(n.name==='字段提示'&&error)return <span role="alert">{error}</span>;
   if(mode==='list'&&n.name==='任务名称')return item?.name||'';
   if(mode==='list'&&n.name==='任务设置')return `${item?.repeat} ${item?.time} · ${item?.action}`;
   if(mode==='delete'&&n.name==='确认说明')return `“${item?.name}”将从任务列表中移除。`;
   if(mode==='list'&&n.name==='内容'&&items.length>1)return <div className="task-native-list">{items.map((task,i)=><article key={task.id}><b>{task.name}</b><span>{task.repeat} {task.time} · {task.action}</span><div><button onClick={()=>edit(i)}>编辑</button><button onClick={()=>{setIndex(i);setMode('delete')}}>删除</button></div></article>)}</div>;
   return undefined;
  };
  return <div className="task-source-host" aria-busy={pending}>{renderSource({componentId,onAction,renderLayer})}{mode==='list'&&items.length>0&&<button className="task-native-new" onClick={()=>edit(-1)}>新建任务</button>}</div>;
 }
 throw Error("Missing editable Figma task renderer");
}
