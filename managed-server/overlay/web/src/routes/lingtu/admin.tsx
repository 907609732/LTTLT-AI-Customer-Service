import {createFileRoute, redirect} from '@tanstack/react-router'
import {AdminPage} from '@/features/lingtu/admin-page'
import {resolveAuthentication} from '@/lib/auth-session'
import {useAuthStore} from '@/stores/auth-store'

export const Route=createFileRoute('/lingtu/admin')({
 beforeLoad:async({location})=>{
  await resolveAuthentication();const {auth}=useAuthStore.getState()
  if(!auth.user||!auth.accessToken)throw redirect({to:'/sign-in',search:{redirect:location.href}})
  if(auth.user.role<10)throw redirect({to:'/403'})
 },
 component:AdminPage,
})
