// Only the first-run setup opened through a loopback tunnel uses that tunnel.
// Public pages and all normal authentication continue using the fixed API origin.
export function resolveManagedApiOrigin(buildOrigin:string,location:Pick<Location,'hostname'|'pathname'>):string{
 const loopback=['127.0.0.1','localhost','[::1]'].includes(location.hostname)
 if(loopback&&/^\/setup\/?$/.test(location.pathname))return ''
 return buildOrigin
}
export function resolveManagedCanonicalRedirect(href:string):string|null{
 try{
  const source=new URL(href)
  if(source.origin!=='https://lingtu-kefu-account.flutedaura2.chatgpt.site')return null
  const target=new URL('https://account-kefu.lttlt.top')
  target.pathname=source.pathname
  target.search=source.search
  target.hash=source.hash
  return target.href
 }catch{return null}
}
// Run during API module initialization, before the app starts authentication requests.
if(typeof window!=='undefined'){
 const target=resolveManagedCanonicalRedirect(window.location.href)
 if(target)window.location.replace(target)
}
const buildOrigin=import.meta.env?.VITE_MANAGED_API_ORIGIN||''
export const managedApiOrigin=typeof window==='undefined'?buildOrigin:resolveManagedApiOrigin(buildOrigin,window.location)
