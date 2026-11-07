import type {FigmaLayer} from './types';
export type DesignAction={kind:'navigate';to:string}|{kind:'window';action:'minimize'|'maximize'|'close'}|{kind:'notice';message:string};
const home:Record<string,string>={'11:16':'UX01','11:20':'UX04','11:24':'UX26','11:72':'UX03','11:76':'UX01','11:80':'UX02','11:226':'UX03','11:230':'UX26','11:237':'UX04'};
const byName:Record<string,string>={
 '店铺首页':'UX01','未登录':'UX02','配置中心':'UX04','数据看板':'UX04',
 '店铺与商品':'UX07','添加店铺':'UX03','转接人工':'UX08','进店欢迎':'UX11',
 '自动操作':'UX12','图片识别':'UX14','意图问法':'UX15','意图问法配置':'UX15',
 'AI训练场':'UX16','AI 训练场':'UX16','模型定制':'UX17','尺码规格':'UX18',
 '尺码规格表':'UX18','AI禁用词':'UX19','AI 回复禁用词':'UX19',
 '工单登记':'UX20','客服质检':'UX21','我的订单':'UX22','算力消耗':'UX23',
 '软件偏好':'UX24','登录账号':'UX25','AI辅助中心':'UX26','AI 辅助中心':'UX26',
 '待回复':'UX26','人工预警':'UX27','平台工单':'UX28','售后':'UX29',
 '已回复':'UX30','客服工单':'UX31'
};
export function resolveAction(node:FigmaLayer,screenId:string,ancestors:string[]):DesignAction|null{
 if(screenId==='UX01'&&home[node.id])return{kind:'navigate',to:home[node.id]};
 if(screenId==='UX01'){
  if(node.id==='11:59'||node.id.endsWith(';11:59'))return{kind:'window',action:'minimize'};
  if(node.id==='11:61'||node.id.endsWith(';11:61'))return{kind:'window',action:'maximize'};
  if(node.id==='11:63'||node.id.endsWith(';11:63'))return{kind:'window',action:'close'};
 }
 const name=node.name.trim();
 if(!['FRAME','INSTANCE','SYMBOL'].includes(node.type))return null;
 if(screenId==='UX03'){
  if(name==='取消'||name==='关闭')return{kind:'navigate',to:'UX01'};
  if(name.includes('确认添加'))return{kind:'notice',message:'当前仅为可编辑设计预览：真实平台登录功能尚未接入'};
 }
 if(screenId==='UX32'){
  if(name==='取消')return{kind:'navigate',to:'UX26'};
  if(name==='关闭'||name==='确认关闭')return{kind:'navigate',to:'UX01'};
 }
 if(screenId.startsWith('UX2')||screenId.startsWith('UX3')){
  if(name.includes('关闭')&&name.includes('标题栏'))return{kind:'navigate',to:'UX32'};
 }
 const inNavigation=ancestors.some(x=>/主导航|配置导航|功能列表|标题栏|侧栏|栏目/.test(x));
 if(inNavigation && byName[name]) return{kind:'navigate',to:byName[name]};
 if(name==='打开AI辅助中心')return{kind:'navigate',to:'UX26'};
 if(name==='添加店铺')return{kind:'navigate',to:'UX03'};
 return null;
}
