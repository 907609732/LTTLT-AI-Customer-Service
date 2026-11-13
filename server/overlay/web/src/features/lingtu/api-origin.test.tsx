import {expect,it} from 'vitest'
import {resolveManagedApiOrigin,resolveManagedCanonicalRedirect} from '@/lib/managed-api-origin'

it('keeps ordinary pages pinned to the public API and only bootstraps on loopback setup',()=>{
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'127.0.0.1',pathname:'/setup'})).toBe('')
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'127.0.0.1',pathname:'/lingtu/admin'})).toBe('https://api.example')
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'account.example',pathname:'/setup'})).toBe('https://api.example')
 expect(resolveManagedApiOrigin('https://api.example',{hostname:'localhost.attacker.example',pathname:'/setup'})).toBe('https://api.example')
})

it('canonicalizes only the exact published Sites origin and preserves the full navigation',()=>{
 expect(resolveManagedCanonicalRedirect('https://lingtu-kefu-account.flutedaura2.chatgpt.site/sign-in?redirect=%2Flingtu%2Fadmin#account')).toBe('https://account-kefu.lttlt.top/sign-in?redirect=%2Flingtu%2Fadmin#account')
 for(const url of ['http://lingtu-kefu-account.flutedaura2.chatgpt.site/sign-in','https://other.chatgpt.site/sign-in','https://lingtu-kefu-account.flutedaura2.chatgpt.site.attacker.example/','https://account-kefu.lttlt.top/sign-in','https://api-kefu.lttlt.top/','http://127.0.0.1/setup','http://localhost/setup','https://lingtu-kefu-account.flutedaura2.chatgpt.site:444/','not a URL'])expect(resolveManagedCanonicalRedirect(url)).toBeNull()
})

it('never turns redirect query strings or double slash paths into an open redirect',()=>{
 const result=resolveManagedCanonicalRedirect('https://lingtu-kefu-account.flutedaura2.chatgpt.site//attacker.example/?redirect=https%3A%2F%2Fattacker.example#https://attacker.example')
 if(!result)throw new Error('Expected canonical target')
 expect(new URL(result).origin).toBe('https://account-kefu.lttlt.top')
 expect(new URL(result).pathname).toBe('//attacker.example/')
 expect(resolveManagedCanonicalRedirect('https://lingtu-kefu-account.flutedaura2.chatgpt.site@attacker.example/')).toBeNull()
})
