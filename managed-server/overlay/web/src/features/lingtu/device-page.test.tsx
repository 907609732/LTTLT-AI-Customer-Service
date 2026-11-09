import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, expect, it} from 'vitest'
import {api} from '@/lib/api'
import {useAuthStore} from '@/stores/auth-store'
import {DevicePage} from './device-page'

const originalAdapter=api.defaults.adapter
afterEach(()=>{api.defaults.adapter=originalAdapter})

it('requires an explicit device confirmation and submits the shown code only once',async()=>{
 useAuthStore.setState({auth:{...useAuthStore.getState().auth,user:{id:9,username:'owner',display_name:'Owner',role:1}}})
 let calls=0
 api.defaults.adapter=async config=>{calls++;expect(config.url).toBe('/api/lingtu/device/approve');expect(JSON.parse(config.data)).toEqual({user_code:'ABCD-EFGH'});return {data:{approved:true},status:200,statusText:'OK',headers:{},config}}
 render(<DevicePage initialCode='ABCD-EFGH' />)
 expect(calls).toBe(0)
 fireEvent.click(screen.getByRole('button',{name:'Confirm sign-in on this computer'}))
 await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Return to Lingtu'))
 expect(calls).toBe(1)
 expect(screen.queryByRole('button',{name:'Confirm sign-in on this computer'})).toBeNull()
})
