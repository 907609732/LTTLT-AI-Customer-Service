import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {api} from '@/lib/api'
import {useAuthStore} from '@/stores/auth-store'
import {DevicePage} from './device-page'

const originalAdapter=api.defaults.adapter
const originalAuth=useAuthStore.getState().auth
const {navigate}=vi.hoisted(()=>({navigate:vi.fn(async()=>{})}))
vi.mock('@tanstack/react-router',()=>({useNavigate:()=>navigate}))
function renderDevice(){const client=new QueryClient();client.setQueryData(['private-account'],{secret:'fixture'});render(<QueryClientProvider client={client}><DevicePage initialCode='ABCD-EFGH'/></QueryClientProvider>);return client}
afterEach(()=>{cleanup();api.defaults.adapter=originalAdapter;useAuthStore.setState({auth:originalAuth});vi.clearAllMocks()})

it('requires an explicit device confirmation and submits the shown code only once',async()=>{
 useAuthStore.setState({auth:{...useAuthStore.getState().auth,user:{id:9,username:'owner',display_name:'Owner',role:1}}})
 let calls=0
 api.defaults.adapter=async config=>{calls++;expect(config.url).toBe('/api/lingtu/device/approve');expect(JSON.parse(config.data)).toEqual({user_code:'ABCD-EFGH'});return {data:{approved:true},status:200,statusText:'OK',headers:{},config}}
 renderDevice()
 expect(calls).toBe(0)
 fireEvent.click(screen.getByRole('button',{name:'Confirm sign-in on this computer'}))
 await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Return to Lingtu'))
 expect(calls).toBe(1)
 expect(screen.queryByRole('button',{name:'Confirm sign-in on this computer'})).toBeNull()
})

it('signs out before switching accounts and preserves the edited device code without approving',async()=>{
 useAuthStore.setState({auth:{...originalAuth,user:{id:9,username:'owner',role:1},accessToken:'fixture-token'}})
 const requests:string[]=[]
 api.defaults.adapter=async config=>{requests.push(config.url??'');return {data:{success:true},status:200,statusText:'OK',headers:{},config}}
 const client=renderDevice()
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'JKLM-NPQR'}})
 fireEvent.click(screen.getByRole('button',{name:'Switch account'}))
 await waitFor(()=>expect(navigate).toHaveBeenCalledWith({to:'/sign-in',search:{redirect:'/lingtu/device?user_code=JKLM-NPQR'},replace:true}))
 expect(requests).toEqual(['/api/user/auth/logout'])
 expect(useAuthStore.getState().auth.user).toBeNull()
 expect(client.getQueryData(['private-account'])).toBeUndefined()
})

it('keeps the current account and device code when sign-out fails',async()=>{
 useAuthStore.setState({auth:{...originalAuth,user:{id:9,username:'owner',role:1},accessToken:'fixture-token'}})
 api.defaults.adapter=async config=>({data:{success:false},status:200,statusText:'OK',headers:{},config})
 renderDevice()
 fireEvent.click(screen.getByRole('button',{name:'Switch account'}))
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Failed to sign out session'))
 expect(navigate).not.toHaveBeenCalled()
 expect(useAuthStore.getState().auth.user?.id).toBe(9)
 expect(screen.getByRole('textbox').getAttribute('value')).toBe('ABCD-EFGH')
})
