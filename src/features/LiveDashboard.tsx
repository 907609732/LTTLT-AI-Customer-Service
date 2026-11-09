import {storeDisplayName,storeConnection} from './store-display';
import {useBackend} from './BackendProvider';
export function LiveDashboard(){
 const b=useBackend();
 if(!b.available)return <section className="live-dashboard" aria-label="真实数据看板"><p role="status">业务服务未连接，暂时无法读取数据。</p></section>;
 if(b.loading)return <section className="live-dashboard" aria-label="真实数据看板"><p role="status">正在读取数据…</p></section>;
 if(b.error)return <section className="live-dashboard" aria-label="真实数据看板"><p role="alert">数据读取失败，请稍后重试。</p></section>;
 const stores=b.snapshot.stores;
 return <section className="live-dashboard" aria-label="真实数据看板"><header><h2>实时值守</h2><p>全部店铺 · 当前状态</p></header><div className="live-dashboard-metrics"><article><h3>已添加店铺</h3><strong>{stores.length}</strong></article><article><h3>已连接店铺</h3><strong>{stores.filter(s=>s.runtime?.online).length}</strong></article><article><h3>开启 AI 的店铺</h3><strong>{stores.filter(s=>s.aiEnabled).length}</strong></article></div><section className="live-dashboard-panel"><h2>店铺状态</h2>{!stores.length?<p>尚未添加店铺，添加并连接店铺后可查看状态。</p>:<ul>{stores.map(s=><li key={s.id}><b>{storeDisplayName(s)}</b><span>{storeConnection(s)}{s.runtime?.collectionError?' · 采集中断':''}</span></li>)}</ul>}</section><section className="live-dashboard-panel"><h2>周期经营</h2><p>经营报表尚未接入，暂无可用统计数据。</p><div className="live-dashboard-metrics">{['今日 AI 回复','分时回复趋势','店铺回复排名','平台回复分布','算力额度','知识库与学习'].map(label=><article key={label}><h3>{label}</h3><strong>—</strong><span>暂无数据</span></article>)}</div></section></section>;
}
