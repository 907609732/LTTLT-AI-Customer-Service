import type {Store} from './BackendProvider';
export function storeDisplayName(s:Store){
 if(s.storeName.trim())return s.storeName;
 if(s.platform!=='pdd-web')return '未命名店铺';
 return s.runtime?.authenticated===true?`拼多多店铺 · ${s.runtime.identityError?'信息待获取':'信息获取中'}`:'拼多多店铺 · 待登录';
}
export function storeConnection(s:Store){
 if(s.runtime?.identityError)return s.runtime.authenticated===true?'已登录 · 信息待获取':'店铺信息待获取';
 if(s.runtime?.authenticated===false)return '请完成登录';
 return s.runtime?.collectionError?'采集中断':s.runtime?.online?'已连接':s.runtime?.awaitingClient?'等待客户端':s.runtime?.lastError?'连接失败':s.runtime?.open?'请完成登录':'未打开';
}
