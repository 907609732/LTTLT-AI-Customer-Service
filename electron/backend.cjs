const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ManagedSessionError}=require('./managed-session.cjs');
const fs=require('node:fs');
const {z}=require('zod');
const {Config}=require('../desk-v1/src/main/config');
const {StoreRegistry}=require('../desk-v1/src/main/store-registry');
const {SecretStore}=require('../desk-v1/src/main/secrets');
const {Logger}=require('../desk-v1/src/main/logger');
const {AiClient}=require('../desk-v1/src/main/ai-client');
const {ReplyEngine,filterBannedWords}=require('../desk-v1/src/main/reply-engine');
const {MessageMonitor}=require('../desk-v1/src/main/message-monitor');
const {readJson,writeJson}=require('../desk-v1/src/main/json-store');
const {createWorkOrders}=require('./work-orders.cjs');
const {createAuxiliaryState}=require('./auxiliary-state.cjs');
const platforms=[{id:'pdd-web',label:'拼多多'},{id:'doudian-client',label:'抖店'}];
const Command=z.object({action:z.string().min(1).max(60),screenId:z.string().max(30).optional(),storeId:z.string().max(64).optional(),conversationId:z.string().max(200).optional(),values:z.record(z.string(),z.unknown()).optional()});
function createBackend({dataDir,onEvent=()=>{},adapterFactory,managerFactory,aiClient,safeStorage,fetchImpl,openExternal,modelMode='local',managedChat,managedReady=()=>{},allowExternalClient=true,externalClientReady=()=>{}}={}){
 if(!dataDir)throw Error('data_directory_required');
 const logger=new Logger({dir:path.join(dataDir,'logs'),console:false});
 const config=new Config({file:path.join(dataDir,'config.json'),logger});
 const registry=new StoreRegistry({file:path.join(dataDir,'stores.json'),logger});
 const handoffFile=path.join(dataDir,'store-handoff.json');
 const keywordsSchema=z.array(z.string().trim().min(1).max(30)).max(100);
 const handoffSchema=z.object({version:z.literal(1),stores:z.record(z.string(),z.object({keywords:keywordsSchema}).strict())}).strict();
 let handoff={version:1,stores:{}};
 if(fs.existsSync(handoffFile)){
  try{handoff=handoffSchema.parse(JSON.parse(fs.readFileSync(handoffFile,'utf8')))}catch{throw Error('店铺转人工配置损坏，请恢复备份后重试；原文件未改动')}
 }
 const bannedFile=path.join(dataDir,'ai-banned-words.json');
 const bannedRulesSchema=z.array(z.object({word:z.string().trim().min(1).max(100),replacement:z.string().max(200)}).strict()).max(500).superRefine((rules,ctx)=>{const seen=new Set();for(const rule of rules){if(seen.has(rule.word))ctx.addIssue({code:'custom',message:'禁用词不能重复'});seen.add(rule.word)}for(const rule of rules)if(rules.some(other=>rule.replacement.includes(other.word)))ctx.addIssue({code:'custom',message:'替换内容不能包含禁用词'})});
 const bannedFileSchema=z.object({version:z.literal(1),rules:bannedRulesSchema}).strict();
 let bannedWords=[];
 if(fs.existsSync(bannedFile)){try{bannedWords=bannedFileSchema.parse(JSON.parse(fs.readFileSync(bannedFile,'utf8'))).rules}catch{throw Error('AI 禁用词配置损坏，请恢复备份后重试；原文件未改动')}}
 const workOrders=createWorkOrders(path.join(dataDir,'work-orders.json'));
 const auxiliary=createAuxiliaryState(path.join(dataDir,'auxiliary-state.json'));
 const secrets=new SecretStore({file:path.join(dataDir,'secrets.json'),safeStorage});
 config.update({reply:{enabled:false}});for(const s of registry.list())if(s.aiEnabled)registry.setAi(s.id,false);
 const archiveFile=path.join(dataDir,'conversations.json');
 let conversations=readJson(archiveFile,[]);if(!Array.isArray(conversations))conversations=[];
 conversations=conversations.filter(c=>registry.get(c.storeId)&&typeof c.uid==='string'&&Array.isArray(c.messages)).slice(-200);
 let selection={storeId:registry.list()[0]?.id||'',conversationId:''},revision=0,disposed=false,modelSaving=false,manager,engine,monitor;
 const collectionErrors=new Map();
 const adapters=new Map(),sending=new Set(),aiEpoch=new Map(),starting=new Set(),opening=new Set(),openEpoch=new Map();
 const generations=new Set(),probes=new Set();
 const issueFile=path.join(dataDir,'managed-model-issue.json');
 const reviewCodes=new Set(['request_pending','request_uncertain','request_conflict','result_expired','request_failed','offline','canceled','invalid_response','delivery_unconfirmed','delivery_failed','delivery_blocked','generation_failed']);
 function safeIssue(code,at=Date.now(),context){
  const e=new ManagedSessionError(code);
  const result={code:e.code,kind:e.kind,message:e.message,requiresReview:reviewCodes.has(e.code),at:Number.isSafeInteger(at)&&at>0?at:Date.now()};
  if(context&&typeof context==='object'){
   const detail={};
   for(const [key,max] of Object.entries({storeId:64,uid:200,storeName:120,buyerName:120,buyerMessage:3000,reply:3000,requestId:100})){
    if(typeof context[key]==='string')detail[key]=context[key].slice(0,max);
   }
   if((detail.storeId&&detail.uid)||detail.requestId)result.context=detail;
  }
  return result;
 }
 const savedIssue=modelMode==='managed'?readJson(issueFile,null):null;
 let modelIssue=savedIssue?safeIssue(savedIssue.code,savedIssue.at,savedIssue.context):null;
 function retainIssue(e,context){
  const next=safeIssue(e?.code,Date.now(),context);
  if(modelIssue&&(modelIssue.requiresReview||!next.requiresReview))return;
  modelIssue=next;
  try{writeJson(issueFile,{code:next.code,at:next.at,...(next.context?{context:next.context}:{})});}
  catch{modelIssue.message+=' 本机未能保存暂停提示，请在重启前核对原请求。';}
 }
 const adapterFor=store=>{if(!adapters.has(store.id)){if(!adapterFactory)throw Error('平台服务尚未就绪');adapters.set(store.id,adapterFactory(store,{config:config.all(),logger}));}return adapters.get(store.id)};
 const snapshot=()=>structuredClone({revision,modelIssue,auxiliary:auxiliary.snapshot(),stores:registry.list().map(s=>({...s,runtime:{...(manager?.stateOf?.(s.id)||{open:false,online:false}),collectionError:collectionErrors.get(s.id)||''}})),config:config.all(),bannedWords,workOrders:workOrders.list(),handoffByStore:Object.fromEntries(Object.entries(handoff.stores).filter(([id])=>registry.get(id))),engine:engine?.status()||{},conversations,selection,capabilities:{platforms,externalClientAllowed:allowExternalClient,modelMode,apiKeyConfigured:secrets.has('ai.apiKey'),supportedScreens:['UX08','UX16','UX17','UX19','UX20']}});
 function changed(){if(disposed)return;revision++;onEvent({type:'backend:changed',revision});}
 async function startCollection(id){
  const state=manager.stateOf(id);
  if(!state?.open||state.authenticated===false||state.authenticated===null)return;
  await monitor.start(id);
  const after=manager.stateOf(id);
  if(disposed||!registry.get(id)||!after?.open||after.authenticated===false||after.authenticated===null)monitor.stop(id);
 }
 function ingest(event){
  if(disposed)return;
  const store=registry.get(event.storeId);
  if(store&&event.type==='shop:login_state'&&event.authenticated===true&&event.online)void startCollection(store.id).catch(()=>{});
  if(store&&(['shop:navigating','shop:crash','shop:open_failed','shop:account_changed'].includes(event.type)||(event.type==='shop:login_state'&&event.authenticated===false))){
   aiEpoch.set(store.id,(aiEpoch.get(store.id)||0)+1);
   monitor?.stop(store.id);engine?.stopStore(store.id);registry.setAi(store.id,false);collectionErrors.delete(store.id);
   const adapter=adapters.get(store.id);if(adapter)void adapter.syncAiEnabled(false).catch(()=>{});
  }
  if(store&&event.type==='collection:lost')collectionErrors.set(store.id,String(event.reasonText||'消息采集中断'));
  if(store&&['collection:resumed','shop:closed'].includes(event.type))collectionErrors.delete(store.id);
  if(store&&((event.type==='message:in'&&['buyer','seller'].includes(event.from))||event.type==='reply:sent')){
   const uid=String(event.uid||'');if(!uid)return;
   let c=conversations.find(x=>x.storeId===store.id&&x.uid===uid);
   if(!c){c={storeId:store.id,uid,name:String(event.username||uid).slice(0,100),messages:[],status:'pending'};conversations.push(c);}
   const from=event.type==='reply:sent'?'seller':event.from,content=String(event.content??event.text??'').slice(0,10000),ts=Number(event.ts)||Date.now();
   const msgId=String(event.msgId||'');
   const duplicate=c.messages.some(m=>msgId?m.msgId===msgId:m.from===from&&m.content===content&&Math.abs(m.ts-ts)<8000);
   if(!duplicate&&from==='buyer')auxiliary.reveal({storeId:store.id,uid});
   if(!duplicate){c.messages.push({from,content,ts,msgId});if(ts>=(c.updatedAt||0)){if(c.status!=='handoff'||event.manual)c.status=from==='buyer'?'pending':'replied';c.updatedAt=ts;}}
   if(event.manual&&from==='seller'&&ts>=(c.updatedAt||0)){c.status='replied';c.updatedAt=ts;}
   c.messages=c.messages.slice(-100);
   conversations=conversations.slice(-200);writeJson(archiveFile,conversations);
  }
  if(store&&['reply:transfer','reply:needs-manual'].includes(event.type)){const c=conversations.find(c=>c.storeId===store.id&&c.uid===String(event.uid));if(c)c.status='handoff';engine?.worker(store.id)?.takeOver(String(event.uid));writeJson(archiveFile,conversations);}
  if(store&&event.type==='shop:closed'){openEpoch.set(store.id,(openEpoch.get(store.id)||0)+1);aiEpoch.set(store.id,(aiEpoch.get(store.id)||0)+1);engine?.stopStore(store.id);monitor?.stop(store.id);registry.setAi(store.id,false);}
  changed();
 }
 manager=managerFactory?.({registry,config,adapterFor,logger,onEvent:ingest})||{stateOf:()=>({open:false,online:false}),closeAll(){}};
 const modelClient=aiClient||new AiClient({getConfig:()=>config.all(),logger,secretReader:n=>secrets.get(n),fetchImpl});
 if(modelMode==='managed'){
  modelClient.suppressFallback=true;
  modelClient.onGenerationFailure=(error,context)=>{if(disposed)return;retainIssue(new ManagedSessionError(error?.code||'generation_failed'),{...context,storeName:registry.get(context?.storeId)?.storeName||''});stopAi();};
  modelClient.onDeliveryFailure=result=>{if(disposed)return;retainIssue(new ManagedSessionError(result.reason==='send_unconfirmed'?'delivery_unconfirmed':result.throttled?'delivery_blocked':'delivery_failed'),{...result,storeName:registry.get(result.storeId)?.storeName||''});stopAi();};
  let managedQueue=Promise.resolve();
  modelClient.complete=({messages,timeoutMs,reviewContext,isCurrent})=>{
   const operation=managedQueue.then(async()=>{
   if(disposed)throw Error('服务已关闭');
   if(typeof isCurrent==='function'&&!isCurrent())throw Object.assign(Error('排队任务已取消'),{code:'queued_canceled'});
   if(modelIssue)throw new ManagedSessionError(modelIssue.code);
   if(!managedChat)throw Error('托管服务尚未连接');
   const c=new AbortController();generations.add(c);const timer=setTimeout(()=>c.abort(),timeoutMs||60000);timer.unref?.();
   const requestId=randomUUID();
   try{managedReady();const result=await managedChat({client_request_id:requestId,messages},{signal:c.signal});if(disposed||c.signal.aborted)throw Error('生成已取消');const content=result?.choices?.[0]?.message?.content;if(typeof content!=='string'||!content.trim())throw Error('托管模型未返回可用回复');return content;}
   catch(e){if(!disposed){retainIssue(e,{...reviewContext,requestId,storeName:registry.get(reviewContext?.storeId)?.storeName||''});stopAi();}throw e;}
   finally{clearTimeout(timer);generations.delete(c);}
   });
   managedQueue=operation.catch(()=>{});return operation;
  };
 }
 engine=new ReplyEngine({registry,adapterFactory:adapterFor,aiClient:modelClient,getConfig:(storeId)=>{const current=config.all(),entry=handoff.stores[storeId];return {...current,safety:{...current.safety,bannedWords,...(entry?{handoffKeywords:entry.keywords}:{})}};},logger,onEvent:ingest});
 monitor=new MessageMonitor({registry,adapterFactory:adapterFor,getConfig:()=>config.all(),logger,onEvent:ingest});
 function storeOf(id){const s=registry.get(id);if(!s)throw Error('请先选择有效店铺');return s;}
 function stopAi(){for(const c of generations)c.abort();generations.clear();engine.stopAll();for(const s of registry.list()){aiEpoch.set(s.id,(aiEpoch.get(s.id)||0)+1);if(s.aiEnabled)registry.setAi(s.id,false);}config.update({reply:{enabled:false}});changed();}
 async function setAi(id,enabled){
  const store=storeOf(id);
  if(enabled&&starting.has(id))throw Error('AI正在切换，请稍候');
  const epoch=(aiEpoch.get(id)||0)+1;aiEpoch.set(id,epoch);
  if(!enabled){engine.stopStore(id);registry.setAi(id,false);const a=adapters.get(id);if(a)await a.syncAiEnabled(false);return;}
  if(modelMode==='managed'&&modelIssue)throw Error('请先核对托管请求状态并确认清除提示，再手动开启 AI。');
  if(!manager.stateOf(id)?.open)throw Error('请先打开店铺并登录');
  if(modelMode==='managed')managedReady();else if(!config.all().ai.baseUrl.trim())throw Error('请先配置模型接口地址');
  registry.setAi(id,true);config.update({reply:{enabled:true}});
  starting.add(id);try{await engine.startStore(store.id);if(disposed||aiEpoch.get(id)!==epoch){engine.stopStore(id);await adapterFor(store).syncAiEnabled(false);throw Error('AI开启操作已取消');}}catch(e){registry.setAi(id,false);engine.stopStore(id);throw e;}finally{starting.delete(id);}
 }
 async function execute(raw){
  if(disposed)throw Error('服务已关闭');const command=Command.parse(raw);const v=command.values||{};let data={},message='操作完成。';
  switch(command.action){
   case 'add-store':if(!platforms.some(p=>p.id===v.platform))throw Error('该平台尚未接入');if(v.platform==='doudian-client'){externalClientReady();if(!allowExternalClient)throw Error('请在添加抖店时确认绑定本机抖店客户端。');}data=registry.add(v);selection={storeId:data.id,conversationId:''};message='店铺已添加，AI默认关闭。';if(v.platform==='pdd-web'&&v.openAfterAdd===true){changed();try{await execute({action:'open-store',storeId:data.id});data={...data,opened:true};message='已打开拼多多，请完成登录，店铺名称将自动识别。';}catch{data={...data,opened:false};message='店铺已添加，登录页打开失败，请点击打开重试。';}}break;
   case 'set-store-group':storeOf(command.storeId);registry.update(command.storeId,{group:z.string().trim().max(30).parse(v.group)});message='店铺分组已保存。';break;
   case 'remove-store':{
    const store=storeOf(command.storeId),id=store.id;
    if(v.confirmed!==true)throw Error('请先确认删除此店铺账号');
    if(opening.has(id)||starting.has(id)||[...sending].some(key=>key.startsWith(id+':')))throw Error('店铺正在打开、切换AI或发送回复，请操作结束后再删除');
    writeJson(path.join(dataDir,'removed-stores',encodeURIComponent(id)+'.json'),{removedAt:Date.now(),store,conversations:conversations.filter(c=>c.storeId===id)});
    openEpoch.set(id,(openEpoch.get(id)||0)+1);aiEpoch.set(id,(aiEpoch.get(id)||0)+1);
    engine.stopStore(id);monitor.stop(id);registry.setAi(id,false);manager.close?.(id);
    registry.remove(id);adapters.delete(id);collectionErrors.delete(id);monitor.retainedSeen.delete(id);
    conversations=conversations.filter(c=>c.storeId!==id);writeJson(archiveFile,conversations);
    if(selection.storeId===id)selection={storeId:registry.list()[0]?.id||'',conversationId:''};
    message='店铺账号已从本机移除。';break;
   }
   case 'select-store':storeOf(command.storeId);selection={storeId:command.storeId,conversationId:''};break;
   case 'save-store-handoff':{
    storeOf(command.storeId);
    const values=z.discriminatedUnion('mode',[z.object({mode:z.literal('inherit')}).strict(),z.object({mode:z.literal('custom'),keywords:keywordsSchema}).strict()]).parse(v);
    const stores={...handoff.stores};if(values.mode==='inherit')delete stores[command.storeId];else stores[command.storeId]={keywords:values.keywords};
    const next=handoffSchema.parse({version:1,stores});writeJson(handoffFile,next);handoff=next;
    message=values.mode==='inherit'?'已恢复使用全局关键词。':'本店关键词已保存。';break;
   }
   case 'save-banned-words':{const rules=bannedRulesSchema.parse(v.rules);writeJson(bannedFile,{version:1,rules});bannedWords=rules;message='AI 禁用词已保存，应用于全部店铺。';break;}
   case 'save-automation-fallback':{
    if(modelMode!=='local')throw Error('托管模型模式不支持超时兜底，避免请求状态未确认时重复发送。');
    const input=z.object({enabled:z.boolean(),seconds:z.number().int().min(1).max(120),text:z.string().trim().max(500)}).strict().parse(v);
    if(input.enabled&&!input.text)throw Error('开启兜底前请填写兜底话术。');
    config.update({reply:{fallbackAfterMs:input.enabled?input.seconds*1000:0,fallbackText:input.text}});message='自动回复兜底设置已保存，应用于全部店铺。';break;
   }
   case 'create-work-order':{const store=storeOf(v.storeId);const item=workOrders.create(v,store);data={id:item.id};message='工单已登记在本机。';break;}
   case 'set-work-order-status':{const input=z.object({id:z.string().uuid(),status:z.enum(['pending','working','waiting','done'])}).strict().parse(v);workOrders.status(input.id,input.status);message='工单状态已更新。';break;}
   case 'add-work-order-note':{const input=z.object({id:z.string().uuid(),text:z.string().trim().min(1).max(2000)}).strict().parse(v);workOrders.note(input.id,input.text);message='跟进记录已保存。';break;}
   case 'start-training':{
    if(modelMode==='managed'&&modelIssue)throw Error('请先核对托管请求状态并确认清除提示，再进行测试。');
    const input=z.object({question:z.string().trim().min(1).max(2000),history:z.array(z.object({from:z.enum(['buyer','seller']),content:z.string().min(1).max(2000)}).strict()).max(20)}).strict().parse(v);
    const thread=[...input.history.map(m=>({...m,type:'text'})),{from:'buyer',type:'text',content:input.question}];
    let result;try{result=await modelClient.reply({systemPrompt:config.all().ai.systemPrompt,thread,timeoutMs:config.all().ai.timeoutMs})}catch(error){if(modelMode==='managed'&&!disposed&&!modelIssue)modelClient.onGenerationFailure?.(error);const reason=String(error?.message||'');throw Error(modelMode==='managed'?'托管模型请求未完成，请查看界面上的托管 AI 提示。':reason==='ai_base_url_missing'?'请先配置模型接口地址':reason==='ai_api_key_missing'?'请先配置模型 API Key':/^ai_http_40[13]/.test(reason)?'模型密钥无效或没有访问权限':reason.startsWith('ai_http_402')?'模型账户余额不足':reason.startsWith('ai_http_429')?'模型请求受限，请稍后重试':reason==='llm_timeout'?'模型响应超时，请稍后重试':'模型连接失败，请检查模型设置和网络')}
    const reply=filterBannedWords(String(result.reply||''),bannedWords).trim().slice(0,config.all().reply.maxReplyChars).trim();
    if(!reply)throw Error('回复被禁用词过滤为空，请调整规则后重试');
    data={reply};message='模拟回复已生成。';break;
   }
   case 'save-auxiliary-state':{
    if(v.selected){storeOf(v.selected.storeId);if(!conversations.some(c=>c.storeId===v.selected.storeId&&c.uid===v.selected.uid))throw Error('会话不存在');}
    if(v.workOrderId&&!workOrders.list().some(o=>o.id===v.workOrderId))throw Error('工单不存在');
    auxiliary.update(v);break;
   }
   case 'save-auxiliary-draft':{storeOf(command.storeId);if(!conversations.some(c=>c.storeId===command.storeId&&c.uid===command.conversationId))throw Error('会话不存在');auxiliary.draft({storeId:command.storeId,uid:command.conversationId},v.text);break;}
   case 'hide-replied-conversations':{auxiliary.hide(v,conversations);break;}
   case 'focus-conversation':{
    const store=storeOf(command.storeId),uid=command.conversationId;
    if(!conversations.some(c=>c.storeId===store.id&&c.uid===uid))throw Error('会话不存在');
    selection={storeId:store.id,conversationId:uid};auxiliary.update({selected:{storeId:store.id,uid}});changed();
    if(!manager.stateOf(store.id)?.online)throw Error('店铺未连接，请先登录');
    const result=await adapterFor(store).focusConversation(uid);if(disposed)throw Error('服务已关闭');
    if(!result?.ok)throw Error('无法定位平台会话，请在店铺中检查');message='已定位会话';break;
   }
   case 'select-conversation':{storeOf(command.storeId);const c=conversations.find(c=>c.storeId===command.storeId&&c.uid===command.conversationId);if(!c)throw Error('会话不存在或尚未采集');selection={storeId:command.storeId,conversationId:c.uid};break;}
   case 'open-store':{const id=command.storeId;const target=storeOf(id);if(target.platform==='doudian-client'){externalClientReady();if(!allowExternalClient)throw Error('请在添加抖店时确认绑定本机抖店客户端。');}if(!manager.open)throw Error('平台窗口尚未就绪');if(opening.has(id))throw Error('店铺正在打开，请稍候');const epoch=(openEpoch.get(id)||0)+1;openEpoch.set(id,epoch);opening.add(id);try{await manager.open(id);if(disposed||openEpoch.get(id)!==epoch){manager.close(id);throw Error('打开店铺操作已取消');}await startCollection(id);if(disposed||openEpoch.get(id)!==epoch){monitor.stop(id);manager.close(id);throw Error('打开店铺操作已取消');}message='已打开店铺，请完成平台登录。';}finally{opening.delete(id);}break;}
   case 'restart-client':{externalClientReady();if(!allowExternalClient)throw Error('请先在登录账号页面确认本机抖店客户端的绑定。');const s=storeOf(command.storeId);if(s.platform!=='doudian-client'||!manager.restartClient)throw Error('该平台不支持重启客户端');data=await manager.restartClient(s.id);message='客户端已重启，正在重新连接。';break;}
   case 'close-store':storeOf(command.storeId);openEpoch.set(command.storeId,(openEpoch.get(command.storeId)||0)+1);aiEpoch.set(command.storeId,(aiEpoch.get(command.storeId)||0)+1);engine.stopStore(command.storeId);monitor.stop(command.storeId);registry.setAi(command.storeId,false);manager.close(command.storeId);break;
   case 'set-ai':await setAi(command.storeId,v.enabled===true);message=v.enabled?'AI已开启。':'AI已关闭。';break;
   case 'pause-ai':storeOf(command.storeId);if(!engine.pause(command.storeId))throw Error('该店铺AI尚未运行');break;
   case 'resume-ai':storeOf(command.storeId);if(!engine.resume(command.storeId))throw Error('该店铺AI尚未运行');break;
   case 'batch':{const results=[];for(const s of registry.list()){try{if(v.operation==='open')await execute({action:'open-store',storeId:s.id});else if(v.operation==='pause')await execute({action:'pause-ai',storeId:s.id});else if(v.operation==='close')await execute({action:'close-store',storeId:s.id});else if(['enable','disable'].includes(v.operation))await setAi(s.id,v.operation==='enable');else throw Error('不支持的批量操作');results.push({id:s.id,ok:true});}catch(e){results.push({id:s.id,ok:false,message:e.message});}}data={results};message=results.length?`操作完成：${results.filter(r=>r.ok).length}/${results.length}家成功。`:'尚未添加店铺。';break;}
   case 'save-config':if(command.screenId==='UX17'){config.update({ai:{systemPrompt:z.string().max(8000).parse(v.prompt)}});message='全局模型规则已保存。';}else if(command.screenId==='UX08'){config.update({safety:{handoffKeywords:z.array(z.string().min(1).max(30)).max(100).parse(v.handoffKeywords)}});message='全局转人工关键词已保存。';}else throw Error('该页面的后端能力尚未接入');break;
   case 'open-model-key-page':{const {modelProviders}=await import('../shared/model-providers.mjs');const provider=z.enum(['deepseek','qwen']).parse(v.provider);if(!openExternal)throw Error('浏览器打开功能尚未就绪');await openExternal(modelProviders[provider].keyUrl);message='已打开官方密钥页面。';break;}
   case 'save-model-settings':{
    if(modelMode!=='local')throw Error('请先明确切换为自己的 Key 模式');
    if(modelSaving)throw Error('模型设置正在保存，请稍后重试');
    modelSaving=true;try{
    const patch=z.object({baseUrl:z.string().trim().max(500),model:z.string().trim().min(1).max(120)}).parse(v);
    let url;try{url=new URL(patch.baseUrl)}catch{throw Error('模型接口地址无效')}
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('模型接口必须使用HTTPS或本机地址');
    if(url.username||url.password||url.search||url.hash)throw Error('接口地址不能包含凭据、查询参数或锚点');
    const apiKey=z.string().trim().max(1000).parse(v.apiKey??'');
    const sameEndpoint=patch.baseUrl.replace(/\/+$/,'')===config.all().ai.baseUrl.replace(/\/+$/,'');
    const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(!apiKey&&!sameEndpoint&&!local&&secrets.has('ai.apiKey'))throw Error('切换接口后请重新粘贴 API Key');
    const key=apiKey||(sameEndpoint?secrets.get('ai.apiKey'):'');
    if(v.testConnection===true&&!key&&!local)throw Error('请先粘贴 API Key');
    if(apiKey){const ss=safeStorage===undefined?require('electron').safeStorage:safeStorage;if(!ss?.isEncryptionAvailable?.())throw Error('系统加密存储不可用，未保存密钥');}
    if(v.testConnection===true){
     const client=new AiClient({getConfig:()=>({ai:{...config.all().ai,...patch,provider:'openai',maxTokens:32}}),secretReader:()=>key,fetchImpl});probes.add(client);
     try{await client.complete({messages:[{role:'user',content:'请回复 OK，用于测试连接。'}],timeoutMs:20000});}
     catch(e){const reason=String(e.message);throw Error(reason.startsWith('ai_http_401')||reason.startsWith('ai_http_403')?'密钥无效或没有模型权限，请检查 API Key。':reason.startsWith('ai_http_402')?'账户余额不足，请到官方平台检查。':reason.startsWith('ai_http_429')?'请求受限或额度不足，请稍后重试。':reason==='llm_timeout'?'连接超时，请检查网络后重试。':'连接失败，请检查网络、模型权限及高级设置中的接口地址。');}finally{client.dispose();probes.delete(client);}
    }
    if(disposed)throw Error('服务已关闭');
    if(apiKey)secrets.set('ai.apiKey',apiKey);else if(!sameEndpoint)secrets.remove('ai.apiKey');
    config.update({ai:{...patch,provider:'openai'}});message=v.testConnection===true?'连接成功，模型设置已保存。':'模型接口设置已保存。';
    }finally{modelSaving=false;}break;
   }
   case 'resume-conversation':{storeOf(command.storeId);if(!engine.worker(command.storeId))throw Error('请先开启该店铺AI');const c=conversations.find(c=>c.storeId===command.storeId&&c.uid===command.conversationId);if(!c)throw Error('会话不存在');engine.clearManualSuppression(command.storeId,command.conversationId);c.status='pending';writeJson(archiveFile,conversations);message='该会话已恢复AI接待。';break;}
   case 'send-reply':{const s=storeOf(command.storeId),uid=command.conversationId;const c=conversations.find(c=>c.storeId===s.id&&c.uid===uid);if(!c||selection.storeId!==s.id||selection.conversationId!==uid)throw Error('请重新选择要回复的会话');if(!manager.stateOf(s.id)?.online)throw Error('店铺未连接，请先登录或重试');const text=z.string().trim().min(1).max(2000).parse(v.reply),key=s.id+':'+uid;if(sending.has(key))throw Error('该会话正在发送，请稍候');sending.add(key);const worker=engine.worker(s.id);worker?.takeOver(uid);try{const a=adapterFor(s),focused=await a.focusConversation(uid);if(disposed)throw Error('服务已关闭');if(!focused?.ok)throw Error('无法定位会话，请重试');const result=await a.sendText(uid,text);if(!result?.ok)throw Error(result?.reason==='send_unconfirmed'?'发送未确认，请在平台检查后再决定是否重发':'发送失败：'+(result?.reason||'未知错误'));let localWarning=false;try{ingest({type:'message:in',storeId:s.id,uid,from:'seller',content:text,ts:Date.now(),msgId:result.msgId,manual:true})}catch{localWarning=true}try{auxiliary.clearDraft({storeId:s.id,uid},v.reply)}catch{localWarning=true}data={msgId:result.msgId,confirmed:true};message=localWarning?'回复已发送，但本机记录或草稿清理失败，请勿重复发送。':'回复已发送。';}finally{sending.delete(key);}break;}
   case 'review-model-issue':{
    if(!modelIssue?.context?.storeId||!modelIssue.context.uid)throw Error('这条记录没有关联买家会话。');
    if(v.code!==modelIssue.code||v.at!==modelIssue.at)throw Error('暂停提示已更新，请重新查看。');
    const {storeId,uid}=modelIssue.context;
    const store=storeOf(storeId);
    selection={storeId,conversationId:uid};
    if(!manager.stateOf(storeId).open)await execute({action:'open-store',storeId});
    const focused=await adapterFor(store).focusConversation(uid);
    if(!focused?.ok)throw Error('无法自动定位，请根据弹窗中的会话信息手动查找。');
    message='已定位原会话，请对照待核对回复。';break;
   }
   case 'acknowledge-model-issue':if(v.confirmed!==true)throw Error('请先确认已核对原请求状态');if(modelIssue&&(v.code!==modelIssue.code||v.at!==modelIssue.at))throw Error('暂停提示已更新，请重新核对后确认');modelIssue=null;writeJson(issueFile,null);message='提示已清除，AI仍保持关闭，需手动开启。';break;
   case 'refresh':break;
   default:throw Error('该功能的后端能力尚未接入');
  }
  if(disposed)throw Error('服务已关闭');changed();return {status:'ok',message,data};
 }
 return {snapshot,execute,ingest,stopAi,dispose(){disposed=true;modelClient.dispose?.();for(const client of probes)client.dispose();probes.clear();for(const c of generations)c.abort();generations.clear();engine.stopAll();monitor.stopAll();manager.closeAll();},manager,monitor,engine};
}
module.exports={createBackend};
