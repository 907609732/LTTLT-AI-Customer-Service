const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lingtu',Object.freeze({
 role:process.argv.includes('--lingtu-auxiliary')?'auxiliary':'main',
 managedSnapshot:()=>ipcRenderer.invoke('managed:snapshot'),
 managedAction:(action,workspaceId)=>ipcRenderer.invoke('managed:action',action,workspaceId),
 onManagedState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('managed:state',listener);return()=>ipcRenderer.removeListener('managed:state',listener);},
 updateSnapshot:()=>ipcRenderer.invoke('update:snapshot'),
 checkForUpdates:()=>ipcRenderer.invoke('update:check'),
 downloadAndInstallUpdate:()=>ipcRenderer.invoke('update:download-install'),
 openUpdateRelease:()=>ipcRenderer.invoke('update:open-release'),
 onUpdateState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('update:state',listener);return()=>ipcRenderer.removeListener('update:state',listener);},
 info:()=>ipcRenderer.invoke('app:info'),
 backendSnapshot:()=>ipcRenderer.invoke('backend:snapshot'),
 backendExecute:command=>ipcRenderer.invoke('backend:execute',command),
 onBackendEvent:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('backend:event',listener);return()=>ipcRenderer.removeListener('backend:event',listener);},
 importDesign:()=>ipcRenderer.invoke('design:import'),
 latestDesignSnapshot:()=>ipcRenderer.invoke('design:latest'),
 windowAction:(action)=>ipcRenderer.invoke('window:action',action),
 openAuxiliary:(screenId)=>ipcRenderer.invoke('auxiliary:open',screenId),
 openMain:(screenId,options)=>ipcRenderer.invoke('main:open',screenId,options),
 onNavigate:(callback)=>{const listener=(_event,id)=>callback(id);ipcRenderer.on('app:navigate',listener);return()=>ipcRenderer.removeListener('app:navigate',listener);},
 onConfirmClose:(callback)=>{const listener=()=>callback();ipcRenderer.on('app:confirm-close',listener);return()=>ipcRenderer.removeListener('app:confirm-close',listener);}
}));
