import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {webcrypto} from 'node:crypto'
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import i18next from 'i18next'
import zh from '@/i18n/locales/zh.json'
import {api} from '@/lib/api'
import {useAuthStore} from '@/stores/auth-store'
import {AdminPage} from './admin-page'

const {verify}=vi.hoisted(()=>({verify:vi.fn(async()=>({proof_token:'fixture-proof'}))}))
vi.mock('@/features/auth/secure-verification',()=>({useSecureVerification:()=>({requestVerification:verify,dialogProps:{}}),SecureVerificationDialog:()=>null}))
const originalAdapter=api.defaults.adapter
const originalAuth=useAuthStore.getState().auth
afterEach(()=>{cleanup();api.defaults.adapter=originalAdapter;useAuthStore.setState({auth:originalAuth});vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks()})
beforeEach(async()=>{i18next.addResourceBundle('zh','translation',zh.translation,true,true);await i18next.changeLanguage('en')})
function expandAdvanced(){const summary=screen.getByText('更多设置（账号、登录、试用额度）');const details=summary.closest('details');if(details)details.open=true}
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
 await screen.findByRole('heading',{name:'灵兔客服 · 简单配置'});expandAdvanced()
 fireEvent.click(screen.getByRole('tab',{name:'使用记录'}))
 expect(await screen.findByText('request-one')).toBeTruthy()
 expect(await screen.findByText('reviewed quota')).toBeTruthy()
 fireEvent.click(screen.getAllByRole('button',{name:'下一步'})[0])
 await waitFor(()=>expect(pages).toContain(2))
 await screen.findByText('request-one')
 fireEvent.click(screen.getByRole('button',{name:'确认成功'}))
 const confirm=await screen.findByRole('button',{name:'确认对账'})
 expect(confirm.hasAttribute('disabled')).toBe(true)
 fireEvent.change(screen.getByLabelText('调整原因'),{target:{value:'Verified upstream result'}})
 fireEvent.click(confirm)
 await waitFor(()=>expect(posts).toEqual([{section:'reconcile',user_id:9,request_id:'request-one',outcome:'success',reason:'Verified upstream result'}]))
 expect(verify).toHaveBeenCalledWith(expect.objectContaining({scope:'admin.user.managed_config',context:expect.objectContaining({section:'reconcile',request_hash:expect.stringMatching(/^[a-f0-9]{64}$/)})}))
 expect(urls.some(url=>url.includes('chat/completions'))).toBe(false)
 await waitFor(()=>expect(screen.queryByRole('alertdialog')).toBeNull())
 expect(screen.getByRole('link',{name:'修改版源代码（AGPL-3.0）'}).getAttribute('href')).toBe('https://github.com/907609732/LTTLT-AI-Customer-Service')
},20000)

it('provides safe default concurrent and rate caps for older policy responses',async()=>{
 api.defaults.adapter=async request=>({data:config,status:200,statusText:'OK',headers:{},config:request})
 renderAdmin()
 await screen.findByRole('heading',{name:'灵兔客服 · 简单配置'});expandAdvanced()
 fireEvent.click(screen.getByRole('tab',{name:'试用规则'}))
 expect((await screen.findByLabelText('每个账号同时调用上限') as HTMLInputElement).value).toBe('1')
 expect((screen.getByLabelText('每个账号每分钟调用上限') as HTMLInputElement).value).toBe('5')
 expect((screen.getByLabelText('全站同时调用上限') as HTMLInputElement).value).toBe('4')
})

it('shows a Chinese simple setup under English locale with advanced settings initially closed',async()=>{
 api.defaults.adapter=async request=>({data:config,status:200,statusText:'OK',headers:{},config:request})
 renderAdmin()
 await screen.findByRole('heading',{name:'灵兔客服 · 简单配置'})
 expect(screen.getByText('更多设置（账号、登录、试用额度）').closest('details')?.open).toBe(false)
 expect(screen.getByRole('combobox',{name:'1. 选择模型'})).toBeTruthy()
 expect(screen.getByLabelText('模型密钥').getAttribute('type')).toBe('password')
 expect(screen.queryAllByRole('textbox')).toHaveLength(0)
 expect(screen.getByRole('button',{name:'保存并检测'}).hasAttribute('disabled')).toBe(true)
 expect(screen.getByText(/初始化时创建的管理员密码/)).toBeTruthy()
 expect(i18next.language).toBe('zh')
})

it('keeps independent provider drafts across switches and server refresh, then saves once with proof and default selection',async()=>{
 const posts:Record<string,unknown>[]=[]
 vi.stubGlobal('crypto',webcrypto)
 useAuthStore.setState({auth:{...useAuthStore.getState().auth,accessToken:'fixture-access',accessExpiresAt:Math.floor(Date.now()/1000)+900}})
 api.defaults.adapter=async request=>{
  let data:unknown={...config,model_providers:[{provider:'deepseek',configured:true,enabled:false},{provider:'qwen',configured:false,enabled:false}]}
  if(request.method==='post'){expect(request.headers['X-Security-Proof']).toBe('fixture-proof');posts.push(JSON.parse(request.data));data={saved:true}}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 const log=vi.spyOn(console,'log')
 renderAdmin()
 await screen.findByRole('heading',{name:'灵兔客服 · 简单配置'})
 expect(screen.getByText(/已配置 · 当前停用/)).toBeTruthy()
 const choose=screen.getByRole('combobox',{name:'1. 选择模型'})
 const key=screen.getByLabelText('模型密钥') as HTMLInputElement
 fireEvent.change(key,{target:{value:' deepseek-fixture-secret '}})
 fireEvent.change(choose,{target:{value:'qwen'}})
 expect(key.value).toBe('')
 fireEvent.change(key,{target:{value:' qwen-fixture-secret '}})
 fireEvent.change(choose,{target:{value:'deepseek'}})
 expect(key.value).toBe(' deepseek-fixture-secret ')
 fireEvent.click(screen.getByRole('button',{name:'刷新'}))
 await waitFor(()=>expect(key.value).toBe(' deepseek-fixture-secret '))
 fireEvent.change(choose,{target:{value:'qwen'}})
 expect(key.value).toBe(' qwen-fixture-secret ')
 const save=screen.getByRole('button',{name:'保存并检测'})
 fireEvent.click(save);fireEvent.click(save)
 await waitFor(()=>expect(posts).toEqual([{section:'qwen',secret:'qwen-fixture-secret',enabled:true,make_default:true}]))
 await waitFor(()=>expect(key.value).toBe(''))
 fireEvent.change(choose,{target:{value:'deepseek'}})
 expect(key.value).toBe(' deepseek-fixture-secret ')
 for(let index=0;index<localStorage.length;index++)expect(localStorage.getItem(localStorage.key(index)||'')).not.toContain('fixture-secret')
 expect(JSON.stringify(log.mock.calls)).not.toContain('fixture-secret')
 expect(verify).toHaveBeenCalledWith(expect.objectContaining({scope:'admin.user.managed_config',title:'请输入管理员密码确认本次修改'}))
},20000)

it('keeps a configured key when the simple password field is left blank',async()=>{
 const posts:Record<string,unknown>[]=[]
 vi.stubGlobal('crypto',webcrypto)
 useAuthStore.setState({auth:{...useAuthStore.getState().auth,accessToken:'fixture-access',accessExpiresAt:Math.floor(Date.now()/1000)+900}})
 api.defaults.adapter=async request=>{
  let data:unknown={...config,policy:{...config.policy,default_model:'qwen-plus'},model_providers:[{provider:'qwen',configured:true,enabled:true}]}
  if(request.method==='post'){posts.push(JSON.parse(request.data));data={saved:true}}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 renderAdmin()
 await screen.findByRole('heading',{name:'灵兔客服 · 简单配置'})
 expect((screen.getByRole('combobox',{name:'1. 选择模型'}) as HTMLSelectElement).value).toBe('qwen')
 fireEvent.click(screen.getByRole('button',{name:'保存并检测'}))
 await waitFor(()=>expect(posts).toEqual([{section:'qwen',secret:'',enabled:true,make_default:true}]))
})
