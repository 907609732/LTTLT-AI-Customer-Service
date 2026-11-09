import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useRef, useState} from 'react'
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

type Payload=Record<string,unknown>&{section:string}
interface Policy{calls:number;days:number;default_model:string;daily_calls:number;max_tokens:number;per_account_concurrent:number;requests_per_minute:number;global_concurrent:number}
interface LoginProvider{provider:string;app_id:string;configured:boolean;enabled:boolean;callback:string}
interface ModelProvider{provider:string;model:string;configured:boolean;enabled:boolean}
interface Config{policy:Policy;login_providers:LoginProvider[];model_providers:ModelProvider[];smtp:{server:string;account:string;from:string;configured:boolean}}
interface Account{user_id:number;display_name:string;status:string;model:string;limit:number;used:number;reserved:number;expires_at:number}
type Save=(payload:Payload)=>Promise<boolean>

function Field(props:{id:string;label:string;value:string;onChange:(value:string)=>void;type?:string;placeholder?:string}){
 return <div className='space-y-2'><Label htmlFor={props.id}>{props.label}</Label><Input id={props.id} type={props.type||'text'} value={props.value} onChange={event=>props.onChange(event.target.value)} placeholder={props.placeholder} autoComplete='off'/></div>
}
function Credentials(props:{name:string;kind:string;configured:boolean;enabled:boolean;appId?:string;callback?:string;save:Save;busy:boolean}){
 const {t}=useTranslation();const [secret,setSecret]=useState('');const [appId,setAppId]=useState(props.appId||'');const [enabled,setEnabled]=useState(props.enabled||!props.configured);const [clear,setClear]=useState(false)
 async function save(clearSecret=false):Promise<void>{
  const ok=await props.save({section:props.kind,app_id:appId,secret:clearSecret?'':secret,clear_secret:clearSecret,enabled:clearSecret?false:enabled})
  if(ok){setSecret('');if(clearSecret)setEnabled(false)}
 }
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle>{props.name}</CardTitle></CardHeader><CardContent className='space-y-4'>
  {props.callback&&<><Field id={`${props.kind}-id`} label='App ID / Client ID' value={appId} onChange={setAppId}/><div className='flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs'><span className='break-all'>{props.callback}</span><CopyButton value={props.callback}/></div></>}
  <Field id={`${props.kind}-secret`} label={props.callback?'App Secret':'API Key'} value={secret} onChange={setSecret} type='password' placeholder={t(props.configured?'Configured. Leave blank to keep.':'Paste a key to configure')}/>
  <div className='flex items-center justify-between'><Label htmlFor={`${props.kind}-enabled`}>{t('Enabled')}</Label><Switch id={`${props.kind}-enabled`} checked={enabled} onCheckedChange={setEnabled}/></div>
  <div className='flex gap-2'><Button disabled={props.busy} onClick={()=>void save()}>{t(props.callback||!enabled?'Save':'Save and test')}</Button><Button variant='outline' disabled={props.busy||!props.configured} onClick={()=>setClear(true)}>{t('Clear credential')}</Button></div>
  <ConfirmDialog open={clear} onOpenChange={setClear} title={t('Clear credential')} desc={t('This disables the provider until a new credential is saved.')} destructive handleConfirm={()=>{setClear(false);void save(true)}}/>
 </CardContent></Card>
}
function TrialRules(props:{policy:Policy;save:Save;busy:boolean}){
 const {t}=useTranslation();const [policy,setPolicy]=useState({...props.policy,per_account_concurrent:props.policy.per_account_concurrent??1,requests_per_minute:props.policy.requests_per_minute??5,global_concurrent:props.policy.global_concurrent??4})
 return <Card className='max-w-2xl border border-blue-100 bg-white'><CardHeader><CardTitle>{t('Trial rules')}</CardTitle></CardHeader><CardContent className='space-y-4'>
  <p className='text-sm text-slate-500'>{t('Changes apply to newly granted trials. Existing accounts keep their grants.')}</p>
  <p className='text-sm text-slate-500'>{t('Concurrency and rate limits apply to current requests across the service.')}</p>
  {(['calls','days','daily_calls','max_tokens','per_account_concurrent','requests_per_minute','global_concurrent'] as const).map(key=><Field key={key} id={`trial-${key}`} label={t({calls:'Trial calls',days:'Trial days',daily_calls:'Daily trial call cap',max_tokens:'Maximum output tokens',per_account_concurrent:'Concurrent requests per account',requests_per_minute:'Requests per minute per account',global_concurrent:'Global concurrent requests'}[key])} value={String(policy[key])} onChange={value=>setPolicy({...policy,[key]:Number(value)})} type='number'/>)}
  <Field id='default-model' label={t('Default model')} value={policy.default_model} onChange={value=>setPolicy({...policy,default_model:value})}/>
  <p className='text-xs text-slate-400'>deepseek-flash / qwen-plus</p><Button disabled={props.busy} onClick={()=>void props.save({section:'trial',...policy,model:policy.default_model})}>{t('Save')}</Button>
 </CardContent></Card>
}
function AccountEditor(props:{account:Account;save:Save;busy:boolean;close:()=>void}){
 const {t}=useTranslation();const [calls,setCalls]=useState(String(props.account.limit));const [expires,setExpires]=useState(formatTimestampForInput(props.account.expires_at));const [enabled,setEnabled]=useState(props.account.status==='enabled');const [model,setModel]=useState(props.account.model);const [reason,setReason]=useState('')
 async function submit(revoke:boolean):Promise<void>{
  const ok=await props.save({section:'account',user_id:props.account.user_id,calls:Number(calls),expires_at:Math.floor(new Date(expires).getTime()/1000),status:enabled?'enabled':'disabled',model,reason,revoke});if(ok)props.close()
 }
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle>{props.account.display_name} · {props.account.user_id}</CardTitle></CardHeader><CardContent className='grid gap-4 sm:grid-cols-2'>
  <Field id='account-calls' label={t('Total authorized calls')} value={calls} onChange={setCalls} type='number'/><Field id='account-expiry' label={t('Expires at')} value={expires} onChange={setExpires} type='datetime-local'/>
  <Field id='account-model' label={t('Model override (blank uses default)')} value={model} onChange={setModel}/><Field id='account-reason' label={t('Reason for change')} value={reason} onChange={setReason}/>
  <div className='flex items-center gap-3'><Label htmlFor='account-enabled'>{t('Enabled')}</Label><Switch id='account-enabled' checked={enabled} onCheckedChange={setEnabled}/></div>
  <div className='flex gap-2'><Button disabled={props.busy||!reason.trim()} onClick={()=>void submit(false)}>{t('Save')}</Button><Button variant='outline' disabled={props.busy||!reason.trim()} onClick={()=>void submit(true)}>{t('Save and revoke sessions')}</Button><Button variant='ghost' onClick={props.close}>{t('Cancel')}</Button></div>
 </CardContent></Card>
}
function Accounts(props:{save:Save;busy:boolean}){
 const {t}=useTranslation();const [page,setPage]=useState(1);const [selected,setSelected]=useState<Account|null>(null)
 const query=useQuery({queryKey:['lingtu','accounts',page],queryFn:async()=>(await api.get<{items:Account[];total:number}>('/api/lingtu/admin/accounts',{params:{page}})).data})
 return <div className='space-y-4'>{selected&&<AccountEditor key={selected.user_id} account={selected} save={props.save} busy={props.busy} close={()=>setSelected(null)}/>}
  {query.isError&&<p role='alert'>{t('Unable to load accounts')}</p>}
  <StaticDataTable data={query.data?.items||[]} getRowKey={row=>row.user_id} columns={[
   {id:'id',header:t('Account'),cell:row=><span>{row.display_name} · {row.user_id}</span>},
   {id:'quota',header:t('Trial calls'),cell:row=>`${formatNumber(row.used)} / ${formatNumber(row.limit)} (${formatNumber(row.reserved)} ${t('pending')})`},
   {id:'expiry',header:t('Expires at'),cell:row=>formatTimestamp(row.expires_at)},
   {id:'status',header:t('Status'),cell:row=>t(row.status==='enabled'?'Enabled':'Disabled')},
   {id:'edit',header:t('Actions'),cell:row=><Button variant='outline' onClick={()=>setSelected(row)}>{t('Edit')}</Button>},
  ]} emptyContent={t(query.isPending?'Loading...':'No accounts yet')}/>
  <div className='flex justify-end gap-3'><Button variant='outline' disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>{t('Previous')}</Button><span>{formatNumber(page)}</span><Button variant='outline' disabled={query.isFetching||page*20>=(query.data?.total||0)} onClick={()=>setPage(page+1)}>{t('Next')}</Button></div>
 </div>
}
interface UsageRecord{user_id:number;request_id:string;state:string;created_at:number;model:string;input_tokens:number;output_tokens:number;diagnostic:string}
interface AuditRecord{id:number;actor_id:number;target_id:number;section:string;outcome:string;reason:string;created_at:number}
interface Page<T>{items:T[];total:number;page:number}
function RecordPages(props:{page:number;total:number;fetching:boolean;setPage:(page:number)=>void}){
 const {t}=useTranslation()
 return <nav aria-label={t('Record pagination')} className='flex items-center justify-end gap-3'><Button variant='outline' disabled={props.page===1||props.fetching} onClick={()=>props.setPage(props.page-1)}>{t('Previous')}</Button><span className='text-sm'>{formatNumber(props.page)} · {t('Total records')}: {formatNumber(props.total)}</span><Button variant='outline' disabled={props.fetching||props.page*20>=props.total} onClick={()=>props.setPage(props.page+1)}>{t('Next')}</Button></nav>
}
function UsageRecords(props:{save:Save;busy:boolean}){
 const {t}=useTranslation();const [page,setPage]=useState(1);const [selected,setSelected]=useState<{row:UsageRecord;outcome:'success'|'failed'}|null>(null);const [reason,setReason]=useState('');const reconciling=useRef(false)
 const query=useQuery({queryKey:['lingtu','usage',page],queryFn:async()=>(await api.get<Page<UsageRecord>>('/api/lingtu/admin/usage',{params:{page}})).data})
 async function reconcile():Promise<void>{
  if(!selected||!reason.trim()||props.busy||reconciling.current)return
  reconciling.current=true
  try{const ok=await props.save({section:'reconcile',user_id:selected.row.user_id,request_id:selected.row.request_id,outcome:selected.outcome,reason:reason.trim()});if(ok){setSelected(null);setReason('')}}finally{reconciling.current=false}
 }
 return <Card className='border border-blue-100 bg-white'><CardHeader className='flex flex-row items-center justify-between'><CardTitle>{t('Usage records')}</CardTitle><Button variant='outline' disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('Refresh')}</Button></CardHeader><CardContent className='space-y-4'>
  <p className='text-sm text-slate-500'>{t('Uncertain results require verification before reconciliation. This only updates accounting and never resends a model request.')}</p>
  {query.isError&&<p role='alert'>{t('Unable to load usage records')}</p>}
  <StaticDataTable data={query.data?.items||[]} getRowKey={row=>`${row.user_id}:${row.request_id}`} columns={[
   {id:'account',header:t('Account'),cell:row=>formatNumber(row.user_id)},
   {id:'request',header:t('Request ID'),cell:row=><span className='break-all font-mono text-xs'>{row.request_id}</span>},
   {id:'time',header:t('Time'),cell:row=>formatTimestamp(row.created_at)},
   {id:'model',header:t('Model'),cell:row=>row.model||'—'},
   {id:'state',header:t('Status'),cell:row=>t(row.state)},
   {id:'tokens',header:t('Input / output tokens'),cell:row=>`${formatNumber(row.input_tokens)} / ${formatNumber(row.output_tokens)}`},
   {id:'diagnostic',header:t('Diagnostic code'),cell:row=>row.diagnostic||'—'},
   {id:'actions',header:t('Actions'),cell:row=>row.state==='uncertain'?<div className='flex gap-2'><Button variant='outline' disabled={props.busy} onClick={()=>{setReason('');setSelected({row,outcome:'success'})}}>{t('Confirm success')}</Button><Button variant='outline' disabled={props.busy} onClick={()=>{setReason('');setSelected({row,outcome:'failed'})}}>{t('Confirm failure')}</Button></div>:'—'},
  ]} emptyContent={t(query.isPending?'Loading...':query.isError?'Unable to load usage records':'No usage records yet')}/>
  <RecordPages page={page} total={query.data?.total||0} fetching={query.isFetching} setPage={setPage}/>
  <ConfirmDialog open={!!selected} onOpenChange={open=>{if(!open&&!props.busy)setSelected(null)}} title={t(selected?.outcome==='success'?'Confirm successful result':'Confirm failed result')} desc={<div className='space-y-3'><p>{t('Verify the actual upstream result. Successful results consume one call; failed results release the reserved call. No request is resent.')}</p><p className='break-all font-mono text-xs'>{selected?.row.user_id} · {selected?.row.request_id}</p><Field id='reconcile-reason' label={t('Reason for change')} value={reason} onChange={setReason}/></div>} confirmText={t('Confirm reconciliation')} disabled={!reason.trim()||reason.trim().length>256||props.busy} isLoading={props.busy} handleConfirm={()=>void reconcile()}/>
 </CardContent></Card>
}
function AuditRecords(){
 const {t}=useTranslation();const [page,setPage]=useState(1)
 const query=useQuery({queryKey:['lingtu','audit',page],queryFn:async()=>(await api.get<Page<AuditRecord>>('/api/lingtu/admin/audit',{params:{page}})).data})
 return <Card className='border border-blue-100 bg-white'><CardHeader className='flex flex-row items-center justify-between'><CardTitle>{t('Administrative audit')}</CardTitle><Button variant='outline' disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('Refresh')}</Button></CardHeader><CardContent className='space-y-4'>
  {query.isError&&<p role='alert'>{t('Unable to load audit records')}</p>}
  <StaticDataTable data={query.data?.items||[]} getRowKey={row=>row.id} columns={[
   {id:'time',header:t('Time'),cell:row=>formatTimestamp(row.created_at)},
   {id:'actor',header:t('Administrator ID'),cell:row=>formatNumber(row.actor_id)},
   {id:'target',header:t('Target account'),cell:row=>row.target_id?formatNumber(row.target_id):'—'},
   {id:'section',header:t('Configuration section'),cell:row=>row.section},
   {id:'outcome',header:t('Outcome'),cell:row=>t(row.outcome)},
   {id:'reason',header:t('Reason for change'),cell:row=><span className='break-all'>{row.reason||'—'}</span>},
  ]} emptyContent={t(query.isPending?'Loading...':query.isError?'Unable to load audit records':'No audit records yet')}/>
  <RecordPages page={page} total={query.data?.total||0} fetching={query.isFetching} setPage={setPage}/>
 </CardContent></Card>
}
function MailSettings(props:{config:Config['smtp'];save:Save;busy:boolean}){
 const {t}=useTranslation();const [server,setServer]=useState(props.config.server||'');const [account,setAccount]=useState(props.config.account||'');const [from,setFrom]=useState(props.config.from||'');const [secret,setSecret]=useState('')
 return <Card className='border border-blue-100 bg-white'><CardHeader><CardTitle>{t('Email fallback')}</CardTitle></CardHeader><CardContent className='space-y-4'><p className='text-sm text-slate-500'>{t('SMTP uses encrypted TLS on port 465. Verify actual email delivery before opening registration.')}</p>
  <Field id='smtp-server' label='SMTP Server' value={server} onChange={setServer}/><Field id='smtp-account' label={t('Email account')} value={account} onChange={setAccount}/><Field id='smtp-from' label={t('Sender email')} value={from} onChange={setFrom}/><Field id='smtp-secret' label={t('Email authorization code')} value={secret} onChange={setSecret} type='password' placeholder={t(props.config.configured?'Configured. Leave blank to keep.':'Paste a key to configure')}/>
  <Button disabled={props.busy} onClick={()=>void props.save({section:'smtp',smtp_server:server,smtp_account:account,smtp_from:from,secret}).then(ok=>{if(ok)setSecret('')})}>{t('Save')}</Button>
 </CardContent></Card>
}
export function AdminPage(){
 const {t}=useTranslation();const queryClient=useQueryClient();const verification=useSecureVerification();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const saving=useRef(false)
 const query=useQuery({queryKey:['lingtu','config'],queryFn:async()=>(await api.get<Config>('/api/lingtu/admin/config')).data})
 async function save(payload:Payload):Promise<boolean>{
  if(saving.current)return false;saving.current=true;setBusy(true);setMessage('')
  try{
   const body=JSON.stringify(payload);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')
   const proof=await verification.requestVerification({scope:'admin.user.managed_config',context:{section:payload.section,request_hash:hash},title:t('Confirm configuration change')});if(!proof)return false
   const result=await api.post<{saved:boolean}>('/api/lingtu/admin/config',body,{headers:{'Content-Type':'application/json','X-Security-Proof':proof.proof_token},singleUseAuthorization:true})
   if(!result.data.saved)throw new Error('Save failed');await queryClient.invalidateQueries({queryKey:['lingtu']});setMessage(t('Saved successfully'));return true
  }catch{setMessage(t('Configuration was not saved. Check values and model connectivity.'));return false}finally{saving.current=false;setBusy(false)}
 }
 if(query.isPending)return <p className='p-8'>{t('Loading...')}</p>
 if(query.isError)return <p role='alert' className='p-8'>{t('Unable to load managed service settings')}</p>
 const config=query.data
 return <main className='min-h-screen bg-blue-50 p-5 text-slate-800 sm:p-8'><div className='mx-auto max-w-6xl space-y-5'>
  <header className='flex items-center justify-between'><div><p className='text-sm font-semibold text-blue-600'>{t('Lingtu customer service')}</p><h1 className='text-2xl font-bold'>{t('Managed service administration')}</h1></div><Button variant='outline' disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('Refresh')}</Button></header>
  {message&&<p role='status' className='rounded-xl border border-blue-100 bg-white p-4 text-sm'>{message}</p>}
  <Tabs defaultValue='overview'><TabsList className='h-auto flex-wrap bg-white'>{[['overview','Overview'],['models','Models and keys'],['accounts','Accounts'],['trial','Trial rules'],['usage','Usage records'],['login','Login and email']].map(([id,label])=><TabsTrigger key={id} value={id}>{t(label)}</TabsTrigger>)}</TabsList>
   <TabsContent value='overview'><div className='grid gap-4 sm:grid-cols-3'>{[[t('Trial calls'),formatNumber(config.policy.calls)],[t('Trial days'),formatNumber(config.policy.days)],[t('Default model'),config.policy.default_model]].map(([label,value])=><Card key={label} className='border border-blue-100 bg-white'><CardHeader><CardTitle className='text-sm text-slate-500'>{label}</CardTitle></CardHeader><CardContent className='text-2xl font-semibold'>{value}</CardContent></Card>)}</div><p className='mt-5 text-sm text-slate-500'>{t('Users sign in once. Provider keys stay on the server.')}</p></TabsContent>
   <TabsContent value='models'><div className='grid gap-5 md:grid-cols-2'>{config.model_providers.map(provider=><Credentials key={provider.provider} name={provider.provider==='deepseek'?'DeepSeek':'千问 / Qwen'} kind={provider.provider} configured={provider.configured} enabled={provider.enabled} save={save} busy={busy}/>)}</div></TabsContent>
   <TabsContent value='accounts'><Accounts save={save} busy={busy}/></TabsContent>
   <TabsContent value='trial'><TrialRules policy={config.policy} save={save} busy={busy}/></TabsContent>
   <TabsContent value='usage'><div className='space-y-5'><UsageRecords save={save} busy={busy}/><AuditRecords/></div></TabsContent>
   <TabsContent value='login'><div className='grid gap-5 md:grid-cols-2'>{config.login_providers.map(provider=><Credentials key={provider.provider} name={provider.provider==='wechat'?'微信 / WeChat':'钉钉 / DingTalk'} kind={provider.provider} configured={provider.configured} enabled={provider.enabled} appId={provider.app_id} callback={provider.callback} save={save} busy={busy}/>)}<MailSettings config={config.smtp} save={save} busy={busy}/></div></TabsContent>
  </Tabs><footer className='flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500'><span>Powered by <a className='underline underline-offset-4' href='https://github.com/QuantumNous/new-api' target='_blank' rel='noopener noreferrer'>New API</a></span><a className='underline underline-offset-4' href='https://github.com/907609732/LTTLT-AI-Customer-Service' target='_blank' rel='noopener noreferrer'>{t('Modified source (AGPL-3.0)')}</a></footer>
 </div><SecureVerificationDialog {...verification.dialogProps}/></main>
}
