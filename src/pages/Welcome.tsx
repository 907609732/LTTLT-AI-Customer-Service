import {useEffect,useState} from 'react';
import {Save,RotateCcw,Eye} from 'lucide-react';
import type {AppSettings,Store} from '../types';
import Modal from '../components/Modal';
export default function Welcome({settings,onSave,store,onDirty}:{settings:AppSettings;onSave:(s:AppSettings)=>boolean;store?:Store;onDirty:(dirty:boolean)=>void}){
 const [draft,setDraft]=useState(settings.welcome);const [saved,setSaved]=useState('');const [preview,setPreview]=useState(false);const dirty=draft!==settings.welcome;
 useEffect(()=>{setDraft(settings.welcome);setSaved('');},[store?.id]);
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
 function save(){if(!draft.trim()){setSaved('欢迎语不能为空');return;}if(onSave({...settings,welcome:draft.trim()}))setSaved('已保存到当前演示店铺的本地配置');}
 return <div className="page-content"><div className="page-heading"><div><div className="eyebrow">UX11 · RECEPTION</div><h1>进店欢迎</h1><p>{store?`当前演示店铺：${store.name}`:'先在首页添加并选择一个演示店铺'}</p></div><span className="tag">{dirty?'有未保存修改':'已保存状态'}</span></div><section className="panel form-panel"><header><h2>欢迎内容</h2><span className="muted">本地配置 · 不会实际发送</span></header><label htmlFor="welcome-text">欢迎语</label><textarea id="welcome-text" maxLength={500} disabled={!store} value={draft} onChange={e=>{setDraft(e.target.value);setSaved('');}}/><div className="field-footer"><span>新咨询的欢迎文案；真实触发规则待接入。</span><span>{draft.length} / 500</span></div><div className="form-actions"><button className="primary" disabled={!store||!dirty||!draft.trim()} onClick={save}><Save size={16}/>保存配置</button><button className="secondary" disabled={!dirty} onClick={()=>{setDraft(settings.welcome);setSaved('已恢复已保存内容');}}><RotateCcw size={16}/>恢复已保存</button><button className="secondary" disabled={!store} onClick={()=>setPreview(true)}><Eye size={16}/>预览</button></div>{saved&&<p role="status" className="save-feedback">{saved}</p>}</section>{preview&&<Modal title="欢迎语预览" onClose={()=>setPreview(false)}><p className="chat-bubble">{draft}</p><p className="muted">仅本地预览，不发送消息。</p></Modal>}</div>;
}
