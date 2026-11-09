import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {webcrypto} from 'node:crypto'
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {api} from '@/lib/api'
import {useAuthStore} from '@/stores/auth-store'
import {AdminPage} from './admin-page'

const {verify}=vi.hoisted(()=>({verify:vi.fn(async()=>({proof_token:'fixture-proof'}))}))
vi.mock('@/features/auth/secure-verification',()=>({useSecureVerification:()=>({requestVerification:verify,dialogProps:{}}),SecureVerificationDialog:()=>null}))
const originalAdapter=api.defaults.adapter
const originalAuth=useAuthStore.getState().auth
afterEach(()=>{cleanup();api.defaults.adapter=originalAdapter;useAuthStore.setState({auth:originalAuth});vi.unstubAllGlobals()})
const config={policy:{calls:20,days:7,daily_calls:200,max_tokens:512,default_model:'deepseek-flash'},login_providers:[],model_providers:[],smtp:{}}
function renderAdmin(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><AdminPage/></QueryClientProvider>)}

it('loads paginated usage and audit, requires a reason and confirms reconciliation through proof without resending',async()=>{
 const posts:Record<string,unknown>[]=[];const urls:string[]=[];const pages:number[]=[]
 vi.stubGlobal('crypto',webcrypto)
 useAuthStore.setState({auth:{...useAuthStore.getState().auth,accessToken:'fixture-access',accessExpiresAt:Math.floor(Date.now()/1000)+900}})
 api.defaults.adapter=async request=>{
  urls.push(request.url||'')
  let data:unknown=config
  if(request.url?.endsWith('/usage')){pages.push(Number(request.params?.page||1));data={items:[{user_id:9,request_id:'request-one',state:'uncertain',created_at:1730000000,model:'qwen-plus',input_tokens:12,output_tokens:8,diagnostic:'result_unknown'}],total:21,page:Number(request.params?.page||1)}}
  if(request.url?.endsWith('/audit'))data={items:[{id:1,actor_id:1,target_id:9,section:'account',outcome:'success',reason:'reviewed quota',created_at:1730000000}],total:1,page:1}
  if(request.method==='post'){expect(request.headers['X-Security-Proof']).toBe('fixture-proof');posts.push(JSON.parse(request.data));data={saved:true}}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 renderAdmin()
 fireEvent.click(await screen.findByRole('tab',{name:'Usage records'}))
 expect(await screen.findByText('request-one')).toBeTruthy()
 expect(await screen.findByText('reviewed quota')).toBeTruthy()
 fireEvent.click(screen.getAllByRole('button',{name:'Next'})[0])
 await waitFor(()=>expect(pages).toContain(2))
 await screen.findByText('request-one')
 fireEvent.click(screen.getByRole('button',{name:'Confirm success'}))
 const confirm=await screen.findByRole('button',{name:'Confirm reconciliation'})
 expect(confirm.hasAttribute('disabled')).toBe(true)
 fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Verified upstream result'}})
 fireEvent.click(confirm)
 await waitFor(()=>expect(posts).toEqual([{section:'reconcile',user_id:9,request_id:'request-one',outcome:'success',reason:'Verified upstream result'}]))
 expect(verify).toHaveBeenCalledWith(expect.objectContaining({scope:'admin.user.managed_config',context:expect.objectContaining({section:'reconcile',request_hash:expect.stringMatching(/^[a-f0-9]{64}$/)})}))
 expect(urls.some(url=>url.includes('chat/completions'))).toBe(false)
 await waitFor(()=>expect(screen.queryByRole('alertdialog')).toBeNull())
 expect(screen.getByRole('link',{name:'Modified source (AGPL-3.0)'}).getAttribute('href')).toBe('https://github.com/907609732/LTTLT-AI-Customer-Service')
},20000)

it('provides safe default concurrent and rate caps for older policy responses',async()=>{
 api.defaults.adapter=async request=>({data:config,status:200,statusText:'OK',headers:{},config:request})
 renderAdmin()
 fireEvent.click(await screen.findByRole('tab',{name:'Trial rules'}))
 expect((await screen.findByLabelText('Concurrent requests per account') as HTMLInputElement).value).toBe('1')
 expect((screen.getByLabelText('Requests per minute per account') as HTMLInputElement).value).toBe('5')
 expect((screen.getByLabelText('Global concurrent requests') as HTMLInputElement).value).toBe('4')
})
