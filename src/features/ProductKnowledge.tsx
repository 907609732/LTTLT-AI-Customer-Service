import {useEffect,useRef,useState} from 'react';
import {useBackend} from './BackendProvider';

type Sku={skuId:string;attributes:string;price:string;stock?:number};
type Source={kind:'manual'|'csv'|'json'|'conversation';capturedAt:number;observedAt?:number;messageId?:string};
type Product={id?:string;version?:number;updatedAt?:number;storeId?:string;productId:string;code?:string;title:string;description:string;specifications:string;price:string;skus?:Sku[];source?:Source;enabled:boolean};
type ImportPreview={revision:number;count:number;duplicates:number;items?:Product[]};
type Capture={token:string;product:Product;source:Source;existing:boolean;expiresAt:number};
const blank:Product={productId:'',code:'',title:'',description:'',specifications:'',price:'',skus:[],enabled:true};
const sourceNames={manual:'手动维护',csv:'CSV导入',json:'JSON导入',conversation:'会话消息采集'};
const time=(n?:number)=>n?new Date(n).toLocaleString():'未知时间';

export function ProductKnowledge({storeId,onClose}:{storeId:string;onClose:()=>void}){
 const b=useBackend(),[items,setItems]=useState<Product[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0),[query,setQuery]=useState(''),[draft,setDraft]=useState<Product>(blank);
 const [format,setFormat]=useState<'csv'|'json'>('csv'),[raw,setRaw]=useState(''),[fileName,setFileName]=useState(''),[preview,setPreview]=useState<ImportPreview|null>(null),[mode,setMode]=useState('skip');
 const [captureUid,setCaptureUid]=useState(''),[capture,setCapture]=useState<Capture|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[remove,setRemove]=useState<Product|null>(null);
 const busy=useRef(false),live=useRef(true),ticket=useRef(0);
 const store=b.snapshot.stores.find(x=>x.id===storeId),conversations=b.snapshot.conversations.filter(x=>x.storeId===storeId);
 const load=async()=>{const seq=++ticket.current;const r=await b.execute({action:'list-products',storeId,values:{offset,limit:20,query}});if(live.current&&seq===ticket.current){setItems(r.data?.items as Product[]||[]);setTotal(Number(r.data?.total||0));}};
 useEffect(()=>{live.current=true;const timer=setTimeout(()=>{void load().catch(e=>{if(live.current)setError(e.message);});},query?180:0);return()=>{clearTimeout(timer);live.current=false;ticket.current++;};},[storeId,offset,query,b.snapshot.workspaceId]);
 const run=async(job:()=>Promise<void>)=>{if(busy.current)return;busy.current=true;setPending(true);setError('');setNotice('');try{await job();}catch(e){if(live.current)setError(e instanceof Error?e.message:String(e));}finally{busy.current=false;if(live.current)setPending(false);}};
 const save=()=>run(async()=>{await b.execute({action:'save-product',storeId,values:{...draft}});if(!live.current)return;setDraft(blank);setPreview(null);setCapture(null);setNotice('商品知识已保存，平台商品未改变。');await load();});
 const updateSku=(i:number,key:keyof Sku,value:string)=>setDraft(current=>({...current,skus:(current.skus||[]).map((sku,j)=>j===i?{...sku,[key]:key==='stock'?(value===''?undefined:Number(value)):value}:sku)}));
 const download=(exportFormat:'csv'|'json')=>run(async()=>{const r=await b.execute({action:'export-products',storeId,values:{format:exportFormat}});if(!live.current)return;const content=r.data?.[exportFormat];if(typeof content!=='string')throw Error('导出未返回有效文件，请重试');const url=URL.createObjectURL(new Blob([exportFormat==='csv'?'\uFEFF'+content:content],{type:exportFormat==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='商品知识.'+exportFormat;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 return <div className="product-knowledge-mask"><section role="dialog" aria-modal="true" aria-label="店铺商品知识" className="product-knowledge">
  <header><h2>店铺商品知识 · {store?.storeName||'当前店铺'}</h2><button onClick={onClose}>关闭</button></header>
  <div className="product-knowledge-content">
   <p>维护本店回复参考资料。不会修改平台商品；全量平台商品同步尚未接入。价格、SKU库存均为人工维护的参考值。</p>
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   <div className="product-knowledge-body">
    <div><h3>{query?'检索结果':'商品列表'} · {total}</h3><label>搜索本店商品<input type="search" disabled={pending} maxLength={200} placeholder="编号、编码、SKU或名称" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>{items.length?items.map(x=><button key={x.id} className="product-entry" disabled={pending} onClick={()=>{setDraft(x);setRemove(null);}}><b>{x.title}</b><small>{x.productId} · {x.code||'未填编码'} · {x.enabled?'已启用':'已停用'}</small></button>):<p>{query?'没有匹配的商品知识。':'暂无商品知识，请手动添加或导入 CSV。'}</p>}
     <button disabled={pending||offset===0} onClick={()=>setOffset(offset-20)}>上一页</button><button disabled={pending||offset+20>=total} onClick={()=>setOffset(offset+20)}>下一页</button>
    </div>
    <form onSubmit={e=>{e.preventDefault();void save();}}><h3>{draft.id?'编辑商品':'新增商品'}</h3>
     {draft.source&&<p className="product-source">来源：{sourceNames[draft.source.kind]} · {time(draft.source.capturedAt)}{draft.source.observedAt?`；消息时间：${time(draft.source.observedAt)}`:''}</p>}
     {(['productId','code','title','price','specifications','description'] as const).map((key,i)=><label key={key}>{['商品编号','商品编码','商品名称','价格说明','规格说明','商品知识'][i]}{key==='description'||key==='specifications'?<textarea disabled={pending} value={draft[key]} maxLength={key==='description'?6000:3000} onChange={e=>setDraft({...draft,[key]:e.target.value})}/>:<input disabled={pending} required={key==='productId'||key==='title'} maxLength={key==='title'?200:key==='price'?80:100} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})}/>}</label>)}
     <fieldset disabled={pending} className="product-skus"><legend>SKU规格 · {(draft.skus||[]).length}</legend><p>每个SKU填写唯一编号。参考库存留空表示未知，不能作为平台实时库存。</p>
      {(draft.skus||[]).map((sku,i)=><div className="product-sku" key={i}>
       <label>SKU编号 {i+1}<input required maxLength={100} value={sku.skuId} onChange={e=>updateSku(i,'skuId',e.target.value)}/></label>
       <label>SKU规格 {i+1}<input maxLength={500} value={sku.attributes} onChange={e=>updateSku(i,'attributes',e.target.value)}/></label>
       <label>SKU价格说明 {i+1}<input maxLength={80} value={sku.price} onChange={e=>updateSku(i,'price',e.target.value)}/></label>
       <label>SKU参考库存 {i+1}<input type="number" min={0} max={999999999} step={1} value={sku.stock??''} onChange={e=>updateSku(i,'stock',e.target.value)}/></label>
       <button type="button" aria-label={'删除SKU '+(i+1)} onClick={()=>setDraft({...draft,skus:draft.skus?.filter((_,j)=>j!==i)})}>删除SKU</button>
      </div>)}
      <button type="button" disabled={(draft.skus||[]).length>=200} onClick={()=>setDraft({...draft,skus:[...(draft.skus||[]),{skuId:'',attributes:'',price:''}]})}>添加SKU</button>
     </fieldset>
     <label><input disabled={pending} type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>用于 AI 回复</label>
     <button disabled={pending}>保存商品</button><button type="button" disabled={pending} onClick={()=>{setDraft(blank);setRemove(null);}}>新增</button>{draft.id&&<button type="button" disabled={pending} onClick={()=>setRemove(draft)}>删除知识</button>}
    </form>
   </div>
   <details><summary>CSV / JSON 导入与导出</summary><p>支持 CSV 与 JSON 数组。必填 productId、title；可选 code、description、specifications、price、skus、enabled。CSV 的 skus 列为JSON数组。每批最多 1000 条 / 1 MB；文件不携带账号和顾客来源信息。</p>
    <label>导入格式<select aria-label="导入格式" disabled={pending} value={format} onChange={e=>{setFormat(e.target.value as 'csv'|'json');setRaw('');setFileName('');setPreview(null);}}><option value="csv">CSV</option><option value="json">JSON</option></select></label>
    <input key={format} aria-label={'选择商品'+format.toUpperCase()} type="file" accept={format==='csv'?'.csv,text/csv':'.json,application/json'} disabled={pending} onChange={e=>{const file=e.target.files?.[0];setRaw('');setPreview(null);setFileName('');if(file)void run(async()=>{if(file.size>1048576)throw Error('导入文件最大 1 MB');const text=await file.text();if(live.current){setRaw(text);setFileName(file.name);}});}}/>
    {fileName&&<p>已选择：{fileName}</p>}<button disabled={pending||!raw} onClick={()=>void run(async()=>{const r=await b.execute({action:'preview-product-import',storeId,values:{format,[format]:raw}});if(live.current)setPreview(r.data as ImportPreview);})}>预览导入</button>
    {preview&&<div className="product-import-preview"><p>共 {preview.count} 条，其中 {preview.duplicates} 条编号重复。</p>{preview.items?.slice(0,20).map((x,i)=><p key={i}><b>{x.title}</b> · {x.productId} · {x.skus?.length||0} 个SKU</p>)}<p>预览最多显示前20条；确认前整批校验。</p>
     <label>重复商品处理<select aria-label="重复商品处理" disabled={pending} value={mode} onChange={e=>setMode(e.target.value)}><option value="skip">跳过重复商品</option><option value="replace">覆盖重复商品</option></select></label>
     <button disabled={pending} onClick={()=>void run(async()=>{await b.execute({action:'import-products',storeId,values:{format,[format]:raw,revision:preview.revision,mode,confirmed:true}});if(live.current){setPreview(null);setCapture(null);setDraft(blank);setRaw('');setNotice('导入完成，已按所选策略处理重复商品。');await load();}})}>确认导入</button>
    </div>}
    <button disabled={pending} onClick={()=>void download('csv')}>导出本店 CSV</button><button disabled={pending} onClick={()=>void download('json')}>导出本店 JSON</button>
   </details>
   <section className="product-capture" aria-label="会话商品采集"><h3>从顾客会话录入商品</h3><p>只读取该顾客最近消息中明确的商品编号与名称，核对后录入本店；不是全量同步。已有商品保留人工说明、SKU和启停状态，仅更新名称与采集来源。</p>
    <label>采集来源会话<select aria-label="采集来源会话" disabled={pending} value={captureUid} onChange={e=>{setCaptureUid(e.target.value);setCapture(null);}}><option value="">请选择本店顾客</option>{conversations.map(c=><option key={c.uid} value={c.uid}>{c.name||'顾客'} · {c.uid}</option>)}</select></label>
    {!store?.runtime.online&&<p>店铺未在线，请先登录店铺后再读取。</p>}<button disabled={pending||!captureUid||!store?.runtime.online} onClick={()=>void run(async()=>{setCapture(null);const r=await b.execute({action:'preview-consulted-product',storeId,conversationId:captureUid});if(live.current)setCapture(r.data as Capture);})}>预览会话商品</button>
    {capture&&<div className="product-import-preview"><p><b>{capture.product.title}</b> · 商品编号 {capture.product.productId}</p><p>来源顾客：{conversations.find(c=>c.uid===captureUid)?.name||captureUid} · {captureUid}<br/>消息时间：{time(capture.source.observedAt)}；预览有效至 {time(capture.expiresAt)}</p><p>{capture.existing?'将更新已有商品名称与采集来源，保留人工维护的其他资料。':'将创建新的本店商品知识。'}</p>
     <button disabled={pending} onClick={()=>setCapture(null)}>取消录入</button><button disabled={pending} onClick={()=>void run(async()=>{await b.execute({action:'confirm-consulted-product',storeId,conversationId:captureUid,values:{token:capture.token,confirmed:true}});if(live.current){setCapture(null);setDraft(blank);setPreview(null);setNotice('会话商品已录入，平台商品未改变。');await load();}})}>确认录入会话商品</button>
    </div>}
   </section>
   {remove&&<div role="alertdialog" aria-label="确认删除商品知识"><p>删除“{remove.title}”的本地知识？平台商品不受影响。</p><button disabled={pending} onClick={()=>setRemove(null)}>取消</button><button disabled={pending} onClick={()=>void run(async()=>{await b.execute({action:'remove-product',storeId,values:{id:remove.id,version:remove.version,confirmed:true}});if(live.current){setRemove(null);setDraft(blank);setPreview(null);setCapture(null);await load();}})}>确认删除</button></div>}
  </div>
 </section></div>;
}
