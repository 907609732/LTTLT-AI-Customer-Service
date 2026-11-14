import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../src/shared/contracts/desktop'
import { createCustomPhrasesPreload } from './custom-phrases-preload'

const api: DesktopApi = {
  isElectron: true,
  managedBusinessRequest: (input) => ipcRenderer.invoke('managed:business-request', input),
  openManagedCheckout: (input) => ipcRenderer.invoke('managed:open-checkout', input),
  customPhrases: createCustomPhrasesPreload((channel, ...args) =>
    ipcRenderer.invoke(channel, ...args),
  ),
  storeSyncPreview: (envelope) => ipcRenderer.invoke('store-sync:preview', envelope),
  storeSyncApply: (envelope) => ipcRenderer.invoke('store-sync:apply', envelope),
  storeSyncRollback: (envelope) => ipcRenderer.invoke('store-sync:rollback', envelope),
  storeSyncBackups: (envelope) => ipcRenderer.invoke('store-sync:backups', envelope),
  schedulerSnapshot: (workspaceId) => ipcRenderer.invoke('scheduler:snapshot', workspaceId),
  schedulerExecute: (command) => ipcRenderer.invoke('scheduler:execute', command),
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
  openAssist: () => ipcRenderer.invoke('assist:open'),
  assistState: () => ipcRenderer.invoke('assist:state'),
  updateAssistPreferences: (patch, workspaceId) =>
    ipcRenderer.invoke('assist:update-preferences', { patch, workspaceId }),
  closeAssist: () => ipcRenderer.invoke('assist:close'),
  openMainSection: (section) => ipcRenderer.invoke('assist:open-main-section', section),
  openAssistConversation: (input) => ipcRenderer.invoke('assist:open-conversation', input),
  assistPlatformSnapshot: () => ipcRenderer.invoke('assist:platform-snapshot'),
  refreshAssistPlatform: (input) => ipcRenderer.invoke('assist:platform-refresh', input),
  openAssistPlatformItem: (input) => ipcRenderer.invoke('assist:platform-open-item', input),
  onAssistState: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      state: import('../src/shared/contracts/assist').AssistWindowState,
    ) => listener(state)
    ipcRenderer.on('assist:state-changed', receive)
    return () => ipcRenderer.removeListener('assist:state-changed', receive)
  },
  onAssistCloseRequest: (listener) => {
    const receive = () => listener()
    ipcRenderer.on('assist:request-close', receive)
    return () => ipcRenderer.removeListener('assist:request-close', receive)
  },
}
contextBridge.exposeInMainWorld('yunduoDesktop', Object.freeze(api))
