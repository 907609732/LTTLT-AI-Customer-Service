import {createFileRoute, redirect} from '@tanstack/react-router'
import {DevicePage} from '@/features/lingtu/device-page'
import {resolveAuthentication} from '@/lib/auth-session'
import {useAuthStore} from '@/stores/auth-store'

export const Route=createFileRoute('/lingtu/device')({
 validateSearch:(search:Record<string,unknown>)=>({user_code:typeof search.user_code==='string'?search.user_code:''}),
 beforeLoad:async({location})=>{
  await resolveAuthentication()
  const {auth}=useAuthStore.getState()
  if(!auth.user||!auth.accessToken)throw redirect({to:'/sign-in',search:{redirect:location.href}})
 },
 component:DeviceRoute,
})
function DeviceRoute(){const search=Route.useSearch();return <DevicePage initialCode={search.user_code}/>}
