const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lingtu',Object.freeze({
 info:()=>ipcRenderer.invoke('app:info'),
 importDesign:()=>ipcRenderer.invoke('design:import'),
 latestDesignSnapshot:()=>ipcRenderer.invoke('design:latest'),
 windowAction:(action)=>ipcRenderer.invoke('window:action',action)
}));
