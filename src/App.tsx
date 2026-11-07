import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Layers3,Maximize,Search,PanelLeftClose,PanelLeftOpen,RotateCcw,ShieldCheck} from 'lucide-react';
import manifest from './design/generated/manifest.json';
import FigmaCanvas from './design/FigmaCanvas';
import type {FigmaLayer} from './design/types';
import type {DesignAction} from './design/actions';
const screens=manifest.files;
const screenModules=import.meta.glob<{default:FigmaLayer}>('./design/generated/screens/UX*.json');
type ScaleMode='fit'|'actual';
export default function App(){
 const [screenId,setScreenId]=useState('UX01');
 const [design,setDesign]=useState<FigmaLayer|null>(null);
 const [query,setQuery]=useState('');
 const [showIndex,setShowIndex]=useState(true);
 const [scaleMode,setScaleMode]=useState<ScaleMode>('fit');
 const [viewport,setViewport]=useState({width:1150,height:840});
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false);
 const stageRef=useRef<HTMLDivElement>(null);
 const current=screens.find(s=>s.uxId===screenId);
 const selection=screens.filter(s=>s.uxId.toLowerCase().includes(query.toLowerCase())||(s.source||'').toLowerCase().includes(query.toLowerCase()));
 const index=screens.findIndex(s=>s.uxId===screenId);
 const navigate=useCallback((id:string)=>{if(screens.some(s=>s.uxId===id)){setScreenId(id);setNotice('');}},[]);
 useEffect(()=>{let active=true;const loader=screenModules['./design/generated/screens/'+screenId+'.json'];setLoading(true);setError('');
  if(!loader){setDesign(null);setError('找不到对应可编辑画板');setLoading(false);return;}
  loader().then(m=>{if(active){setDesign(m.default);setLoading(false);}}).catch(e=>{if(active){setError(String(e));setLoading(false);}});
  return()=>{active=false;};
 },[screenId]);
 useEffect(()=>{const el=stageRef.current;if(!el)return;const ob=new ResizeObserver(entries=>{const e=entries[0];if(e){setViewport({width:e.contentRect.width,height:e.contentRect.height});}});ob.observe(el);return()=>ob.disconnect();},[]);
 useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);}},[notice]);
 const scale=useMemo(()=>{
  if(scaleMode==='actual')return 1;
  const w=current?.width||1440,h=current?.height||900;
  return Math.min(1,Math.max(.1,(viewport.width-44)/w),Math.max(.1,(viewport.height-44)/h));
 },[scaleMode,current?.width,current?.height,viewport]);
 const onAction=(action:DesignAction)=>{
  if(action.kind==='navigate')navigate(action.to);
  else if(action.kind==='notice')setNotice(action.message);
  else if(action.kind==='window'){if(window.lingtu)void window.lingtu.windowAction(action.action);else setNotice('该窗口按钮仅在 Electron 客户端内生效。');}
 };
 return <div className="rebuild-app">
  <aside className={'inspector '+(showIndex?'':'inspector-collapsed')} aria-label="设计画板索引">
   {showIndex&&<>
    <header className="inspector-head"><span className="inspector-logo"><Layers3 size={17}/></span><div><b>灵兔 · 设计重构</b><small>源文件：可编辑 Figma 画板</small></div></header>
    <div className="source-facts"><ShieldCheck size={14}/><span>已读取 32 个真实 UX 画板与 116 个通用组件</span></div>
    <label className="screen-search"><Search size={15}/><input type="search" placeholder="按 UX 编号或画板名称搜索" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <nav className="screen-list" aria-label="可编辑画板">
     {selection.map(s=><button className={screenId===s.uxId?'active':''} key={s.uxId} onClick={()=>navigate(s.uxId)}>
       <span>{s.uxId}</span><b>{s.source?.replace(' · 可编辑','')||'未命名画板'}</b><small>{s.width}×{s.height}</small>
     </button>)}
     {selection.length===0&&<p className="no-match">没有匹配的可编辑画板</p>}
    </nav>
    <footer className="inspector-foot">本地原生 .fig 解析 · 不调用 Figma MCP</footer>
   </>}
  </aside>
  <section className="rebuild-workspace">
   <header className="dev-toolbar">
    <button className="tool-icon" onClick={()=>setShowIndex(x=>!x)} aria-label={showIndex?'隐藏画板索引':'显示画板索引'}>{showIndex?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</button>
    <div className="current-screen"><strong>{screenId}</strong><span>{current?.source||'可编辑设计'}</span></div>
    <div className="dev-toolbar-actions">
     <button className="tool-icon" aria-label="上一画板" disabled={index<=0} onClick={()=>navigate(screens[index-1].uxId)}><ChevronLeft size={18}/></button>
     <button className="tool-icon" aria-label="下一画板" disabled={index===screens.length-1} onClick={()=>navigate(screens[index+1].uxId)}><ChevronRight size={18}/></button>
     <button className="zoom-button" onClick={()=>setScaleMode(s=>s==='fit'?'actual':'fit')}><Maximize size={15}/>{scaleMode==='fit'?'适合窗口':'原始尺寸'}</button>
     <button className="tool-icon" aria-label="返回首页画板" onClick={()=>navigate('UX01')}><RotateCcw size={16}/></button>
    </div>
   </header>
   <main className="stage-host" ref={stageRef} aria-label="Figma 可编辑节点渲染预览">
    {error&&<div className="stage-error">{error}</div>}
    {loading&&<div className="stage-loading">正在加载 {screenId} 的可编辑图层结构…</div>}
    {!loading&&design&&<FigmaCanvas key={screenId} design={design} screenId={screenId} scale={scale} onAction={onAction}/>}
   </main>
   <footer className="statusbar"><span>{manifest.hash.slice(0,12)} · Figma 组件化重构预览</span><span>{design?.children.length??0} 顶层图层 · 当前缩放 {Math.round(scale*100)}%</span><span>真实业务接口未接入，部分矢量和实例变体仍需核对</span></footer>
  </section>
  {notice&&<div role="status" className="dev-toast">{notice}</div>}
 </div>;
}
