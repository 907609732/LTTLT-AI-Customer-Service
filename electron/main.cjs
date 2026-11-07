const {app,BrowserWindow,ipcMain,dialog,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL,fileURLToPath}=require('node:url');
const crypto=require('node:crypto');
let win;
const DEV_URL='http://127.0.0.1:5173/';
const isDev=!app.isPackaged&&process.argv.includes('--dev');
const entry=pathToFileURL(path.join(__dirname,'../dist/index.html')).href;
function trusted(event){
 const url=event.senderFrame?.url||'';
 if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)return false;
 try{
  const actual=new URL(url);
  if(isDev)return actual.origin===new URL(DEV_URL).origin;
  return actual.protocol==='file:'&&actual.hostname===''&&path.resolve(fileURLToPath(actual)).toLowerCase()===path.resolve(fileURLToPath(entry)).toLowerCase();
 }catch{return false;}
}
function guard(event){if(!trusted(event))throw new Error('不允许的调用来源');}
function createWindow(){
 win=new BrowserWindow({width:1440,height:900,useContentSize:true,frame:false,minWidth:1100,minHeight:720,title:'灵兔客服',backgroundColor:'#e9f3ff',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.removeMenu();
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
 win.webContents.on('will-attach-webview',event=>event.preventDefault());
 win.once('ready-to-show',()=>win.show());
 win.on('closed',()=>{win=null;});
 if(isDev)win.loadURL(DEV_URL);else win.loadFile(path.join(__dirname,'../dist/index.html'));
}
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 ipcMain.handle('app:info',event=>{guard(event);return {version:app.getVersion(),platform:process.platform,mode:'local-preview'};});
 ipcMain.handle('window:action',(event,action)=>{guard(event);if(action==='minimize')win.minimize();else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(action==='close')win.close();else throw new Error('不支持的窗口操作');});
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
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
