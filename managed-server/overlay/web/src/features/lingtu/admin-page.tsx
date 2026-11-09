import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {ConfirmDialog} from '@/components/confirm-dialog'
import {CopyButton} from '@/components/copy-button'
import {StaticDataTable} from '@/components/data-table'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs'
import {SecureVerificationDialog, useSecureVerification} from '@/features/auth/secure-verification'
import {api} from '@/lib/api'
import {formatNumber, formatTimestamp, formatTimestampForInput} from '@/lib/format'
import {AccountUsageSummary, AdminOverview} from './admin-usage'

type Payload=Record<string,unknown>&{section:string}
interface Policy{calls:number;days:number;default_model:string;daily_calls:number;max_tokens:number;per_account_concurrent:number;requests_per_minute:number;global_concurrent:number}
interface LoginProvider{provider:string;app_id:string;configured:boolean;enabled:boolean;callback:string}
interface ModelProvider{provider:string;model:string;configured:boolean;enabled:boolean}
interface Config{policy:Policy;login_providers:LoginProvider[];model_providers:ModelProvider[];smtp:{server:string;account:string;from:string;configured:boolean}}
interface Account{native_status?:number;user_id:number;display_name:string;status:string;model:string;limit:number;used:number;reserved:number;expires_at:number}
type Save=(payload:Payload)=>Promise<boolean>
type ModelChoice='deepseek'|'qwen'
const modelNames:Record<ModelChoice,string>={deepseek:'DeepSeek',qwen:'Qwen'}
function modelName(model:string){if(model.startsWith('qwen'))return 'Qwen';if(model.startsWith('deepseek'))return 'DeepSeek';return 'Not configured'}
function recordState(state:string){return ({reserved:'Processing',pending:'Processing',success:'Success',failed:'Failed',uncertain:'Needs review',failed_or_unconfirmed:'Failed or unconfirmed'} as Record<string,string>)[state]||'Needs review'}
function auditSection(section:string){return ({account:'Account authorization',trial:'Trial allowance',reconcile:'Usage reconciliation',wechat:'WeChat sign-in',dingtalk:'DingTalk sign-in',smtp:'Email settings',deepseek:'DeepSeek settings',qwen:'Qwen settings'} as Record<string,string>)[section]||'Other settings'}
function ModelSelect(props:{id:string;label:string;value:string;onChange:(value:string)=>void;allowDefault?:boolean;disabled?:boolean}){
 const {t}=useTranslation()
 return <div className='space-y-2'><Label htmlFor={props.id}>{props.label}</Label><select id={props.id} disabled={props.disabled} value={props.value} onChange={event=>props.onChange(event.target.value)} className='h-10 w-full rounded-lg border border-input bg-background px-3 text-sm'>{props.allowDefault&&<option value=''>{t("Follow default settings")}</option>}<option value='deepseek-flash'>{t('DeepSeek')}</option><option value='qwen-plus'>{t("Qwen")}</option></select></div>
}
function initialProvider(config:Config):ModelChoice{
 if(config.policy.default_model?.startsWith('qwen'))return 'qwen'
 if(config.policy.default_model?.startsWith('deepseek'))return 'deepseek'
 const configured=config.model_providers.find(provider=>provider.configured&&provider.enabled)||config.model_providers.find(provider=>provider.configured)
 return configured?.provider==='qwen'?'qwen':'deepseek'
}
function SimpleModelSetup(props:{config:Config;save:Save;busy:boolean}){
 const {t}=useTranslation()
 const [provider,setProvider]=useState<ModelChoice>(()=>initialProvider(props.config))
 const [drafts,setDrafts]=useState<Record<ModelChoice,string>>({deepseek:'',qwen:''})
 const saved=props.config.model_providers.find(item=>item.provider===provider)
 const hasSaved=!!saved?.configured
 const secret=drafts[provider]
 async function submit():Promise<void>{
  const value=secret.trim()
  if(props.busy||(!hasSaved&&!value))return
  const ok=await props.save({section:provider,secret:value,enabled:true,make_default:true})
  if(ok)setDrafts(previous=>({...previous,[provider]:previous[provider]===secret?'':previous[provider]}))
 }
 let status='Not configured. Paste a model key.'
 if(hasSaved)status=saved?.enabled?'Configured and enabled':'Configured but disabled. Save to enable it again.'
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle className='text-xl'>{t("Connect your AI service in three steps")}</CardTitle><p className='text-sm text-slate-500'>{t("Choose a model and paste its key. Saving tests the connection and makes it the default for customer service.")}</p></CardHeader><CardContent className='space-y-6'>
  <div className='space-y-2'><Label htmlFor='simple-model'>{t("1. Choose a model")}</Label><select id='simple-model' value={provider} disabled={props.busy} onChange={event=>setProvider(event.target.value as ModelChoice)} className='h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600'><option value='deepseek'>{t('DeepSeek')}</option><option value='qwen'>{t("Qwen")}</option></select><p role='status' className='text-sm text-slate-600'>{t(modelNames[provider])}: {t(status)}</p></div>
  <div className='space-y-2'><Label htmlFor='simple-model-secret'>{t("2. Paste the model key")}</Label><Input id='simple-model-secret' aria-label={t('Model key')} type='password' autoComplete='off' spellCheck={false} disabled={props.busy} value={secret} onChange={event=>setDrafts(previous=>({...previous,[provider]:event.target.value}))} placeholder={t(hasSaved?'Already saved securely. Leave blank to keep the existing key.':'Paste the key for the selected model')} className='h-11'/><p className='text-sm text-slate-500'>{t("A key is the password for your model service. Get it from the official website. Keys stay on the server and are never shown to ordinary users.")}</p><a className='text-sm text-blue-600 underline underline-offset-4' href={provider==='deepseek'?'https://api-docs.deepseek.com/zh-cn/':'https://help.aliyun.com/zh/model-studio/get-api-key/'} target='_blank' rel='noopener noreferrer'>{t("Get a key from the official website")}</a>{provider==='qwen'&&<p className='text-sm text-slate-500'>{t("Choose a pay-as-you-go key for mainland China (Beijing).")}</p>}</div>
  <div className='space-y-3'><p className='text-sm font-medium'>{t("3. Save and test")}</p><Button className='h-11 min-w-40 bg-blue-600 text-white hover:bg-blue-700' disabled={props.busy||(!hasSaved&&!secret.trim())} onClick={()=>void submit()}>{t(props.busy?'Working. Please wait...':'Save and test')}</Button><p className='text-sm text-slate-500'>{t("If security verification asks for a password, enter the administrator password created during setup. The connection test sends a short message and may incur a small model charge.")}</p></div>
 </CardContent></Card>
}

function Field(props:{id:string;label:string;value:string;onChange:(value:string)=>void;type?:string;placeholder?:string;disabled?:boolean}){
 return <div className='space-y-2'><Label htmlFor={props.id}>{props.label}</Label><Input id={props.id} disabled={props.disabled} type={props.type||'text'} value={props.value} onChange={event=>props.onChange(event.target.value)} placeholder={props.placeholder} autoComplete='off'/></div>
}
function Credentials(props:{name:string;kind:string;configured:boolean;enabled:boolean;appId?:string;callback?:string;save:Save;busy:boolean}){
 const {t}=useTranslation();const [secret,setSecret]=useState('');const [appId,setAppId]=useState(props.appId||'');const [enabled,setEnabled]=useState(props.enabled||!props.configured);const [clear,setClear]=useState(false)
 async function save(clearSecret=false):Promise<void>{
  const ok=await props.save({section:props.kind,app_id:appId,secret:clearSecret?'':secret,clear_secret:clearSecret,enabled:clearSecret?false:enabled})
  if(ok){setSecret('');if(clearSecret)setEnabled(false)}
 }
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle>{props.name}</CardTitle></CardHeader><CardContent className='space-y-4'>
  {props.callback&&<><Field id={`${props.kind}-id`} label={t('Application ID')} value={appId} onChange={setAppId}/><div className='space-y-2'><p className='text-sm font-medium'>{t("Callback address (copy to the WeChat or DingTalk platform)")}</p><div className='flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs'><span className='break-all'>{props.callback}</span><CopyButton value={props.callback}/></div></div></>}
  <Field id={`${props.kind}-secret`} label={t(props.callback?'Application secret':'Model key')} value={secret} onChange={setSecret} type='password' placeholder={t(props.configured?'Configured. Leave blank to keep.':'Paste a key to configure')}/>
  <div className='flex items-center justify-between'><Label htmlFor={`${props.kind}-enabled`}>{t('Enabled')}</Label><Switch id={`${props.kind}-enabled`} checked={enabled} onCheckedChange={setEnabled}/></div>
  <div className='flex gap-2'><Button disabled={props.busy} onClick={()=>void save()}>{t(props.callback||!enabled?'Save':'Save and test')}</Button><Button variant='outline' disabled={props.busy||!props.configured} onClick={()=>setClear(true)}>{t('Clear credential')}</Button></div>
  <ConfirmDialog open={clear} onOpenChange={setClear} title={t('Clear credential')} desc={t('This disables the provider until a new credential is saved.')} destructive handleConfirm={()=>{setClear(false);void save(true)}}/>
 </CardContent></Card>
}
function TrialRules(props:{policy:Policy;save:Save;busy:boolean}){
 const {t}=useTranslation();const [policy,setPolicy]=useState({...props.policy,per_account_concurrent:props.policy.per_account_concurrent??1,requests_per_minute:props.policy.requests_per_minute??5,global_concurrent:props.policy.global_concurrent??4})
 const dirtyFields=useRef(new Set<keyof Policy>())
 useEffect(()=>{setPolicy(previous=>({...props.policy,per_account_concurrent:props.policy.per_account_concurrent??1,requests_per_minute:props.policy.requests_per_minute??5,global_concurrent:props.policy.global_concurrent??4,...Object.fromEntries([...dirtyFields.current].map(key=>[key,previous[key]]))}))},[props.policy])
 function editPolicy<K extends keyof Policy>(key:K,value:Policy[K]){dirtyFields.current.add(key);setPolicy(previous=>({...previous,[key]:value}))}
 async function savePolicy():Promise<void>{const ok=await props.save({section:'trial',...policy,model:policy.default_model});if(ok)dirtyFields.current.clear()}
 return <Card className='max-w-2xl border border-blue-100 bg-white'><CardHeader><CardTitle>{t('Trial rules')}</CardTitle></CardHeader><CardContent className='space-y-4'>
  <p className='text-sm text-slate-500'>{t('Changes apply to newly granted trials. Existing accounts keep their grants.')}</p>
  <p className='text-sm text-slate-500'>{t('Concurrency and rate limits apply to current requests across the service.')}</p>
  {(['calls','days','daily_calls','max_tokens','per_account_concurrent','requests_per_minute','global_concurrent'] as const).map(key=><Field key={key} id={`trial-${key}`} disabled={props.busy} label={t({calls:'Trial calls',days:'Trial days',daily_calls:'Daily trial call cap',max_tokens:'Maximum output tokens',per_account_concurrent:'Concurrent requests per account',requests_per_minute:'Requests per minute per account',global_concurrent:'Global concurrent requests'}[key])} value={String(policy[key])} onChange={value=>editPolicy(key,Number(value))} type='number'/>)}
  <ModelSelect id='default-model' disabled={props.busy} label={t('Default model')} value={policy.default_model} onChange={value=>editPolicy('default_model',value)}/>
  <Button disabled={props.busy} onClick={()=>void savePolicy()}>{t('Save')}</Button>
 </CardContent></Card>
}
function AccountEditor(props:{account:Account;save:Save;busy:boolean;close:()=>void}){
 const nativeDisabled=props.account.native_status===2
 const {t}=useTranslation();const [calls,setCalls]=useState(String(props.account.limit));const [expires,setExpires]=useState(formatTimestampForInput(props.account.expires_at));const [enabled,setEnabled]=useState(props.account.status==='enabled');const [model,setModel]=useState(props.account.model);const [reason,setReason]=useState('')
 async function submit(revoke:boolean):Promise<void>{
  if(nativeDisabled)return
  const ok=await props.save({section:'account',user_id:props.account.user_id,calls:Number(calls),expires_at:Math.floor(new Date(expires).getTime()/1000),status:enabled?'enabled':'disabled',model,reason,revoke});if(ok)props.close()
 }
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle>{props.account.display_name} · {props.account.user_id}</CardTitle></CardHeader><CardContent className='grid gap-4 sm:grid-cols-2'>
  {nativeDisabled&&<p role='status' className='text-sm text-amber-700 sm:col-span-2'>{t('This account is disabled in the main account system. Enable it there before editing model authorization.')}</p>}
  <Field id='account-calls' disabled={nativeDisabled} label={t('Total authorized calls')} value={calls} onChange={setCalls} type='number'/><Field id='account-expiry' disabled={nativeDisabled} label={t('Expires at')} value={expires} onChange={setExpires} type='datetime-local'/>
  <ModelSelect id='account-model' disabled={nativeDisabled} label={t('Model for this account')} value={model} onChange={setModel} allowDefault/><Field id='account-reason' disabled={nativeDisabled} label={t('Reason for change')} value={reason} onChange={setReason}/>
  <div className='flex items-center gap-3'><Label htmlFor='account-enabled'>{t('Enabled')}</Label><Switch id='account-enabled' disabled={nativeDisabled} checked={enabled} onCheckedChange={setEnabled}/></div>
  <div className='flex gap-2'><Button disabled={props.busy||nativeDisabled||!reason.trim()} onClick={()=>void submit(false)}>{t('Save')}</Button><Button variant='outline' disabled={props.busy||nativeDisabled||!reason.trim()} onClick={()=>void submit(true)}>{t('Save and revoke sessions')}</Button><Button variant='ghost' onClick={props.close}>{t('Cancel')}</Button></div>
 </CardContent></Card>
}
function Accounts(props:{save:Save;busy:boolean;onViewUsage:(userId:number)=>void}){
 const {t}=useTranslation();const [page,setPage]=useState(1);const [selected,setSelected]=useState<Account|null>(null)
 const query=useQuery({queryKey:['lingtu','accounts',page],queryFn:async()=>(await api.get<{items:Account[];total:number}>('/api/lingtu/admin/accounts',{params:{page}})).data})
 return <div className='space-y-4'>{selected&&<AccountEditor key={selected.user_id} account={selected} save={props.save} busy={props.busy} close={()=>setSelected(null)}/>}
  {query.isError&&<p role='alert'>{t('Unable to load accounts')}</p>}
  <StaticDataTable data={query.data?.items||[]} getRowKey={row=>row.user_id} columns={[
   {id:'id',header:t('Account'),cell:row=><span>{row.display_name} · {row.user_id}</span>},
   {id:'quota',header:t('Trial calls'),cell:row=>`${formatNumber(row.used)} / ${formatNumber(row.limit)} (${formatNumber(row.reserved)} ${t('pending')})`},
   {id:'expiry',header:t('Expires at'),cell:row=>formatTimestamp(row.expires_at)},
   {id:'status',header:t('Status'),cell:row=>{if(row.native_status===2)return t('Disabled in the main account system');if(row.status==='enabled')return t('Enabled');if(row.status==='not_authorized')return t('Not authorized');return t('Disabled')}},
   {id:'edit',header:t('Actions'),cell:row=><div className='flex gap-2'><Button variant='outline' onClick={()=>setSelected(row)}>{t('Edit')}</Button><Button variant='outline' onClick={()=>props.onViewUsage(row.user_id)}>{t('View account usage')}</Button></div>},
  ]} emptyContent={t(query.isPending?'Loading...':'No accounts yet')}/>
  <div className='flex justify-end gap-3'><Button variant='outline' disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>{t('Previous')}</Button><span>{formatNumber(page)}</span><Button variant='outline' disabled={query.isFetching||page*20>=(query.data?.total||0)} onClick={()=>setPage(page+1)}>{t('Next')}</Button></div>
 </div>
}
interface UsageRecord{user_id:number;display_name:string;request_id:string;state:string;created_at:number;model:string;input_tokens:number;output_tokens:number;total_tokens:number;usage_known:boolean;diagnostic:string}
interface AuditRecord{id:number;actor_id:number;target_id:number;section:string;outcome:string;reason:string;created_at:number}
interface Page<T>{items:T[];total:number;page:number}
function RecordPages(props:{page:number;total:number;fetching:boolean;setPage:(page:number)=>void}){
 const {t}=useTranslation()
 return <nav aria-label={t('Record pagination')} className='flex items-center justify-end gap-3'><Button variant='outline' disabled={props.page===1||props.fetching} onClick={()=>props.setPage(props.page-1)}>{t('Previous')}</Button><span className='text-sm'>{formatNumber(props.page)} · {t('Total records')}: {formatNumber(props.total)}</span><Button variant='outline' disabled={props.fetching||props.page*20>=props.total} onClick={()=>props.setPage(props.page+1)}>{t('Next')}</Button></nav>
}
function UsageRecords(props:{save:Save;busy:boolean;userId?:number}){
 const {t}=useTranslation();const [page,setPage]=useState(1);const [selected,setSelected]=useState<{row:UsageRecord;outcome:'success'|'failed'}|null>(null);const [reason,setReason]=useState('');const reconciling=useRef(false)
 const query=useQuery({queryKey:['lingtu','usage',page,props.userId??null],queryFn:async()=>(await api.get<Page<UsageRecord>>('/api/lingtu/admin/usage',{params:{page,...(props.userId?{user_id:props.userId}:{})}})).data})
 let emptyMessage='No usage records yet'
 if(query.isPending)emptyMessage='Loading...'
 else if(query.isError)emptyMessage='Unable to load usage records'
 async function reconcile():Promise<void>{
  if(!selected||!reason.trim()||props.busy||reconciling.current)return
  reconciling.current=true
  try{const ok=await props.save({section:'reconcile',user_id:selected.row.user_id,request_id:selected.row.request_id,outcome:selected.outcome,reason:reason.trim()});if(ok){setSelected(null);setReason('')}}finally{reconciling.current=false}
 }
 return <Card className='border border-blue-100 bg-white'><CardHeader className='flex flex-row items-center justify-between'><CardTitle>{t('Usage records')}</CardTitle><Button variant='outline' disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('Refresh')}</Button></CardHeader><CardContent className='space-y-4'>
  <p className='text-sm text-slate-500'>{t('Uncertain results require verification before reconciliation. This only updates accounting and never resends a model request.')}</p>
  {query.isError&&<p role='alert'>{t('Unable to load usage records')}</p>}
  <StaticDataTable data={query.data?.items||[]} getRowKey={row=>`${row.user_id}:${row.request_id}`} columns={[
   {id:'account',header:t('Account'),cell:row=>`${row.display_name||''} · ${row.user_id}`},
   {id:'request',header:t('Request ID'),cell:row=><span className='break-all font-mono text-xs'>{row.request_id}</span>},
   {id:'time',header:t('Time'),cell:row=>formatTimestamp(row.created_at)},
   {id:'model',header:t('Model'),cell:row=>row.model?t(modelName(row.model)):'—'},
   {id:'state',header:t('Status'),cell:row=>t(recordState(row.state))},
   {id:'tokens',header:t('Input / output tokens'),cell:row=>row.usage_known===true?`${formatNumber(row.input_tokens)} / ${formatNumber(row.output_tokens)}`:t('Usage not returned')},
   {id:'totalTokens',header:t('Total tokens'),cell:row=>row.usage_known===true?formatNumber(row.total_tokens):t('Usage not returned')},
   {id:'diagnostic',header:t('Action guidance'),cell:row=>row.state==='uncertain'?t('Verify the actual result before reconciliation'):'—'},
   {id:'actions',header:t('Actions'),cell:row=>row.state==='uncertain'?<div className='flex gap-2'><Button variant='outline' disabled={props.busy} onClick={()=>{setReason('');setSelected({row,outcome:'success'})}}>{t('Confirm success')}</Button><Button variant='outline' disabled={props.busy} onClick={()=>{setReason('');setSelected({row,outcome:'failed'})}}>{t('Confirm failure')}</Button></div>:'—'},
  ]} emptyContent={t(emptyMessage)}/>
  <RecordPages page={page} total={query.data?.total||0} fetching={query.isFetching} setPage={setPage}/>
  <ConfirmDialog open={!!selected} onOpenChange={open=>{if(!open&&!props.busy)setSelected(null)}} title={t(selected?.outcome==='success'?'Confirm successful result':'Confirm failed result')} desc={<div className='space-y-3'><p>{t('Verify the actual upstream result. Successful results consume one call; failed results release the reserved call. No request is resent.')}</p><p className='break-all font-mono text-xs'>{selected?.row.user_id} · {selected?.row.request_id}</p><Field id='reconcile-reason' label={t('Reason for change')} value={reason} onChange={setReason}/></div>} confirmText={t('Confirm reconciliation')} disabled={!reason.trim()||reason.trim().length>256||props.busy} isLoading={props.busy} handleConfirm={()=>void reconcile()}/>
 </CardContent></Card>
}
function AuditRecords(){
 const {t}=useTranslation();const [page,setPage]=useState(1)
 const query=useQuery({queryKey:['lingtu','audit',page],queryFn:async()=>(await api.get<Page<AuditRecord>>('/api/lingtu/admin/audit',{params:{page}})).data})
 let emptyMessage='No audit records yet'
 if(query.isPending)emptyMessage='Loading...'
 else if(query.isError)emptyMessage='Unable to load audit records'
 return <Card className='border border-blue-100 bg-white'><CardHeader className='flex flex-row items-center justify-between'><CardTitle>{t('Administrative audit')}</CardTitle><Button variant='outline' disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('Refresh')}</Button></CardHeader><CardContent className='space-y-4'>
  {query.isError&&<p role='alert'>{t('Unable to load audit records')}</p>}
  <StaticDataTable data={query.data?.items||[]} getRowKey={row=>row.id} columns={[
   {id:'time',header:t('Time'),cell:row=>formatTimestamp(row.created_at)},
   {id:'actor',header:t('Administrator ID'),cell:row=>formatNumber(row.actor_id)},
   {id:'target',header:t('Target account'),cell:row=>row.target_id?formatNumber(row.target_id):'—'},
   {id:'section',header:t('Configuration section'),cell:row=>t(auditSection(row.section))},
   {id:'outcome',header:t('Outcome'),cell:row=>t(recordState(row.outcome))},
   {id:'reason',header:t('Reason for change'),cell:row=><span className='break-all'>{row.reason||'—'}</span>},
  ]} emptyContent={t(emptyMessage)}/>
  <RecordPages page={page} total={query.data?.total||0} fetching={query.isFetching} setPage={setPage}/>
 </CardContent></Card>
}
function MailSettings(props:{config:Config['smtp'];save:Save;busy:boolean}){
 const {t}=useTranslation();const [server,setServer]=useState(props.config.server||'');const [account,setAccount]=useState(props.config.account||'');const [from,setFrom]=useState(props.config.from||'');const [secret,setSecret]=useState('')
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle>{t('Email fallback')}</CardTitle></CardHeader><CardContent className='space-y-4'><p className='text-sm text-slate-500'>{t('SMTP uses encrypted TLS on port 465. Verify actual email delivery before opening registration.')}</p>
  <Field id='smtp-server' label={t('Email server')} value={server} onChange={setServer}/><Field id='smtp-account' label={t('Email account')} value={account} onChange={setAccount}/><Field id='smtp-from' label={t('Sender email')} value={from} onChange={setFrom}/><Field id='smtp-secret' label={t('Email authorization code')} value={secret} onChange={setSecret} type='password' placeholder={t(props.config.configured?'Configured. Leave blank to keep.':'Paste a key to configure')}/>
  <Button disabled={props.busy} onClick={()=>void props.save({section:'smtp',smtp_server:server,smtp_account:account,smtp_from:from,secret}).then(ok=>{if(ok)setSecret('')})}>{t('Save')}</Button>
 </CardContent></Card>
}

const adminLanguagePreference='lingtu-admin-language'
function readAdminLanguage():'zhCN'|'en'{
 try{if(localStorage.getItem(adminLanguagePreference)==='en')return 'en'}catch{/* Browser storage can be unavailable. */}
 return 'zhCN'
}
function UsageFilter(props:{userId?:number;onChange:(userId:number|undefined)=>void}){
 const {t}=useTranslation();const [value,setValue]=useState(props.userId?String(props.userId):'')
 const valid=value===''||(/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0)
 return <form className='flex flex-wrap items-end gap-3 rounded-xl border border-blue-100 bg-white p-4' onSubmit={event=>{event.preventDefault();if(valid)props.onChange(value?Number(value):undefined)}}>
  <div className='space-y-2'><Label htmlFor='usage-user-filter'>{t('Filter by account ID')}</Label><Input id='usage-user-filter' inputMode='numeric' value={value} onChange={event=>setValue(event.target.value)} placeholder={t('Leave blank for all accounts')}/></div>
  <Button type='submit' disabled={!valid}>{t('Apply filter')}</Button><Button type='button' variant='outline' onClick={()=>{setValue('');props.onChange(undefined)}}>{t('All accounts')}</Button>
  {props.userId&&<p role='status' className='text-sm text-slate-600'>{t('Account ID')}: {props.userId}</p>}
  {!valid&&<p role='alert' className='text-sm text-red-600'>{t('Enter a positive account ID')}</p>}
 </form>
}
export function AdminPage(){
 const {t,i18n}=useTranslation();const [language,setLanguage]=useState(readAdminLanguage)
 useEffect(()=>{void i18n.changeLanguage(language);document.documentElement.lang=language==='zhCN'?'zh-CN':'en';try{localStorage.setItem(adminLanguagePreference,language)}catch{/* Keep the chosen language in memory. */}},[i18n,language])
 const queryClient=useQueryClient();const verification=useSecureVerification();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const saving=useRef(false)
 const [tab,setTab]=useState('overview');const [usageUserId,setUsageUserId]=useState<number|undefined>();const [advancedModelsVisited,setAdvancedModelsVisited]=useState(false);const [visitedTabs,setVisitedTabs]=useState(()=>new Set(['overview','models']))
 const selectTab=(next:string)=>{setTab(next);setVisitedTabs(previous=>previous.has(next)?previous:new Set([...previous,next]))}
 const query=useQuery({queryKey:['lingtu','config'],queryFn:async()=>(await api.get<Config>('/api/lingtu/admin/config')).data})
 const viewUserUsage=(userId:number)=>{setUsageUserId(userId);selectTab('usage')}
 async function save(payload:Payload):Promise<boolean>{
  if(saving.current)return false;saving.current=true;setBusy(true);setMessage('')
  try{
   const body=JSON.stringify(payload);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')
   const proof=await verification.requestVerification({scope:'admin.user.managed_config',context:{section:payload.section,request_hash:hash},title:t('Verify administrator identity to save changes')});if(!proof)return false
   const result=await api.post<{saved:boolean}>('/api/lingtu/admin/config',body,{headers:{'Content-Type':'application/json','X-Security-Proof':proof.proof_token},singleUseAuthorization:true})
   if(!result.data.saved)throw new Error('Save failed');await queryClient.invalidateQueries({queryKey:['lingtu']});setMessage('Saved successfully. Changes are active.');return true
  }catch{setMessage('Could not save. Check the model key, model access and administrator verification, then try again.');return false}finally{saving.current=false;setBusy(false)}
 }
 const languageControl=<div role='group' aria-label={t('Interface language')} className='flex gap-1'><Button variant={language==='zhCN'?'default':'outline'} aria-pressed={language==='zhCN'} onClick={()=>setLanguage('zhCN')}>中文</Button><Button variant={language==='en'?'default':'outline'} aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>English</Button></div>
 if(query.isPending)return <div className='space-y-4 p-8'>{languageControl}<p role='status'>{t('Loading configuration...')}</p></div>
 if(query.isError)return <div className='space-y-4 p-8'>{languageControl}<p role='alert'>{t('Unable to load configuration. Refresh the page to try again.')}</p><Button onClick={()=>void query.refetch()}>{t('Retry')}</Button></div>
 const config=query.data
 return <main className='min-h-screen bg-blue-50 p-5 text-slate-800 sm:p-8'><div className='mx-auto max-w-7xl space-y-5'>
  <header className='flex flex-wrap items-center justify-between gap-4'><div><p className='text-sm font-semibold text-blue-600'>{t('Manage accounts, models and usage in one place.')}</p><h1 className='text-2xl font-bold'>{t('Lingtu customer service administration')}</h1></div><div className='flex flex-wrap gap-3'>{languageControl}<Button variant='outline' disabled={query.isFetching} onClick={()=>void queryClient.invalidateQueries({queryKey:['lingtu']})}>{t('Refresh')}</Button></div></header>
  {message&&<p role='status' className='rounded-xl border border-blue-100 bg-white p-4 text-sm'>{t(message)}</p>}
  <Tabs value={tab} onValueChange={value=>selectTab(String(value))}><TabsList aria-label={t('Administration sections')} className='h-auto w-full flex-wrap justify-start bg-white'>{[['overview','Overview'],['models','Model configuration'],['accounts','Account management'],['usage','Usage records'],['login','Sign-in methods'],['trial','Trial settings']].map(([id,label])=><TabsTrigger key={id} value={id}>{t(label)}</TabsTrigger>)}</TabsList>
   <TabsContent value='overview'><AdminOverview onManageAccounts={()=>selectTab('accounts')} onViewUsage={()=>selectTab('usage')}/></TabsContent>
   <TabsContent value='models' keepMounted><div className='space-y-5'><SimpleModelSetup config={config} save={save} busy={busy}/><details className='rounded-xl border border-blue-100 bg-white p-4' onToggle={event=>{if(event.currentTarget.open)setAdvancedModelsVisited(true)}}><summary className='cursor-pointer text-sm font-semibold text-slate-700'>{t('Advanced model settings')}</summary>{advancedModelsVisited&&<div className='mt-5 grid gap-5 md:grid-cols-2'>{config.model_providers.map(provider=><Credentials key={provider.provider} name={t(provider.provider==='deepseek'?'DeepSeek':'Qwen')} kind={provider.provider} configured={provider.configured} enabled={provider.enabled} save={save} busy={busy}/>)}</div>}</details></div></TabsContent>
   <TabsContent value='accounts' keepMounted>{visitedTabs.has('accounts')&&<Accounts save={save} busy={busy} onViewUsage={viewUserUsage}/>}</TabsContent>
   <TabsContent value='usage'><div className='space-y-5'><UsageFilter key={usageUserId??'all'} userId={usageUserId} onChange={setUsageUserId}/><AccountUsageSummary key={`summary-${usageUserId??'all'}`} userId={usageUserId} onViewUser={viewUserUsage}/><UsageRecords key={`records-${usageUserId??'all'}`} save={save} busy={busy} userId={usageUserId}/><AuditRecords/></div></TabsContent>
   <TabsContent value='login' keepMounted>{visitedTabs.has('login')&&<div className='grid gap-5 md:grid-cols-2'>{config.login_providers.map(provider=><Credentials key={provider.provider} name={t(provider.provider==='wechat'?'WeChat':'DingTalk')} kind={provider.provider} configured={provider.configured} enabled={provider.enabled} appId={provider.app_id} callback={provider.callback} save={save} busy={busy}/>)}<MailSettings config={config.smtp} save={save} busy={busy}/></div>}</TabsContent>
   <TabsContent value='trial' keepMounted>{visitedTabs.has('trial')&&<TrialRules policy={config.policy} save={save} busy={busy}/>}</TabsContent>
  </Tabs><footer className='flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500'><span>{t('Powered by')} <a className='underline underline-offset-4' href='https://github.com/QuantumNous/new-api' target='_blank' rel='noopener noreferrer'>New API</a></span><a className='underline underline-offset-4' href='https://github.com/907609732/LTTLT-AI-Customer-Service' target='_blank' rel='noopener noreferrer'>{t('Modified source (AGPL-3.0)')}</a></footer>
 </div><SecureVerificationDialog {...verification.dialogProps}/></main>
}
