import {useEffect,useRef,useState} from 'react';
import type {FormEvent,KeyboardEvent} from 'react';
import {useBackend} from './BackendProvider';

type Message={from:'buyer'|'seller';content:string};
function displayError(value:unknown){
 const text=value instanceof Error?value.message:String(value);
 if(text.includes('ai_base_url_missing'))return '请先在模型接口设置中配置模型。';
 if(text.includes('ai_api_key_missing'))return '请先配置模型的 API Key。';
 if(text.includes('llm_timeout'))return '模型响应超时，请稍后重试。';
 return text;
}
export function TrainingGround(){const b=useBackend();return <TrainingEditor key={b.snapshot.workspaceId}/>;}
function TrainingEditor(){
 const backend=useBackend(),[history,setHistory]=useState<Message[]>([]),[question,setQuestion]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const busy=useRef(false),[storeId,setStoreId]=useState(''),[productId,setProductId]=useState(''),[imageText,setImageText]=useState('');
 useEffect(()=>{setHistory([]);setQuestion('');setStoreId('');setError('');},[backend.snapshot.workspaceId]);
 const send=async(e?:FormEvent)=>{e?.preventDefault();const images=imageText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),text=question.trim()||(images.length?'请描述图片中与商品相关的信息；不确定的细节请先询问。':'');if(!text||busy.current)return;busy.current=true;setPending(true);setError('');try{
  const result=await backend.execute({action:'start-training',...(storeId?{storeId}:{}),values:{question:text,...(images.length?{images}:{}),...(productId.trim()?{productId:productId.trim()}:{}),history:history.slice(-20)}});
  const reply=String(result.data?.reply||'');if(!reply)throw Error('模型没有返回可显示的回复');
  setHistory(old=>[...old,{from:'buyer',content:text},{from:'seller',content:reply}]);setQuestion('');setImageText('');
 }catch(e){setError(displayError(e))}finally{busy.current=false;setPending(false)}};
 const onKeyDown=(e:KeyboardEvent<HTMLTextAreaElement>)=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}};
 return <section className="training-ground" aria-label="AI 训练场">
  <header><h1>AI 训练场</h1><p>模拟买家提问，测试当前全局模型规则和 AI 禁用词；不会向买家发送消息。</p><label>测试店铺<select aria-label="测试店铺" value={storeId} disabled={pending} onChange={e=>{setStoreId(e.target.value);setProductId('');setImageText('');setHistory([]);setQuestion('');setError('');}}><option value="">仅全局规则</option>{backend.snapshot.stores.map(s=><option key={s.id} value={s.id}>{s.storeName}</option>)}</select></label><label>测试商品编号（可选）<input aria-label="测试商品编号" value={productId} disabled={!storeId||pending} maxLength={100} onChange={e=>{setProductId(e.target.value);setHistory([]);}}/></label></header>
  <details className="training-images"><summary>图片识别测试</summary><p>{backend.snapshot.capabilities.vision?.reason||'当前模型未声明图片识别能力'}</p><label>测试图片 HTTPS 地址（每行一张，最多4张）<textarea aria-label="测试图片地址" rows={2} maxLength={8192} disabled={pending||!storeId||!backend.snapshot.capabilities.vision?.supported||!backend.snapshot.visionByStore?.[storeId]?.enabled} value={imageText} onChange={e=>setImageText(e.target.value)}/></label><button disabled={pending||!imageText} onClick={()=>setImageText('')}>移除测试图片</button><button disabled={pending} onClick={()=>void window.lingtu?.openMain('UX14')}>配置本店图片识别</button><p>图片将交给当前模型服务商读取，按模型计费；不会发送给买家。</p></details>
  <div className="training-conversation" aria-label="模拟对话" aria-live="polite">
   {history.length===0?<div className="training-empty"><b>以买家身份发一句话试试</b><p>使用当前配置的模型生成模拟回复。</p><p>选择店铺后使用已启用的商品知识与意图问答；指定商品编号可测试专用问答。</p></div>:history.map((item,i)=><div className={'training-message '+item.from} key={i}><small>{item.from==='buyer'?'模拟买家':'AI 客服'}</small><p>{item.content}</p></div>)}
  </div>
  {error&&<div className="training-error" role="alert">{error}</div>}
  <form className="training-input" onSubmit={e=>void send(e)}><textarea aria-label="模拟买家问题" placeholder="输入问题，Enter 发送，Shift+Enter 换行" maxLength={2000} value={question} disabled={pending} onChange={e=>setQuestion(e.target.value)} onKeyDown={onKeyDown}/><button disabled={pending||(!question.trim()&&!imageText.trim())}>{pending?'生成中…':'发送测试'}</button></form>
  <footer><span>测试会调用你配置的模型，可能产生模型费用。</span><button type="button" disabled={pending||!history.length} onClick={()=>{setHistory([]);setError('')}}>清空对话</button></footer>
 </section>;
}
