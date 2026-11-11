import {useState} from 'react';
import type {FormEvent} from 'react';
import {useBackend} from './BackendProvider';
import {modelProviders,detectModelProvider} from '../../shared/model-providers.mjs';
type Provider='deepseek'|'qwen'|'custom';

export function ModelSettings({notice}:{notice:(message:string)=>void}){
 const b=useBackend(),saved=b.snapshot.config.ai;
 const initial:Provider=saved.baseUrl?detectModelProvider(saved.baseUrl):'deepseek';
 const [provider,setProvider]=useState<Provider>(initial);
 const [baseUrl,setBaseUrl]=useState(saved.baseUrl||modelProviders.deepseek.baseUrl);
 const [model,setModel]=useState(saved.baseUrl?saved.model:modelProviders.deepseek.model);
 const [apiKey,setApiKey]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const canKeepKey=b.snapshot.capabilities.apiKeyConfigured&&baseUrl.replace(/\/+$/,'')===saved.baseUrl.replace(/\/+$/,'');
 const choose=(next:Provider)=>{setProvider(next);setApiKey('');setError('');if(next!=='custom'){setBaseUrl(modelProviders[next].baseUrl);setModel(modelProviders[next].model);}};
 const save=async(e:FormEvent)=>{
  e.preventDefault();if(pending)return;setPending(true);setError('');
  try{const result=await b.execute({action:'save-model-settings',values:{baseUrl:baseUrl.trim(),model:model.trim(),...(apiKey.trim()?{apiKey:apiKey.trim()}:{}),testConnection:true}});setApiKey('');b.setSettings(false);notice(result.message||'连接成功，模型设置已保存。');}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
 };
 const getKey=async()=>{if(provider==='custom')return;setPending(true);setError('');try{await b.execute({action:'open-model-key-page',values:{provider}});}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}};
 return <div className="live-settings-mask" role="dialog" aria-modal="true" aria-label="模型接口设置">
  <form className="live-settings model-provider-settings" onSubmit={save}>
   <h2>连接 AI 模型</h2><p>选择厂商，粘贴 API Key，即可完成连接。设置应用于全部店铺。</p>
   <fieldset disabled={pending}>
    <label>模型厂商<select aria-label="模型厂商" value={provider} onChange={e=>choose(e.target.value as Provider)}><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 · 百炼（北京）</option><option value="custom">自定义 / 本地模型</option></select></label>
    <label>API Key<input aria-label="模型API Key" type="password" autoComplete="off" value={apiKey} required={!canKeepKey&&provider!=='custom'} placeholder={canKeepKey?'已安全保存，留空继续使用':'粘贴此厂商的 API Key'} onChange={e=>setApiKey(e.target.value)}/></label>
    {provider!=='custom'&&<><button type="button" onClick={()=>void getKey()}>获取 API Key</button><span className="model-key-help">在本地浏览器登录官方平台后复制密钥</span><p className="model-preset-note">已自动配置模型：{model}{provider==='qwen'?' · 使用百炼北京地域 API Key':''}</p></>}
    <details key={provider} open={provider==='custom'?true:undefined}><summary>高级设置</summary><label>接口地址<input aria-label="模型接口地址" type="url" required value={baseUrl} onChange={e=>{setBaseUrl(e.target.value);setApiKey('');}}/></label><label>模型名称<input aria-label="模型名称" required value={model} onChange={e=>setModel(e.target.value)}/></label>{provider==='qwen'&&<p>其他地域或专属业务空间请填写官方提供的接口地址及对应密钥。</p>}</details>
   </fieldset>
   <p>密钥使用系统加密存储。连接测试会发送一条简短测试消息，费用按厂商计费；不会开启店铺自动回复。</p>
   {error&&<p role="alert">{error}</p>}
   <footer><button type="button" disabled={pending} onClick={()=>b.setSettings(false)}>取消</button><button disabled={pending}>{pending?'正在处理…':'测试连接并保存'}</button></footer>
  </form>
 </div>;
}
