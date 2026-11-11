const {app,BrowserWindow,WebContentsView,ipcMain,dialog,session,screen,shell,safeStorage}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL,fileURLToPath}=require('node:url');
const crypto=require('node:crypto');
let win,auxWin,issueView,backend,platformHost,updates,updateTimer;let closingMain=false,closeAuxApproved=false,updateQuitPending=false;
let issueHeight=220,storePresentation={visible:false,storeId:''};
let managed,runtime,managedTransition=Promise.resolve(),workspaceMessage=null;
// Fixtures must isolate Chromium, cookies and safeStorage before Electron is ready.
if(process.env.LINGTU_DATA_DIR){const isolated=path.resolve(process.env.LINGTU_DATA_DIR,'electron-userdata');require('node:fs').mkdirSync(isolated,{recursive:true});app.setPath('userData',isolated);}
// Prevent an older process from keeping a native-client worker after another process binds its owner.
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
function broadcast(channel,value){
 for(const target of [win,auxWin,issueView]){
  const contents=target?.webContents;
  if(contents&&!contents.isDestroyed())contents.send(channel,value);
 }
 if(channel==='backend:event')syncIssueView();
}
function syncIssueView(){
 if(!win||win.isDestroyed())return;
 const visible=storePresentation.visible&&!!runtime?.snapshot().modelIssue;
 if(visible&&!issueView)createIssueView();
 if(!issueView?.webContents||issueView.webContents.isDestroyed())return;
 const [width,height]=win.getContentSize();
 issueView.setVisible(visible);
 if(!visible)return;
 const panelWidth=Math.min(520,Math.max(260,width-324));
 issueView.setBounds({x:Math.max(300,width-panelWidth-16),y:84,width:panelWidth,height:Math.min(issueHeight,Math.max(100,height-100))});
 win.contentView.addChildView(issueView);
}
function createIssueView(){
 issueView=new WebContentsView({webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 issueView.setBackgroundColor('#00000000');
 issueView.setVisible(false);
 win.contentView.addChildView(issueView);
 issueView.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 issueView.webContents.on('will-navigate',event=>event.preventDefault());
 issueView.webContents.on('did-finish-load',syncIssueView);
 win.on('resize',syncIssueView);
 if(isDev)void issueView.webContents.loadURL(DEV_URL+'?notice=model-issue');
 else void issueView.webContents.loadFile(path.join(__dirname,'../dist/index.html'),{query:{notice:'model-issue'}});
}
function managedSnapshot(){return {session:managed.snapshot(),workspace:runtime.view(),message:workspaceMessage};}
function managedChanged(){if(managed&&runtime)broadcast('managed:state',managedSnapshot());}
const DEV_URL='http://127.0.0.1:5173/';
const isDev=!app.isPackaged&&process.argv.includes('--dev');
const entry=pathToFileURL(path.join(__dirname,'../dist/index.html')).href;
function trusted(event){
 const url=event.senderFrame?.url||'';
 const owner=[win,auxWin,issueView].find(w=>w&&event.sender===w.webContents);
 if(!owner||event.senderFrame!==owner.webContents.mainFrame)return false;
 try{
  const actual=new URL(url);
  if(isDev)return actual.origin===new URL(DEV_URL).origin;
  return actual.protocol==='file:'&&actual.hostname===''&&path.resolve(fileURLToPath(actual)).toLowerCase()===path.resolve(fileURLToPath(entry)).toLowerCase();
 }catch{return false;}
}
function guard(event){if(!trusted(event))throw new Error('不允许的调用来源');return [win,auxWin,issueView].find(w=>w&&event.sender===w.webContents);}
function configureWindow(w){
 w.removeMenu();w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 w.webContents.on('will-navigate',event=>event.preventDefault());w.webContents.on('will-attach-webview',event=>event.preventDefault());
 w.once('ready-to-show',()=>w.show());
}
function loadWindow(w,screenId){
 if(isDev)w.loadURL(DEV_URL+(screenId?'?screen='+encodeURIComponent(screenId):''));
 else w.loadFile(path.join(__dirname,'../dist/index.html'),screenId?{query:{screen:screenId}}:{});
}
function createWindow(){
 closingMain=false;
 win=new BrowserWindow({icon:path.join(__dirname,'../dist/brand/logo.png'),width:1440,height:900,useContentSize:true,frame:false,minWidth:1100,minHeight:720,title:'灵兔客服',backgroundColor:'#e9f3ff',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 configureWindow(win);
 win.on('close',()=>{closingMain=true;managed?.dispose();void runtime?.dispose();auxWin?.close();});
 win.on('closed',()=>{if(issueView?.webContents&&!issueView.webContents.isDestroyed())issueView.webContents.close();issueView=null;win=null;});
 loadWindow(win);
}
function openAuxiliary(screenId){
 if(auxWin){if(auxWin.isMinimized())auxWin.restore();auxWin.show();auxWin.focus();auxWin.webContents.send('app:navigate',screenId);return;}
 const area=screen.getDisplayMatching(win.getBounds()).workArea;
 auxWin=new BrowserWindow({icon:path.join(__dirname,'../dist/brand/logo.png'),width:300,height:Math.min(900,area.height),useContentSize:true,frame:false,resizable:false,minWidth:300,maxWidth:300,minHeight:Math.min(900,area.height),maxHeight:Math.min(900,area.height),
  x:Math.max(area.x,Math.min(win.getBounds().x+win.getBounds().width,area.x+area.width-300)),y:area.y,
  title:'灵兔客服 · AI辅助中心',backgroundColor:'#edf6ff',show:false,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:['--lingtu-auxiliary'],contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 closeAuxApproved=false;configureWindow(auxWin);
 auxWin.on('close',event=>{if(!closingMain&&!closeAuxApproved){event.preventDefault();auxWin.webContents.send('app:confirm-close');}});
 auxWin.on('closed',()=>{auxWin=null;closeAuxApproved=false;if(!closingMain){win?.show();win?.focus();}});
 loadWindow(auxWin,screenId);
}
app.whenReady().then(async()=>{
 updates=require('./updates.cjs').createUpdateService({updater:require('electron-updater').autoUpdater,currentVersion:app.getVersion(),enabled:app.isPackaged||process.env.LINGTU_INTEGRATION_TEST==='1',openExternal:url=>shell.openExternal(url),onChange:state=>{for(const w of [win,auxWin])if(w&&!w.isDestroyed())w.webContents.send('update:state',state);}});
 ipcMain.handle('update:snapshot',event=>{guard(event);return updates.snapshot();});
 ipcMain.handle('update:check',event=>{guard(event);return updates.check(true);});
 ipcMain.handle('update:download-install',event=>{guard(event);return updates.downloadAndInstall();});
 ipcMain.handle('update:open-release',event=>{guard(event);return updates.openReleasePage();});
 const dataRoot=path.resolve(process.env.LINGTU_DATA_DIR||app.getPath('userData'));
 const workspaces=require('./account-workspaces.cjs').createAccountWorkspaces({dataRoot,origin:'https://api-kefu.lttlt.top'});
 runtime=require('./workspace-runtime.cjs').createWorkspaceRuntime({workspaces,
  createHost:options=>require('./platform-host.cjs').createPlatformHost({...options,getWindow:()=>win}),
  createBackend:options=>require('./backend.cjs').createBackend({...options,safeStorage,openExternal:url=>shell.openExternal(url)}),
  managedChat:(payload,options)=>managed.chat(payload,options),
  onEvent:event=>broadcast('backend:event',event),
  onReset:event=>broadcast('backend:event',event),onChange:managedChanged});
 managed=require('./managed-session.cjs').createManagedSession({credentialFile:path.join(dataRoot,'managed-session.bin'),safeStorage,openExternal:url=>shell.openExternal(url),onChange:value=>{
  managedTransition=runtime.acceptSession(value).catch(error=>{if(error.code==='workspace_canceled')return;workspaceMessage='工作区未能打开，请保留本机数据并检查后重试。';return runtime.lock();}).finally(managedChanged);
 }});
 await managed.init();await managedTransition;
 ipcMain.handle('managed:snapshot',async event=>{guard(event);await managedTransition;return managedSnapshot();});
 ipcMain.handle('managed:action',async(event,action,workspaceId)=>{
  guard(event);if(workspaceId!==runtime.view().workspaceId)throw Error('工作区已切换，请刷新后重试。');workspaceMessage=null;
  if(action==='login'){await runtime.lock();await managed.beginLogin();}
  else if(action==='cancel'){await runtime.lock();await managed.cancelLogin();}
  else if(action==='logout'){await runtime.lock();await managed.logout();}
  else if(action==='open-admin')await shell.openExternal('https://account-kefu.lttlt.top/lingtu/admin');
  else if(action==='refresh')await managed.refresh();
  else if(action==='local')await runtime.local();
  else if(action==='managed')await runtime.managed();
  else if(action==='adopt'||action==='skip')await runtime.decide(action);
  else if(action==='claim-native')await runtime.claimExternal();
  else throw Error('不支持的账号操作');
  await managedTransition;managedChanged();return managedSnapshot();
 });
 ipcMain.handle('model-issue:resize',(event,height)=>{
  if(guard(event)!==issueView||!Number.isFinite(height)||height<0)throw Error('提示窗口参数无效');
  const next=Math.max(48,Math.min(10000,Math.ceil(height)));
  if(next!==issueHeight){issueHeight=next;syncIssueView();}
 });
 ipcMain.handle('platform:present',(event,value)=>{
  if(guard(event)!==win)throw Error('仅主窗口可显示店铺');
  if(!value||typeof value.visible!=='boolean'||typeof value.storeId!=='string'||value.storeId.length>200)throw Error('店铺显示参数无效');
  storePresentation={visible:value.visible,storeId:value.storeId};
  runtime.setPresentation(storePresentation);
  syncIssueView();
 });
 ipcMain.handle('backend:snapshot',event=>{guard(event);return runtime.snapshot();});
 ipcMain.handle('backend:execute',(event,command)=>{guard(event);return runtime.execute(command);});
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 ipcMain.handle('app:info',event=>{const owner=guard(event);return {version:app.getVersion(),platform:process.platform,mode:'frontend-handoff',role:owner===auxWin?'auxiliary':'main'};});
 ipcMain.handle('window:action',(event,action)=>{const owner=guard(event);if(owner===issueView)throw Error('提示窗口不支持窗口操作');if(action==='minimize')owner.minimize();else if(action==='maximize'&&owner===win)owner.isMaximized()?owner.unmaximize():owner.maximize();else if(action==='close'){if(owner===auxWin)closeAuxApproved=true;owner.close();}else throw new Error('不支持的窗口操作');});
 ipcMain.handle('auxiliary:open',(event,screenId)=>{if(guard(event)!==win||!/^UX(2[6-9]|3[01])$/.test(screenId))throw Error('不允许的辅助窗口目标');openAuxiliary(screenId);return {opened:true};});
 ipcMain.handle('main:open',(event,screenId,options)=>{guard(event);if(!/^UX(0[1-9]|1[0-9]|2[0-5])$/.test(screenId))throw Error('不允许的主窗口目标');if(!win)createWindow();if(options?.focus!==false){if(win.isMinimized())win.restore();win.show();win.focus();}win.webContents.send('app:navigate',screenId);return {opened:true};});
 ipcMain.handle('design:import',async event=>{
  guard(event);
  const chosen=await dialog.showOpenDialog(win,{title:'导入本地 Figma 设计快照',properties:['openFile'],filters:[{name:'灵兔设计快照',extensions:['json']}]});
  if(chosen.canceled||!chosen.filePaths[0])return {canceled:true};
  const source=chosen.filePaths[0];
  const {parseSnapshot,MAX_SNAPSHOT_BYTES}=await import('../shared/snapshot.mjs');
  if((await fs.stat(source)).size>MAX_SNAPSHOT_BYTES)throw new Error('快照不得超过 20 MB');
  const raw=await fs.readFile(source,'utf8');
  const snapshot=parseSnapshot(raw);
  const folder=path.join(app.getPath('userData'),'design-snapshots');
  await fs.mkdir(folder,{recursive:true});
  const name=`${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
  await fs.writeFile(path.join(folder,name),JSON.stringify(snapshot,null,2),{flag:'wx'});
  return {canceled:false,snapshot};
 });
 ipcMain.handle('design:latest',async event=>{
  guard(event);
  const {parseSnapshot,MAX_SNAPSHOT_BYTES}=await import('../shared/snapshot.mjs');
  const folder=path.join(app.getPath('userData'),'design-snapshots');
  try{
   const files=(await fs.readdir(folder)).filter(name=>name.endsWith('.json'));
   const candidates=await Promise.all(files.map(async name=>({name,stat:await fs.stat(path.join(folder,name))})));
   candidates.sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
   for(const item of candidates){
    if(item.stat.size>MAX_SNAPSHOT_BYTES)continue;
    const raw=await fs.readFile(path.join(folder,item.name),'utf8');
    return {snapshot:parseSnapshot(raw)};
   }
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return {snapshot:null};
 });
 createWindow();
 if(app.isPackaged&&process.env.LINGTU_INTEGRATION_TEST!=='1'&&process.env.LINGTU_DISABLE_UPDATE_CHECK!=='1'){updateTimer=setTimeout(()=>void updates.check(false),2500);updateTimer.unref();}
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
require('electron').autoUpdater.on('before-quit-for-update',()=>{updateQuitPending=true;});
app.on('before-quit',event=>{if(updateQuitPending){updateQuitPending=false;const state=updates?.snapshot();if(state?.status==='error'&&state.failureStage==='install'){event.preventDefault();return;}}closingMain=true;closeAuxApproved=true;clearTimeout(updateTimer);updates?.dispose();managed?.dispose();void runtime?.dispose();});

if(process.env.LINGTU_INTEGRATION_TEST==='1'){module.exports.getRuntime=()=>runtime;module.exports.getIssueView=()=>issueView;module.exports.getBackend=()=>runtime?.getBackend();module.exports.getUpdates=()=>updates;}
