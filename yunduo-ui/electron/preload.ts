import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../src/shared/contracts/desktop'

const api: DesktopApi = {
  isElectron: true,
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  beginMove: (point) => ipcRenderer.invoke('win:begin-move', point),
  move: (point) => ipcRenderer.send('win:move', point),
  endMove: () => ipcRenderer.send('win:end-move'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  copyGenericPhrase: (id) => ipcRenderer.invoke('app:copy-generic-phrase', id),
  backendSnapshot: () => ipcRenderer.invoke('business:snapshot'),
  backendExecute: (command) => ipcRenderer.invoke('business:execute', command),
  onBackendEvent: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      value: import('../src/shared/contracts/backend').BackendEvent,
    ) => listener(value)
    ipcRenderer.on('business:event', receive)
    return () => ipcRenderer.removeListener('business:event', receive)
  },
  presentStore: (storeId, visible) =>
    ipcRenderer.invoke('business:present-store', { storeId, visible }),
  simulatorStatus: () => ipcRenderer.invoke('sim:status'),
  openSimulatorPage: () => ipcRenderer.invoke('sim:open-page'),
}
contextBridge.exposeInMainWorld('yunduoDesktop', Object.freeze(api))
