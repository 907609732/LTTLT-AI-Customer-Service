const reasonLabels={uid_interval:'同顾客发送间隔',store_rate:'店铺发送频率限制',send_unconfirmed:'发送结果未确认',input_busy:'输入框已有内容',input_not_found:'未找到输入框',cancelled:'操作取消'};
function createSourceDiagnostics({enabled=false,getState,write=console.log,now=Date.now,setTimer=setInterval,clearTimer=clearInterval}={}){
 if(!enabled)return {status(){},event(){},dispose(){}};
 let disposed=false,last='',lastAt=-Infinity;const recent=new Map();
 function status(){if(disposed)return;try{const state=getState();const rows=(state.stores||[]).map(s=>`${s.name}：${s.online?'已连接':'未连接'} / AI${s.ai?'开':'关'} / 处理中${s.inflight||0} / 成功${s.replied||0} / 失败${s.failed||0} / 限速${s.throttled||0} / 接管${s.suppressed||0}${s.collectionError?' / 采集中断':''}`);const text=`[运行状态] 模型=${state.mode==='managed'?'托管':'自有接口'}${state.issue?' / 全局异常='+state.issue:''} | ${rows.join(' | ')||'尚无店铺'}`;if(text!==last||now()-lastAt>=30000){write(text);last=text;lastAt=now()}}catch{write('[运行状态] 暂时无法读取诊断状态');}}
 function event(e){if(disposed||!/^reply:|^collection:|^shop:/.test(String(e.type)))return;const key=[e.type,e.storeId,e.reason].join(':');if(now()-(recent.get(key)??-Infinity)<5000)return;recent.set(key,now());if(recent.size>300)recent.delete(recent.keys().next().value);const reason=String(e.reason||'').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,60);write(`[接待事件] ${e.type}${reason?' / '+(reasonLabels[reason]||reason)+' ('+reason+')':''}${Number.isFinite(e.retryAfterMs)?' / 等待约'+Math.ceil(Math.max(0,e.retryAfterMs)/1000)+'秒':''}`);}
 const timer=setTimer(status,2000);timer?.unref?.();status();
 return {status,event,dispose(){disposed=true;clearTimer(timer);recent.clear()}};
}
module.exports={createSourceDiagnostics};

