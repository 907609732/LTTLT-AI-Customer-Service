const {BrowserWindow}=require('electron');
const path=require('node:path');
const platform=require('../desk-v1/src/adapters');
const {ShopWindowManager}=require('../desk-v1/src/main/shop-window');
const {ClientLauncher}=require('../desk-v1/src/main/client-launcher');
const {DoudianBridgeServer}=require('../desk-v1/src/main/doudian-bridge-server');
function createPlatformHost({dataDir}){
 let manager,bridge,host,logger,config,registry,notify,adapterFor,closing=false;
 function ensureWindow(){if(host&&!host.isDestroyed())return host;host=new BrowserWindow({width:1100,height:800,minWidth:640,minHeight:480,title:'灵兔客服 · 店铺平台',autoHideMenuBar:true,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});host.removeMenu();host.loadURL('about:blank');host.on('resize',()=>manager?.relayout());host.on('close',()=>{if(!closing)manager?.closeAll()});host.on('closed',()=>{host=null});return host;}
 const windowProxy={getContentSize:()=>ensureWindow().getContentSize(),get contentView(){return ensureWindow().contentView}};
 const adapterFactory=store=>platform.createAdapter(store,{logger:logger.child(store.storeName),config:config.all(),webContentsProvider:()=>manager.webContentsOf(store.id),dataDir,doudianBridge:{call:(...args)=>bridge?bridge.call(...args):Promise.reject(Error('抖店客户端未连接')),status:()=>bridge?.status()||{connected:false}}});
 const managerFactory=deps=>{
  ({logger,config,registry,adapterFor}=deps);notify=deps.onEvent;
  const launcher=new ClientLauncher({logger:logger.child('client'),launcherConfigPath:path.join(dataDir,'launcher_config.json')});
  manager=new ShopWindowManager({window:windowProxy,registry,logger,resolveEntryUrl:platform.entryUrlFor,resolveAccessMode:platform.accessModeFor,prepareStore:s=>adapterFor(s).ensure(),ensureClientRunning:s=>launcher.ensureRunning(s),onEvent:notify});manager.sidebarWidth=0;
  const closeAll=manager.closeAll.bind(manager);manager.closeAll=()=>{closeAll();if(host&&!host.isDestroyed()){closing=true;host.destroy();host=null;closing=false}};
  const open=manager.open.bind(manager);manager.open=async id=>{const r=await open(id);if(manager.stateOf(id).open&&platform.accessModeFor(registry.get(id))==='webview'){ensureWindow().show();host.focus();}return r;};
  manager.restartClient=async id=>{const s=registry.get(id);if(!s)throw Error('店铺不存在');const r=await launcher.restart(s);if(!r?.ok)throw Error('无法重启客户端，请确认已安装');manager.retryClient(id);return r;};
  return manager;
 };
 return {adapterFactory,managerFactory,async start(){const c=config.all().doudianBridge;const u=new URL(c.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('桥接仅允许本机地址');bridge=new DoudianBridgeServer({host:u.hostname==='localhost'?'127.0.0.1':u.hostname.replace(/[\[\]]/g,''),port:Number(u.port)||42101,fallbackPorts:c.fallbackPorts,bodyLimit:c.bodyLimitBytes,requestTimeoutMs:c.requestTimeoutMs,logger:logger.child('bridge')});try{await bridge.start()}catch(e){logger.warn('抖店桥接不可用，请关闭重复运行的软件后重试');bridge=null;}},close(){manager?.closeAll();bridge?.close().catch(()=>{});}};
}
module.exports={createPlatformHost};
