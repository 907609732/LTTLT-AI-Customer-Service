import { BrowserWindow, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { requireAppFrame, type LocalRuntime } from './local-runtime'
import { isAppWebContents, isTrustedRenderer } from './windows'
import { toManagedServiceFailure } from './managed-service-error'
import type { ManagedServiceResponse } from '../src/shared/contracts/managed-service-error'
import {
  managedBusinessRequestSchema,
  managedCheckoutRequestSchema,
} from '../src/shared/contracts/managed-business'

/** 平台页面没有本应用 preload，且不在应用窗口集合中，不能访问配置与密钥接口。 */
export function registerBusinessIpc(runtime: LocalRuntime): () => void {
  const assertManagedWorkspace = (workspaceId: string) => {
    const snapshot = runtime.snapshot()
    if (
      snapshot.workspaceId !== workspaceId ||
      snapshot.managed.active.mode !== 'managed' ||
      snapshot.managed.restartRequired ||
      snapshot.managed.session.status !== 'signed_in'
    )
      throw new Error('托管账号工作区已改变或未登录，请刷新后重试')
  }
  ipcMain.handle('managed:business-request', async (event, input: unknown) => {
    requireAppFrame(event)
    const { workspaceId, request } = managedBusinessRequestSchema.parse(input)
    assertManagedWorkspace(workspaceId)
    const before = runtime.snapshot().managed
    let result: ManagedServiceResponse
    try {
      result = { ok: true, data: await runtime.serviceRequest(request.endpoint, request) }
    } catch (cause) {
      result = { ok: false, error: toManagedServiceFailure(cause) }
    }
    const after = runtime.snapshot()
    if (
      after.workspaceId !== workspaceId ||
      after.managed.active.mode !== 'managed' ||
      after.managed.restartRequired ||
      after.managed.active.apiOrigin !== before.active.apiOrigin ||
      after.managed.active.portalOrigin !== before.active.portalOrigin ||
      (after.managed.session.account &&
        after.managed.session.account.userId !== before.session.account?.userId)
    )
      throw new Error('托管账号工作区已改变，请刷新后重试')
    // A 401/403 terminal transition belongs to this request. Keep its typed failure;
    // successful business data still requires the original signed-in workspace.
    if (result.ok) assertManagedWorkspace(workspaceId)
    return result
  })
  ipcMain.handle('managed:open-checkout', async (event, input: unknown) => {
    requireAppFrame(event)
    const request = managedCheckoutRequestSchema.parse(input)
    assertManagedWorkspace(request.workspaceId)
    await shell.openExternal(request.url)
  })
  ipcMain.handle('business:snapshot', (event) => {
    requireAppFrame(event)
    return runtime.snapshot()
  })
  ipcMain.handle('business:execute', (event, command) => {
    requireAppFrame(event)
    return runtime.execute(command)
  })
  ipcMain.handle('business:present-store', (event, input) => {
    requireAppFrame(event)
    const value = z
      .object({ storeId: z.string().max(64), visible: z.boolean() })
      .strict()
      .parse(input)
    runtime.presentStore(value.storeId, value.visible)
  })
  // 模拟顾客页的状态与启动入口：只返回端口/地址，页面口令留在主进程内存与用户复制的那条链接里。
  ipcMain.handle('sim:status', (event) => {
    requireAppFrame(event)
    return runtime.simulatorStatus()
  })
  ipcMain.handle('sim:open-page', (event) => {
    requireAppFrame(event)
    return runtime.openSimulatorPage()
  })
  const off = runtime.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && isAppWebContents(win.webContents.id)) {
        // 仅应用自建的可信页面接收业务通知，平台页面不接收。
        try {
          const url = win.webContents.getURL()
          if (isTrustedRenderer(url)) win.webContents.send('business:event', event)
        } catch {
          /* 窗口关闭与事件广播允许并发发生。 */
        }
      }
    }
  })
  return () => {
    off()
    for (const name of [
      'business:snapshot',
      'managed:business-request',
      'managed:open-checkout',
      'business:execute',
      'business:present-store',
      'sim:status',
      'sim:open-page',
    ])
      ipcMain.removeHandler(name)
  }
}
