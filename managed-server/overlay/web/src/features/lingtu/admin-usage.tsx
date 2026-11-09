import {useQuery} from '@tanstack/react-query'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {StaticDataTable} from '@/components/data-table'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {api} from '@/lib/api'
import {formatNumber, formatTimestamp} from '@/lib/format'

interface UsageTotals{requests:number;successes:number;failed:number;uncertain:number;input_tokens:number;output_tokens:number;total_tokens:number;unknown_usage:number}
interface AccountUsage extends UsageTotals{user_id:number;display_name:string;last_used_at:number}
interface UsageSummary{totals:UsageTotals;items:AccountUsage[];total:number;page:number}
function useUsageSummary(page:number,userId?:number){
 return useQuery({queryKey:['lingtu','usage-summary',page,userId??null],queryFn:async()=>(await api.get<UsageSummary>('/api/lingtu/admin/usage-summary',{params:{page,...(userId?{user_id:userId}:{})}})).data})
}
function TotalsCards(props:{totals:UsageTotals;accounts?:number}){
 const {t}=useTranslation()
 const cards:[string,number|undefined][]=[['Total requests',props.totals.requests],['Successful requests',props.totals.successes],['Failed requests',props.totals.failed],['Uncertain requests',props.totals.uncertain],['Known input tokens',props.totals.input_tokens],['Known output tokens',props.totals.output_tokens],['Known total tokens',props.totals.total_tokens],['Requests without usage',props.totals.unknown_usage]]
 if(props.accounts!==undefined)cards.unshift(['Registered accounts',props.accounts])
 return <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>{cards.map(([label,value])=><Card key={label} className='border border-blue-100 bg-white'><CardHeader><CardTitle className='text-sm text-slate-500'>{t(label)}</CardTitle></CardHeader><CardContent className='text-2xl font-semibold'>{formatNumber(value)}</CardContent></Card>)}</div>
}
export function AdminOverview(props:{onManageAccounts:()=>void;onViewUsage:()=>void}){
 const {t}=useTranslation()
 const summary=useUsageSummary(1)
 const accounts=useQuery({queryKey:['lingtu','accounts',1],queryFn:async()=>(await api.get<{total:number}>('/api/lingtu/admin/accounts',{params:{page:1}})).data})
 return <section className='space-y-4' aria-label={t('Service overview')}>
  <p className='text-sm text-slate-500'>{t('All usage figures cover the full retained history. Missing token usage is counted separately and is never estimated.')}</p>
  <p className='text-sm text-slate-500'>{t('Only actual client model requests appear here. Model connection tests are not included.')}</p>
  {summary.isPending&&<p role='status'>{t('Loading usage summary...')}</p>}
  {summary.isError&&<p role='alert'>{t('Unable to load usage summary')} <Button variant='outline' onClick={()=>void summary.refetch()}>{t('Retry')}</Button></p>}
  {accounts.isError&&<p role='alert'>{t('Unable to load accounts')}</p>}
  {summary.data&&<TotalsCards totals={summary.data.totals} accounts={accounts.data?.total}/>}
  {summary.data?.totals.requests===0&&<p role='status'>{t('No client model requests yet. Usage will appear after a signed-in client makes a real request.')}</p>}
  <div className='flex flex-wrap gap-3'><Button onClick={props.onManageAccounts}>{t('Manage accounts')}</Button><Button variant='outline' onClick={props.onViewUsage}>{t('View usage')}</Button></div>
 </section>
}
export function AccountUsageSummary(props:{userId?:number;onViewUser:(userId:number)=>void}){
 const {t}=useTranslation();const [page,setPage]=useState(1)
 const query=useUsageSummary(page,props.userId)
 let emptyMessage='No usage records yet'
 if(query.isPending)emptyMessage='Loading...'
 else if(query.isError)emptyMessage='Unable to load usage summary'
 return <section className='space-y-4' aria-label={t('Usage by account')}>
  {query.data&&<TotalsCards totals={query.data.totals}/>}
  <Card className='border border-blue-100 bg-white'><CardHeader className='flex flex-row items-center justify-between'><CardTitle>{t('Usage by account')}</CardTitle><Button variant='outline' disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('Refresh')}</Button></CardHeader><CardContent className='space-y-4'>
   <p className='text-sm text-slate-500'>{t('All usage figures cover the full retained history. Missing token usage is counted separately and is never estimated.')}</p>
   <p className='text-sm text-slate-500'>{t('Only actual client model requests appear here. Model connection tests are not included.')}</p>
   {query.isError&&<p role='alert'>{t('Unable to load usage summary')}</p>}
   <StaticDataTable data={query.data?.items||[]} getRowKey={row=>row.user_id} columns={[
    {id:'account',header:t('Account'),cell:row=>`${row.display_name} · ${row.user_id}`},
    {id:'requests',header:t('Total requests'),cell:row=>formatNumber(row.requests)},
    {id:'successes',header:t('Successful requests'),cell:row=>formatNumber(row.successes)},
    {id:'failed',header:t('Failed requests'),cell:row=>formatNumber(row.failed)},
    {id:'uncertain',header:t('Uncertain requests'),cell:row=>formatNumber(row.uncertain)},
    {id:'input',header:t('Known input tokens'),cell:row=>formatNumber(row.input_tokens)},
    {id:'output',header:t('Known output tokens'),cell:row=>formatNumber(row.output_tokens)},
    {id:'total',header:t('Known total tokens'),cell:row=>formatNumber(row.total_tokens)},
    {id:'unknown',header:t('Requests without usage'),cell:row=>formatNumber(row.unknown_usage)},
    {id:'last',header:t('Last used'),cell:row=>formatTimestamp(row.last_used_at)},
    {id:'details',header:t('Actions'),cell:row=><Button variant='outline' onClick={()=>props.onViewUser(row.user_id)}>{t('View account usage')}</Button>},
   ]} emptyContent={t(emptyMessage)}/>
   <nav aria-label={t('Account usage pagination')} className='flex items-center justify-end gap-3'><Button variant='outline' disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>{t('Previous')}</Button><span>{formatNumber(page)} · {t('Total records')}: {formatNumber(query.data?.total)}</span><Button variant='outline' disabled={query.isFetching||page*20>=(query.data?.total||0)} onClick={()=>setPage(page+1)}>{t('Next')}</Button></nav>
  </CardContent></Card>
 </section>
}
