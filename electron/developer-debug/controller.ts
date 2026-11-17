import type { BrowserWindow, WebContents } from 'electron'
import type { LogEntry } from '../../src/shared/contracts/review'
import {
  developerDebugChannels,
  type DeveloperDebugExpandRequest,
  type DeveloperDebugExpandResult,
  type DeveloperDebugGmRequest,
  type DeveloperDebugGmResult,
  type DeveloperDebugPtyConnectRequest,
  type DeveloperDebugPtyConnectResult,
  type DeveloperDebugPtyResizeRequest,
  type DeveloperDebugPtySessionRequest,
  type DeveloperDebugPtyWriteRequest,
} from '../../src/shared/contracts/developer-debug'
import { createGmRegistry, type GmStore } from './gm'
import { createPopupPolicy } from './popup-policy'
import { createTerminalHost, type TerminalHost } from './pty'

interface MonitorWindow {
  window(): BrowserWindow | undefined
  isExpanded(): boolean
  setExpanded(expanded: boolean): DeveloperDebugExpandResult
}
export interface DeveloperDebugControllerOptions {
  workspaceId: string
  appVersion: string
  monitor: MonitorWindow
  isWorkspaceActive(): boolean
  stores(): GmStore[]
  logs(): LogEntry[]
  getStoreWebContents(storeId: string): WebContents | null
  openExternal(url: string): Promise<unknown>
  ptyCwd(): string
}

/**
 * 唯一 owner 是当前回复监控窗口的服务主 frame。每个方法再次核对 owner 与
 * workspace；窗口重建会先结束旧终端，旧输出不会投递到新窗口。
 */
export function createDeveloperDebugController(options: DeveloperDebugControllerOptions) {
  let owner: BrowserWindow | undefined
  let terminal: TerminalHost
  const cleanups = new Set<Promise<void>>()
  const stopHost = (host: TerminalHost) => {
    const cleanup = Promise.resolve(host.dispose())
    cleanups.add(cleanup)
    void cleanup.then(
      () => cleanups.delete(cleanup),
      () => {},
    )
  }
  const createHost = (boundOwner?: BrowserWindow): TerminalHost => {
    const host = createTerminalHost({
      cwd: options.ptyCwd,
      onData: (event) => {
        const current = boundOwner
        if (
          !current ||
          current !== owner ||
          terminal !== host ||
          current.isDestroyed() ||
          !options.isWorkspaceActive()
        )
          return
        current.webContents.send(developerDebugChannels.ptyData, event)
      },
      onExit: (event) => {
        const current = boundOwner
        if (
          !current ||
          current !== owner ||
          terminal !== host ||
          current.isDestroyed() ||
          !options.isWorkspaceActive()
        )
          return
        current.webContents.send(developerDebugChannels.ptyExit, event)
      },
    })
    return host
  }
  terminal = createHost()
  const popupPolicy = createPopupPolicy({
    getStoreWebContents: options.getStoreWebContents,
    getOwnerWebContents: () => owner?.webContents ?? null,
    openExternal: options.openExternal,
  })
  const gm = createGmRegistry({
    workspaceId: options.workspaceId,
    appVersion: options.appVersion,
    stores: options.stores,
    logs: options.logs,
    popup: popupPolicy,
    terminal: () => terminal.status(),
  })
  function assertWorkspace(workspaceId: string) {
    if (!options.isWorkspaceActive()) throw new Error('工作区已变化，请重新打开回复监控')
    if (workspaceId !== options.workspaceId) throw new Error('工作区已变化，请重新打开回复监控')
  }
  function assertOwner(ownerId: number) {
    const current = owner
    if (!current || current.isDestroyed()) throw new Error('回复监控窗口已关闭')
    if (current.webContents.id !== ownerId) throw new Error('调试接口只允许当前回复监控窗口')
    if (!isSameMonitorWindow(current, options.monitor.window()))
      throw new Error('调试接口只允许当前回复监控窗口')
  }
  const ready = (workspaceId: string, ownerId: number) => {
    assertOwner(ownerId)
    assertWorkspace(workspaceId)
  }
  return {
    attach(window: BrowserWindow) {
      if (owner === window && !window.isDestroyed()) return
      stopHost(terminal)
      owner = window
      // 换 owner 后重建宿主，旧会话的 data/exit 回调永远不会指向新窗口。
      terminal = createHost(window)
      window.once('closed', () => {
        if (owner !== window) return
        stopHost(terminal)
        owner = undefined
      })
    },
    ownerId(): number | undefined {
      return owner && !owner.isDestroyed() ? owner.webContents.id : undefined
    },
    ownerWindow(): BrowserWindow | undefined {
      return owner && !owner.isDestroyed() ? owner : undefined
    },
    expand(ownerId: number, request: DeveloperDebugExpandRequest): DeveloperDebugExpandResult {
      ready(request.workspaceId, ownerId)
      return options.monitor.setExpanded(request.expanded)
    },
    gm(ownerId: number, request: DeveloperDebugGmRequest): DeveloperDebugGmResult {
      ready(request.workspaceId, ownerId)
      return gm.run(request)
    },
    async ptyConnect(
      ownerId: number,
      request: DeveloperDebugPtyConnectRequest,
    ): Promise<DeveloperDebugPtyConnectResult> {
      ready(request.workspaceId, ownerId)
      return terminal.connect({ ownerId, ...request })
    },
    ptyWrite(ownerId: number, request: DeveloperDebugPtyWriteRequest): void {
      ready(request.workspaceId, ownerId)
      terminal.write({ ownerId, ...request })
    },
    ptyResize(ownerId: number, request: DeveloperDebugPtyResizeRequest): void {
      ready(request.workspaceId, ownerId)
      terminal.resize({ ownerId, ...request })
    },
    async ptyDisconnect(ownerId: number, request: DeveloperDebugPtySessionRequest): Promise<void> {
      ready(request.workspaceId, ownerId)
      await terminal.disconnect({ ownerId, ...request })
    },
    syncPopupPolicy(storeId: string) {
      popupPolicy.sync(storeId)
    },
    syncAllPopupPolicies() {
      for (const storeId of popupPolicy.modes().keys()) popupPolicy.sync(storeId)
    },
    dispose() {
      stopHost(terminal)
      owner = undefined
      return Promise.all([...cleanups]).then(() => {})
    },
  }
}
function isSameMonitorWindow(current: BrowserWindow, monitor: BrowserWindow | undefined) {
  if (!monitor || monitor.isDestroyed()) return false
  return current.id === monitor.id && current.webContents.id === monitor.webContents.id
}
export type DeveloperDebugController = ReturnType<typeof createDeveloperDebugController>
