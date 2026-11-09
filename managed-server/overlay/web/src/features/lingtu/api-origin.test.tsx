import {expect,it} from 'vitest'
import {resolveManagedApiOrigin} from '@/lib/managed-api-origin'

it('keeps ordinary pages pinned to the public API and only bootstraps on loopback setup',()=>{
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'127.0.0.1',pathname:'/setup'})).toBe('')
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'127.0.0.1',pathname:'/lingtu/admin'})).toBe('https://api.example')
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'account.example',pathname:'/setup'})).toBe('https://api.example')
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'localhost.attacker.example',pathname:'/setup'})).toBe('https://api.example')
})
