import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {webcrypto} from 'node:crypto'
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import i18next from 'i18next'
import zh from '@/i18n/locales/zh.json'
import en from '@/i18n/locales/en.json'
import {api} from '@/lib/api'
import {useAuthStore} from '@/stores/auth-store'
import {AdminPage} from './admin-page'

const {verify}=vi.hoisted(()=>({verify:vi.fn(async()=>({proof_token:'fixture-proof'}))}))
vi.mock('@/features/auth/secure-verification',()=>({useSecureVerification:()=>({requestVerification:verify,dialogProps:{}}),SecureVerificationDialog:()=>null}))
const originalAdapter=api.defaults.adapter
const originalAuth=useAuthStore.getState().auth
afterEach(()=>{cleanup();api.defaults.adapter=originalAdapter;useAuthStore.setState({auth:originalAuth});vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks()})
beforeEach(async()=>{localStorage.clear();i18next.addResourceBundle('zhCN','translation',zh.translation,true,true);i18next.addResourceBundle('en','translation',en.translation,true,true);await i18next.changeLanguage('en')})
const config={policy:{calls:20,days:7,daily_calls:200,max_tokens:512,default_model:'deepseek-flash'},login_providers:[],model_providers:[],smtp:{}}
const totals={requests:2,successes:1,failed:0,uncertain:1,input_tokens:12,output_tokens:8,total_tokens:20,unknown_usage:1}
function fixtureData(url:string,params:Record<string,unknown>={},configuration:unknown=config):unknown{
 if(url.endsWith('/accounts'))return {items:[{user_id:9,display_name:'客服小王',status:'enabled',limit:20,used:1,reserved:1,expires_at:1900000000,model:''}],total:1,page:1}
 if(url.endsWith('/usage-summary'))return {totals,items:[{...totals,user_id:9,display_name:'客服小王',last_used_at:1730000000}],total:1,page:Number(params.page||1)}
 if(url.endsWith('/usage'))return {items:[{user_id:9,display_name:'客服小王',request_id:'request-one',state:'uncertain',created_at:1730000000,model:'qwen-plus',input_tokens:0,output_tokens:0,total_tokens:0,usage_known:false,diagnostic:'result_unknown'}],total:21,page:Number(params.page||1)}
 if(url.endsWith('/audit'))return {items:[{id:1,actor_id:1,target_id:9,section:'account',outcome:'success',reason:'reviewed quota',created_at:1730000000}],total:1,page:1}
 return configuration
}
function installFixture(configuration:unknown=config){api.defaults.adapter=async request=>({data:fixtureData(request.url||'',request.params,configuration),status:200,statusText:'OK',headers:{},config:request})}
function allowProtectedSave(){vi.stubGlobal('crypto',webcrypto);useAuthStore.setState({auth:{...useAuthStore.getState().auth,accessToken:'fixture-access',accessExpiresAt:Math.floor(Date.now()/1000)+900}})}
function renderAdmin(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><AdminPage/></QueryClientProvider>)}
async function openModels(){await screen.findByRole('heading',{name:'灵兔客服管理后台'});fireEvent.click(screen.getByRole('tab',{name:'模型配置'}))}

it('exposes all management sections by default in Chinese and persists an English language choice across remounts',async()=>{
 installFixture();const view=renderAdmin()
 await screen.findByRole('heading',{name:'灵兔客服管理后台'})
 for(const name of ['概览','模型配置','账号管理','用量记录','登录方式','试用设置'])expect(screen.getByRole('tab',{name})).toBeTruthy()
 expect(await screen.findByText('账号总数')).toBeTruthy()
 expect(screen.getByText('已返回的词元总量')).toBeTruthy()
 expect(document.documentElement.lang).toBe('zh-CN')
 fireEvent.click(screen.getByRole('button',{name:'English'}))
 await screen.findByRole('heading',{name:'Lingtu customer service administration'})
 for(const name of ['Overview','Model configuration','Account management','Usage records','Sign-in methods','Trial settings'])expect(screen.getByRole('tab',{name})).toBeTruthy()
 expect(document.documentElement.lang).toBe('en')
 expect(localStorage.getItem('lingtu-admin-language')).toBe('en')
 view.unmount();renderAdmin()
 expect(await screen.findByRole('heading',{name:'Lingtu customer service administration'})).toBeTruthy()
 expect(i18next.language).toBe('en')
})

it('filters both per-account totals and request details after selecting an account and labels missing usage honestly',async()=>{
 const requests:{url:string;params:Record<string,unknown>}[]=[]
 api.defaults.adapter=async request=>{requests.push({url:request.url||'',params:request.params||{}});return {data:fixtureData(request.url||'',request.params),status:200,statusText:'OK',headers:{},config:request}}
 renderAdmin();await screen.findByRole('heading',{name:'灵兔客服管理后台'})
 fireEvent.click(screen.getByRole('tab',{name:'账号管理'}))
 fireEvent.click(await screen.findByRole('button',{name:'查看用量'}))
 expect(await screen.findByText('request-one')).toBeTruthy()
 await waitFor(()=>expect(requests.some(request=>request.url.endsWith('/usage-summary')&&request.params.user_id===9)).toBe(true))
 expect(requests.some(request=>request.url.endsWith('/usage')&&request.params.user_id===9)).toBe(true)
 expect((screen.getByLabelText('按账号编号筛选') as HTMLInputElement).value).toBe('9')
 expect(screen.getAllByText('未返回用量')).toHaveLength(2)
 expect(screen.queryByText('0 / 0')).toBeNull()
 expect(screen.queryByText('result_unknown')).toBeNull()
 expect(screen.getByRole('columnheader',{name:'未返回用量的调用'})).toBeTruthy()
 expect(screen.getByText('此处仅统计客户端实际发起的模型调用，不包含模型连接检测。')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'全部账号'}))
 await waitFor(()=>expect((screen.getByLabelText('按账号编号筛选') as HTMLInputElement).value).toBe(''))
})

it('paginates usage and audit and reconciles only through a reason-bound security proof',async()=>{
 const posts:Record<string,unknown>[]=[];const pages:number[]=[];allowProtectedSave()
 api.defaults.adapter=async request=>{
  if(request.url?.endsWith('/usage'))pages.push(Number(request.params?.page||1))
  let data=fixtureData(request.url||'',request.params)
  if(request.method==='post'){expect(request.headers['X-Security-Proof']).toBe('fixture-proof');posts.push(JSON.parse(request.data));data={saved:true}}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 renderAdmin();await screen.findByRole('heading',{name:'灵兔客服管理后台'});fireEvent.click(screen.getByRole('tab',{name:'用量记录'}))
 await screen.findByText('request-one');expect(await screen.findByText('reviewed quota')).toBeTruthy()
 const pagination=screen.getAllByRole('navigation',{name:'记录分页'})[0]
 fireEvent.click(within(pagination).getByRole('button',{name:'下一步'}))
 await waitFor(()=>expect(pages).toContain(2));await screen.findByText('request-one')
 fireEvent.click(screen.getByRole('button',{name:'确认成功'}))
 const confirm=await screen.findByRole('button',{name:'确认对账'});expect(confirm.hasAttribute('disabled')).toBe(true)
 fireEvent.change(screen.getByLabelText('调整原因'),{target:{value:'Verified upstream result'}});fireEvent.click(confirm)
 await waitFor(()=>expect(posts).toEqual([{section:'reconcile',user_id:9,request_id:'request-one',outcome:'success',reason:'Verified upstream result'}]))
 expect(verify).toHaveBeenCalledWith(expect.objectContaining({scope:'admin.user.managed_config',context:expect.objectContaining({section:'reconcile',request_hash:expect.stringMatching(/^[a-f0-9]{64}$/)})}))
},20000)

it('provides default caps and translated friendly model selection in trial settings',async()=>{
 installFixture();renderAdmin();await screen.findByRole('heading',{name:'灵兔客服管理后台'});fireEvent.click(screen.getByRole('tab',{name:'试用设置'}))
 expect((await screen.findByLabelText('每个账号同时调用上限') as HTMLInputElement).value).toBe('1')
 expect((screen.getByLabelText('每个账号每分钟调用上限') as HTMLInputElement).value).toBe('5')
 expect((screen.getByLabelText('全站同时调用上限') as HTMLInputElement).value).toBe('4')
 expect(screen.getByRole('combobox',{name:'默认模型'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'English'}))
 expect(await screen.findByRole('combobox',{name:'Default model'})).toBeTruthy()
})

it('preserves provider key drafts across language changes, navigation, provider changes and refresh, and saves once without storing secrets',async()=>{
 const posts:Record<string,unknown>[]=[];allowProtectedSave()
 api.defaults.adapter=async request=>{
  let data=fixtureData(request.url||'',request.params,{...config,model_providers:[{provider:'deepseek',configured:true,enabled:false},{provider:'qwen',configured:false,enabled:false}]})
  if(request.method==='post'){expect(request.headers['X-Security-Proof']).toBe('fixture-proof');posts.push(JSON.parse(request.data));data={saved:true}}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 const log=vi.spyOn(console,'log');renderAdmin();await openModels()
 const choose=screen.getByRole('combobox',{name:'1. 选择模型'});const key=screen.getByLabelText('模型密钥') as HTMLInputElement
 fireEvent.change(key,{target:{value:' deepseek-fixture-secret '}});fireEvent.change(choose,{target:{value:'qwen'}});fireEvent.change(key,{target:{value:' qwen-fixture-secret '}})
 fireEvent.click(screen.getByRole('button',{name:'English'}));await screen.findByRole('button',{name:'Save and test'})
 expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(' qwen-fixture-secret ')
 fireEvent.click(screen.getByRole('tab',{name:'Account management'}));fireEvent.click(screen.getByRole('tab',{name:'Model configuration'}))
 expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(' qwen-fixture-secret ')
 fireEvent.change(choose,{target:{value:'deepseek'}});expect(key.value).toBe(' deepseek-fixture-secret ')
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));fireEvent.change(choose,{target:{value:'qwen'}})
 const save=screen.getByRole('button',{name:'Save and test'});fireEvent.click(save);fireEvent.click(save)
 await waitFor(()=>expect(posts).toEqual([{section:'qwen',secret:'qwen-fixture-secret',enabled:true,make_default:true}]))
 await waitFor(()=>expect(key.value).toBe(''));fireEvent.change(choose,{target:{value:'deepseek'}});expect(key.value).toBe(' deepseek-fixture-secret ')
 for(let index=0;index<localStorage.length;index++)expect(localStorage.getItem(localStorage.key(index)||'')||'').not.toContain('fixture-secret')
 expect(JSON.stringify(log.mock.calls)).not.toContain('fixture-secret')
},20000)

it('keeps a configured key when the password field is blank',async()=>{
 const posts:Record<string,unknown>[]=[];allowProtectedSave()
 api.defaults.adapter=async request=>{
  let data=fixtureData(request.url||'',request.params,{...config,policy:{...config.policy,default_model:'qwen-plus'},model_providers:[{provider:'qwen',configured:true,enabled:true}]})
  if(request.method==='post'){posts.push(JSON.parse(request.data));data={saved:true}}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 renderAdmin();await openModels();expect((screen.getByRole('combobox',{name:'1. 选择模型'}) as HTMLSelectElement).value).toBe('qwen')
 fireEvent.click(screen.getByRole('button',{name:'保存并检测'}));await waitFor(()=>expect(posts).toEqual([{section:'qwen',secret:'',enabled:true,make_default:true}]))
})

it('preserves WeChat, DingTalk and email drafts across navigation, language changes and refresh',async()=>{
 installFixture({...config,login_providers:[{provider:'wechat',app_id:'',configured:false,enabled:false,callback:'https://fixture.example/wechat'},{provider:'dingtalk',app_id:'',configured:false,enabled:false,callback:'https://fixture.example/dingtalk'}]})
 renderAdmin();await screen.findByRole('heading',{name:'灵兔客服管理后台'})
 expect(document.querySelector('#wechat-secret')).toBeNull()
 fireEvent.click(screen.getByRole('tab',{name:'登录方式'}))
 const wechatId=document.querySelector('#wechat-id') as HTMLInputElement
 const wechatSecret=document.querySelector('#wechat-secret') as HTMLInputElement
 const dingtalkSecret=document.querySelector('#dingtalk-secret') as HTMLInputElement
 const mailServer=document.querySelector('#smtp-server') as HTMLInputElement
 const mailSecret=document.querySelector('#smtp-secret') as HTMLInputElement
 fireEvent.change(wechatId,{target:{value:'fixture-app-id'}})
 fireEvent.change(wechatSecret,{target:{value:'fixture-wechat-draft'}})
 fireEvent.change(dingtalkSecret,{target:{value:'fixture-dingtalk-draft'}})
 fireEvent.change(mailServer,{target:{value:'smtp.fixture.example'}})
 fireEvent.change(mailSecret,{target:{value:'fixture-mail-draft'}})
 fireEvent.click(screen.getByRole('tab',{name:'账号管理'}))
 fireEvent.click(screen.getByRole('button',{name:'English'}))
 fireEvent.click(await screen.findByRole('tab',{name:'Sign-in methods'}))
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
 expect(wechatId.value).toBe('fixture-app-id')
 expect(wechatSecret.value).toBe('fixture-wechat-draft')
 expect(dingtalkSecret.value).toBe('fixture-dingtalk-draft')
 expect(mailServer.value).toBe('smtp.fixture.example')
 expect(mailSecret.value).toBe('fixture-mail-draft')
 expect(screen.getAllByLabelText('Application ID')).toHaveLength(2)
 expect(screen.getByLabelText('Email server')).toBeTruthy()
 for(let index=0;index<localStorage.length;index++)expect(localStorage.getItem(localStorage.key(index)||'')||'').not.toContain('draft')
})

it('prioritizes the native disabled state and prevents grant saves until that account is enabled',async()=>{
 api.defaults.adapter=async request=>{
  let data=fixtureData(request.url||'',request.params)
  if(request.url?.endsWith('/accounts'))data={items:[{user_id:9,display_name:'停用账号',native_status:2,status:'enabled',limit:20,used:1,reserved:0,expires_at:1900000000,model:''}],total:1,page:1}
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 renderAdmin();await screen.findByRole('heading',{name:'灵兔客服管理后台'})
 fireEvent.click(screen.getByRole('tab',{name:'账号管理'}))
 expect(await screen.findByText('主账号系统已停用')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'编辑'}))
 expect(screen.getByText('此账号已在主账号系统中停用。请先在主账号系统启用，再修改模型授权。')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('调整原因'),{target:{value:'fixture reason'}})
 expect(screen.getByRole('button',{name:'保存'}).hasAttribute('disabled')).toBe(true)
 expect(screen.getByRole('button',{name:'保存并撤销登录'}).hasAttribute('disabled')).toBe(true)
})

it('merges untouched trial settings after a model save without reverting the new default or losing quota drafts',async()=>{
 const posts:Record<string,unknown>[]=[];allowProtectedSave()
 let currentConfig={...config,policy:{...config.policy}}
 api.defaults.adapter=async request=>{
  let data=fixtureData(request.url||'',request.params,currentConfig)
  if(request.method==='post'){
   const body=JSON.parse(request.data);posts.push(body)
   if(body.section==='qwen')currentConfig={...currentConfig,policy:{...currentConfig.policy,default_model:'qwen-plus'}}
   if(body.section==='trial')currentConfig={...currentConfig,policy:{...currentConfig.policy,...body}}
   data={saved:true}
  }
  return {data,status:200,statusText:'OK',headers:{},config:request}
 }
 renderAdmin();await screen.findByRole('heading',{name:'灵兔客服管理后台'})
 fireEvent.click(screen.getByRole('tab',{name:'试用设置'}))
 fireEvent.change(screen.getByRole('combobox',{name:'默认模型'}),{target:{value:'qwen-plus'}})
 fireEvent.change(screen.getByRole('combobox',{name:'默认模型'}),{target:{value:'deepseek-flash'}})
 fireEvent.click(screen.getByRole('button',{name:'保存'}))
 await screen.findByText('保存成功，配置已生效。')
 fireEvent.change(screen.getByLabelText('试用次数'),{target:{value:'25'}})
 fireEvent.click(screen.getByRole('tab',{name:'模型配置'}))
 fireEvent.change(screen.getByRole('combobox',{name:'1. 选择模型'}),{target:{value:'qwen'}})
 fireEvent.change(screen.getByLabelText('模型密钥'),{target:{value:'fixture-qwen-key'}})
 fireEvent.click(screen.getByRole('button',{name:'保存并检测'}))
 await screen.findByText('保存成功，配置已生效。')
 fireEvent.click(screen.getByRole('tab',{name:'试用设置'}))
 expect((screen.getByRole('combobox',{name:'默认模型'}) as HTMLSelectElement).value).toBe('qwen-plus')
 expect((screen.getByLabelText('试用次数') as HTMLInputElement).value).toBe('25')
 fireEvent.change(screen.getByLabelText('全站每日试用次数上限'),{target:{value:'300'}})
 fireEvent.click(screen.getByRole('button',{name:'保存'}))
 await waitFor(()=>expect(posts[2]).toMatchObject({section:'trial',default_model:'qwen-plus',model:'qwen-plus',daily_calls:300,calls:25}))
},20000)
