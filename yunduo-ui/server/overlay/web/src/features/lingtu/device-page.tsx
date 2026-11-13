import {useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {api} from '@/lib/api'
import {useAuthStore} from '@/stores/auth-store'
import {logout} from '@/features/auth/api'
import {clearAuthenticatedClientState} from '@/lib/auth-session'
import './admin-light.css'

export function DevicePage(props:{initialCode:string}){
 const {t}=useTranslation()
 const navigate=useNavigate()
 const queryClient=useQueryClient()
 const user=useAuthStore(state=>state.auth.user)
 const [code,setCode]=useState(props.initialCode.toUpperCase())
 const [state,setState]=useState<'ready'|'submitting'|'switching'|'approved'>('ready')
 const busy=state==='submitting'||state==='switching'
 const [error,setError]=useState('')
 const submitting=useRef(false)
 async function switchAccount():Promise<void>{
  if(submitting.current||state==='approved')return
  submitting.current=true;setState('switching');setError('')
  try{
   const result=await logout()
   if(!result.success)throw new Error('Sign-out failed')
   clearAuthenticatedClientState(queryClient)
   await navigate({to:'/sign-in',search:{redirect:`/lingtu/device?${new URLSearchParams({user_code:code})}`},replace:true})
  }catch{setError(t('Failed to sign out session'))}
  finally{submitting.current=false;setState('ready')}
 }
 async function approve():Promise<void>{
  if(submitting.current||state==='approved'||! /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(code))return
  submitting.current=true;setState('submitting');setError('')
  try{
   const result=await api.post<{approved:boolean}>('/api/lingtu/device/approve',{user_code:code})
   if(!result.data.approved)throw new Error('Device approval failed')
   setState('approved')
  }catch{setState('ready');setError(t('The code expired or approval failed. Start sign-in again in Lingtu.'))}
  finally{submitting.current=false}
 }
 return <main className='lingtu-admin-light flex min-h-screen items-center justify-center bg-blue-50 p-6 text-slate-800'>
  <Card className='w-full max-w-lg border border-blue-100 bg-white shadow-xl shadow-blue-100/50'>
   <CardHeader><p className='text-sm font-semibold text-blue-600'>{t('Lingtu customer service')}</p><CardTitle className='text-2xl'>{t('Lingtu device sign-in')}</CardTitle></CardHeader>
   <CardContent className='space-y-5'>
    {state==='approved'?<p role='status' className='rounded-xl bg-emerald-50 p-5 text-emerald-700'>{t('Approved. Return to Lingtu to continue.')}</p>:<>
     <div className='flex flex-wrap items-center justify-between gap-3'><p className='min-w-0 break-words'>{t('Signed in as')}: <strong>{user?.display_name||user?.username}</strong></p><Button variant='outline' className='shrink-0 border-blue-200 bg-white text-blue-700 hover:bg-blue-50' disabled={busy} onClick={()=>void switchAccount()}>{t('Switch account')}</Button></div>
     <p className='text-sm text-slate-500'>{t('Only approve if this code matches the one shown in your Lingtu app.')}</p>
     <div className='space-y-2'><Label htmlFor='device-code'>{t('Confirmation code')}</Label><Input id='device-code' value={code} maxLength={9} disabled={busy} onChange={event=>setCode(event.target.value.toUpperCase())} className='h-14 border-slate-300 bg-slate-50 text-center font-mono text-2xl tracking-widest text-slate-900 dark:bg-slate-50 md:text-2xl' autoComplete='off' spellCheck={false}/></div>
     {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
     <Button className='h-11 w-full bg-blue-600 text-white hover:bg-blue-700' disabled={busy||! /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(code)} onClick={()=>void approve()}>{t('Confirm sign-in on this computer')}</Button>
     <p className='text-sm text-slate-600'>{t('Your model keys remain on the server.')}</p>
    </>}
    <footer className='flex flex-wrap gap-x-4 gap-y-2 border-t border-blue-50 pt-4 text-xs text-slate-500'><span>Powered by <a className='underline underline-offset-4' href='https://github.com/QuantumNous/new-api' target='_blank' rel='noopener noreferrer'>New API</a></span><a className='underline underline-offset-4' href='https://github.com/907609732/LTTLT-AI-Customer-Service' target='_blank' rel='noopener noreferrer'>{t('Modified source (AGPL-3.0)')}</a></footer>
   </CardContent>
  </Card>
 </main>
}
