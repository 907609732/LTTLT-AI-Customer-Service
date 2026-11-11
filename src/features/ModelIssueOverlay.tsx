import {useEffect,useRef} from 'react';
import {ManagedModelIssueNotice} from './BackendLayers';

export function ModelIssueOverlay(){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const element=root.current;
  if(!element)return;
  const update=()=>void window.lingtu?.resizeModelIssue?.(element.scrollHeight+4).catch(()=>{});
  const observer=new ResizeObserver(update);
  observer.observe(element);
  const mutations=new MutationObserver(update);
  mutations.observe(element,{childList:true,subtree:true,characterData:true});
  update();
  return()=>{observer.disconnect();mutations.disconnect();};
 },[]);
 return <div className="model-issue-overlay" ref={root}><ManagedModelIssueNotice/></div>;
}
