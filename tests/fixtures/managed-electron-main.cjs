'use strict';
// This entry point runs only in an isolated Electron fixture; real HTTPS domains are mapped in memory.
const {app,shell}=require('electron');
if(!process.env.LINGTU_DATA_DIR||process.env.LINGTU_INTEGRATION_TEST!=='1')throw Error('isolated_fixture_required');
const now=()=>Math.floor(Date.now()/1000);let user=1;
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
shell.openExternal=async url=>{if(!url.startsWith('https://account-kefu.lttlt.top/lingtu/device?user_code='))throw Error('unexpected_fixture_url');};
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);if(u.origin!=='https://api-kefu.lttlt.top')throw Error('fixture_network_blocked');
 if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(u.pathname.endsWith('/device/authorize'))return reply({device_code:'fixture-device-'+user,user_code:'TEST-'+user,verification_uri:'https://account-kefu.lttlt.top/lingtu/device',verification_uri_complete:'https://account-kefu.lttlt.top/lingtu/device?user_code=TEST-'+user,expires_in:600,interval:1});
 if(u.pathname.endsWith('/device/token')||u.pathname.endsWith('/auth/refresh')){
  const recovered=u.pathname.endsWith('/auth/refresh')?JSON.parse(options.body).refresh_token.split(':'):null;
  const deadline=recovered?.[2]?Number(recovered[2]):now()+2592000;if(recovered?.[1])user=Number(recovered[1]);
  return reply({access_token:'fixture-access',refresh_token:`fixture-refresh:${user}:${deadline}`,access_expires_at:now()+900,expires_at:deadline,user_id:user,session_id:'fixture-session-'+user,token_type:'Bearer'});
 }
 if(u.pathname.endsWith('/me'))return reply({user_id:user,display_name:'隔离账号 '+user,status:'enabled',trial:{limit:20,used:0,reserved:0,remaining:20,expires_at:now()+604800}});
 if(u.pathname.endsWith('/logout')){user++;return reply({ok:true});}
 if(u.pathname.endsWith('/cancel'))return reply({ok:true});
 return reply({error:{code:'model_not_ready'}},503);
};
require('../../electron/main.cjs');
