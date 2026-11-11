import {useEffect, useId, useRef, useState} from 'react';
import {ExternalLink, RefreshCw, UserRound} from 'lucide-react';
import './ManagedAccount.css';

export interface ManagedAccountSnapshot {
 status: 'signed_out' | 'authorizing' | 'signed_in' | 'offline' | 'expired' | 'disabled';
 account: null | {userId: string | number; displayName: string; trial: {limit: number; used: number; reserved: number; remaining: number; expiresAt: number}};
 expiresAt: number | null;
 login: null | {userCode: string; expiresAt: number};
 message: string | null;
}
type Action = () => void | Promise<unknown>;
export type ManagedNativeBinding={status:'unclaimed'|'owned'|'other';allowed:boolean;canClaim:boolean;source:'legacy'|'explicit'|null};
export interface ManagedAccountProps {
 snapshot: ManagedAccountSnapshot;
 onLogin: Action;
 onCancelLogin: Action;
 onLogout: Action;
 onRefresh: Action;
 onOpenAdmin?: Action;

}
const date = (seconds: number | null) => seconds && Number.isFinite(seconds)
 ? new Intl.DateTimeFormat('zh-CN', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(seconds * 1000)) : '暂未获取';
const statusLabels: Record<ManagedAccountSnapshot['status'], string> = {
 signed_out:'未登录', authorizing:'等待浏览器确认', signed_in:'已登录', offline:'连接未确认', expired:'登录已到期', disabled:'账号已停用',
};

/** Replaces UX25's account content panel (8801:2697), retaining its surrounding navigation. */
export function ManagedAccount(props: ManagedAccountProps) {
 const {snapshot:s} = props;
 const titleId = useId();
 const locked = useRef(false);
 const mounted = useRef(true);
 const [pending,setPending] = useState(false);
 const [error,setError] = useState('');
 const [now,setNow] = useState(() => Date.now()/1000);
 useEffect(() => {mounted.current=true;return () => {mounted.current=false;};}, []);
 useEffect(() => {const timer = setInterval(() => setNow(Date.now()/1000), 1000);return () => clearInterval(timer);}, []);
 const run = async (action: Action) => {
  if (locked.current) return;
  locked.current=true;setPending(true);setError('');
  try {await action();} catch {if(mounted.current)setError('操作未完成，请检查网络后重试。');}
  finally {locked.current=false;if(mounted.current)setPending(false);}
 };
 const loggedIn = s.status==='signed_in';
 const hasAccount = s.account !== null;
 const timedOut = !!s.login && s.login.expiresAt<=now;
 const trialExpired = !!s.account && s.account.trial.expiresAt<=now;
 const login = (label='登录 / 注册灵兔账号') => <button className="managed-account-primary" disabled={pending} onClick={() => void run(props.onLogin)}><ExternalLink size={16} aria-hidden="true"/>{label}</button>;
 return <section className="managed-account" aria-labelledby={titleId} aria-busy={pending} data-design-source="UX25:8801:2697">
  <header className="managed-account-heading"><h2 id={titleId}>登录账号</h2><span>灵兔账号与 AI 服务</span></header>
  <div className="managed-account-body">
   <section className="managed-account-card" data-design-source="UX25:8801:2754">
    <div className="managed-account-identity"><span className="managed-account-avatar"><UserRound size={26} aria-hidden="true"/></span><div><h3>{hasAccount?s.account!.displayName:'灵兔账号'}</h3><span className={'managed-account-status managed-account-status-'+s.status}>{statusLabels[s.status]}</span></div></div>
    {props.onOpenAdmin&&<div className="managed-account-actions"><button disabled={pending} onClick={()=>void run(props.onOpenAdmin!)}><ExternalLink size={16} aria-hidden="true"/>服务端管理后台</button></div>}
    <div className="managed-account-content" aria-live="polite">
     {s.status==='signed_out'&&<><h3>登录后即可使用托管 AI 模型</h3><p>新账号获得 20 次试用，有效期 7 天。在浏览器中选择微信、钉钉或邮箱登录，无需填写模型 Key。</p>{login()}</>}
     {s.status==='authorizing'&&<><h3>{timedOut?'本次登录确认已到期':'请在浏览器中完成登录'}</h3><p>在浏览器选择微信、钉钉或邮箱，并核对以下确认码后关联此软件。</p>{s.login?<><div className="managed-account-code" aria-label={'登录确认码 '+s.login.userCode}>{s.login.userCode}</div><p>确认码有效至 <time dateTime={new Date(s.login.expiresAt*1000).toISOString()}>{date(s.login.expiresAt)}</time></p></>:<p>正在准备登录确认码…</p>}<div className="managed-account-actions">{timedOut&&login('重新登录')}<button disabled={pending} onClick={() => void run(props.onCancelLogin)}>取消本次登录</button></div></>}
     {s.status==='offline'&&<><h3>暂时无法确认账号状态</h3><p>请检查网络后重试，联网确认账号后才能使用托管模型；当前不会提供离线模型授权。</p><button disabled={pending} onClick={() => void run(props.onRefresh)}><RefreshCw size={15} aria-hidden="true"/>重新连接</button>{!hasAccount&&login('重新发起登录')}</>}
     {s.status==='expired'&&<><h3>请重新登录</h3><p>登录已到期或已被撤销。重新认证后可继续检查账号授权，登录不会重新发放试用。</p>{login('重新登录')}</>}
     {s.status==='disabled'&&<><h3>此账号暂时无法使用托管模型</h3><p>请联系管理员确认账号状态，或退出后登录其他账号。</p><button disabled={pending} onClick={() => void run(props.onRefresh)}>刷新账号状态</button></>}
     {loggedIn&&<><h3>托管 AI 服务</h3><p>模型由灵兔统一提供，无需填写模型 Key。AI 接待需在店铺中手动开启。</p></>}
    </div>
    {hasAccount&&<><div className="managed-account-trial"><div><span>{s.status==='offline'?'上次同步的试用余量':'试用剩余'}</span><p><strong>{s.account!.trial.remaining}</strong> / {s.account!.trial.limit} 次</p></div><dl><div><dt>试用有效期</dt><dd>{date(s.account!.trial.expiresAt)}{trialExpired?'（已到期）':''}</dd></div><div><dt>已使用 / 待确认</dt><dd>{s.account!.trial.used} / {s.account!.trial.reserved} 次</dd></div><div><dt>本次登录有效至</dt><dd>{date(s.expiresAt)}</dd></div></dl></div>{loggedIn&&(trialExpired||s.account!.trial.remaining<=0)&&<p className="managed-account-warning" role="status">{trialExpired?'试用已到期':'试用次数已用完'}，请联系管理员确认后续授权。</p>}</>}
    {(loggedIn||hasAccount||s.status==='offline'||s.status==='expired'||s.status==='disabled')&&<footer className="managed-account-actions">{loggedIn&&<button disabled={pending} onClick={() => void run(props.onRefresh)}><RefreshCw size={15} aria-hidden="true"/>刷新状态</button>}<button disabled={pending} onClick={() => void run(props.onLogout)}>退出登录</button></footer>}
   </section>
   {s.message&&<p className="managed-account-message" role="status">{s.message}</p>}
   {error&&<p className="managed-account-warning" role="alert">{error}</p>}
   {pending&&<p className="managed-account-message" role="status">正在处理，请稍候…</p>}
  </div>
 </section>;
}
