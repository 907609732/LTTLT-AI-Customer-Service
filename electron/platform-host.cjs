const path=require('node:path');
const platform=require('../desk-v1/src/adapters');
const {ShopWindowManager}=require('../desk-v1/src/main/shop-window');
const {ClientLauncher}=require('../desk-v1/src/main/client-launcher');
const {DoudianBridgeServer}=require('../desk-v1/src/main/doudian-bridge-server');
function createPlatformHost({dataDir,partitionNamespace='',allowExternalClient=partitionNamespace==='',getWindow}){
 let manager,bridge,host,logger,config,registry,notify,adapterFor,disposed=false;
 let presentation={visible:false,storeId:''};
 function ensureWindow(){
  if(disposed)throw Error('工作区已关闭');
  const next=getWindow?.();
  if(!next||next.isDestroyed())throw Error('主窗口尚未就绪');
  if(host!==next){
   host?.removeListener('resize',relayout);
   host=next;host.on('resize',relayout);
  }
  return host;
 }
 function relayout(){manager?.relayout();}
 function layoutViews(views){
  const window=getWindow?.();
  const usable=window&&!window.isDestroyed();
  const [width,height]=usable?window.getContentSize():[0,0];
  const top=72;
  const bounds={x:300,y:top,width:Math.max(0,width-300),height:Math.max(0,height-top)};
  for(const [id,entry] of views){
   if(!entry.view)continue;
   const visible=!!(usable&&presentation.visible&&id===presentation.storeId&&bounds.width&&bounds.height);
   entry.view.setVisible(visible);
   if(visible)entry.view.setBounds(bounds);
  }
 }
 const windowProxy={
  getContentSize:()=>ensureWindow().getContentSize(),
  get contentView(){
   const window=getWindow?.();
   if(!window||window.isDestroyed())throw Error('主窗口已关闭');
   return window.contentView;
  },
 };
 const adapterFactory=store=>platform.createAdapter(store,{logger:logger.child(store.storeName),config:config.all(),webContentsProvider:()=>manager.webContentsOf(store.id),dataDir,doudianBridge:{call:(...args)=>bridge?bridge.call(...args):Promise.reject(Error('抖店客户端未连接')),status:()=>bridge?.status()||{connected:false}}});
 const managerFactory=deps=>{
  ({logger,config,registry,adapterFor}=deps);notify=deps.onEvent;
  const launcher=new ClientLauncher({logger:logger.child('client'),launcherConfigPath:path.join(dataDir,'launcher_config.json')});
  manager=new ShopWindowManager({partitionNamespace,window:windowProxy,layoutViews,registry,logger,resolveEntryUrl:platform.entryUrlFor,resolveAccessMode:platform.accessModeFor,prepareStore:s=>adapterFor(s).ensure(),readIdentity:(s,options)=>adapterFor(s).readIdentity(options),ensureClientRunning:s=>launcher.ensureRunning(s),onEvent:notify});manager.sidebarWidth=0;
  const open=manager.open.bind(manager);
  manager.open=async id=>{
   if(disposed)throw Error('工作区已关闭');
   ensureWindow();
   const result=await open(id);
   if(disposed){manager.closeAll();throw Error('工作区已关闭');}
   relayout();
   return result;
  };
  manager.restartClient=async id=>{const s=registry.get(id);if(!s)throw Error('店铺不存在');const r=await launcher.restart(s);if(!r?.ok)throw Error('无法重启客户端，请确认已安装');manager.retryClient(id);return r;};
  return manager;
 };
 return {adapterFactory,managerFactory,setPresentation(next){presentation=next;if(getWindow?.())ensureWindow();relayout();},async start(){if(disposed||!allowExternalClient)return;const c=config.all().doudianBridge;const u=new URL(c.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('桥接仅允许本机地址');bridge=new DoudianBridgeServer({host:u.hostname==='localhost'?'127.0.0.1':u.hostname.replace(/[\[\]]/g,''),port:Number(u.port)||42101,fallbackPorts:c.fallbackPorts,bodyLimit:c.bodyLimitBytes,requestTimeoutMs:c.requestTimeoutMs,logger:logger.child('bridge')});try{await bridge.start();if(disposed)await bridge.close();}catch(e){logger.warn('抖店桥接不可用，请关闭重复运行的软件后重试');bridge=null;}},async close(){disposed=true;host?.removeListener('resize',relayout);manager?.closeAll();await bridge?.close().catch(()=>{});}};
}
module.exports={createPlatformHost};
