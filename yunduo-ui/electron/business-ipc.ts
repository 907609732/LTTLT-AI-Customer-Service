import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import { requireAppFrame, type LocalRuntime } from './local-runtime'
import { isAppWebContents, isTrustedRenderer } from './windows'

/** 平台页面没有本应用 preload，且不在应用窗口集合中，不能访问配置与密钥接口。 */
export function registerBusinessIpc(runtime: LocalRuntime): () => void {
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
    for (const name of ['business:snapshot', 'business:execute', 'business:present-store'])
      ipcMain.removeHandler(name)
  }
}
