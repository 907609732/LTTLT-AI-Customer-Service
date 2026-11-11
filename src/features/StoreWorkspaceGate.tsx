import {useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useManagedAccess} from './ManagedAccess';
import {useBackend} from './BackendProvider';

export function StoreWorkspaceGate({children}:{children:ReactNode}){
 const {state,action}=useManagedAccess();
 const backend=useBackend();
 const busy=useRef(false);
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const legacy=state.workspace.legacyAdoption;
 const choose=async(choice:'adopt'|'skip'|'refresh')=>{
  if(busy.current)return;
  busy.current=true;setPending(true);setError('');
  try{await action(choice);await backend.refresh();}catch(e){setError(e instanceof Error?e.message:'店铺初始化失败，请重试。');}
  finally{busy.current=false;setPending(false);}
 };
 if(window.lingtu?.managedSnapshot&&!state.workspace.workspaceId)return <section className="store-workspace-setup" role="status">正在读取账号状态…</section>;
 if(!legacy?.pending&&state.workspace.mode==='locked'&&window.lingtu?.managedSnapshot){
  const signedIn=state.session.status==='signed_in';
  return <section className="store-workspace-setup" aria-label="店铺服务连接">
   <h2>{signedIn?'店铺服务尚未就绪':'请先登录灵兔账号'}</h2>
   <p>{state.message||state.session.message||(signedIn?'请刷新工作区后重试。':'登录后即可添加拼多多和抖店。')}</p>
   <button onClick={()=>void window.lingtu?.openMain('UX25')}>{signedIn?'查看账号状态':'前往登录'}</button>
   <button disabled={pending} onClick={()=>void choose('refresh')}>重新连接</button>
   {error&&<p role="alert">{error}</p>}
  </section>;
 }
 if(!legacy?.pending)return <>{children}</>;
 return <section className="store-workspace-setup" aria-label="首次使用店铺">
  <h2>首次使用店铺</h2><p>发现本机原有 {legacy.count} 个店铺，请选择是否继续使用。</p>
  <p>归入当前账号前会自动备份，也可以为当前账号创建空白工作区。</p>
  <button disabled={pending||state.session.status!=='signed_in'} onClick={()=>void choose('adopt')}>备份并归入当前账号</button>
  <button disabled={pending||state.session.status!=='signed_in'} onClick={()=>void choose('skip')}>使用空白工作区</button>
  {pending&&<p role="status">正在准备店铺…</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
