const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lingtu',Object.freeze({
 role:process.argv.includes('--lingtu-auxiliary')?'auxiliary':'main',
 info:()=>ipcRenderer.invoke('app:info'),
 importDesign:()=>ipcRenderer.invoke('design:import'),
 latestDesignSnapshot:()=>ipcRenderer.invoke('design:latest'),
 windowAction:(action)=>ipcRenderer.invoke('window:action',action),
 openAuxiliary:(screenId)=>ipcRenderer.invoke('auxiliary:open',screenId),
 openMain:(screenId)=>ipcRenderer.invoke('main:open',screenId),
 onNavigate:(callback)=>{const listener=(_event,id)=>callback(id);ipcRenderer.on('app:navigate',listener);return()=>ipcRenderer.removeListener('app:navigate',listener);},
 onConfirmClose:(callback)=>{const listener=()=>callback();ipcRenderer.on('app:confirm-close',listener);return()=>ipcRenderer.removeListener('app:confirm-close',listener);}
}));
