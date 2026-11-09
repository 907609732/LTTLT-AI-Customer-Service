// Only the first-run setup opened through a loopback tunnel uses that tunnel.
// Public pages and all normal authentication continue using the fixed API origin.
export function resolveManagedApiOrigin(buildOrigin:string,location:Pick<Location,'hostname'|'pathname'>):string{
 const loopback=['127.0.0.1','localhost','[::1]'].includes(location.hostname)
 if(loopback&&/^\/setup\/?$/.test(location.pathname))return ''
 return buildOrigin
}
export const managedApiOrigin=resolveManagedApiOrigin(import.meta.env.VITE_MANAGED_API_ORIGIN||'',window.location)
