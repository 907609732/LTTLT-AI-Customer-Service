import { app, BrowserWindow, dialog } from 'electron'
import { registerDesktopIpc } from './ipc'
import { createWindow, loadRenderer } from './windows'
import path from 'node:path'
import fs from 'node:fs'
import { createLocalRuntime, type LocalRuntime } from './local-runtime'
import { createWorkspaceRuntime } from './workspace-runtime'
import { registerBusinessIpc } from './business-ipc'
import { PRODUCT_NAME } from '../src/shared/brand'
import { resolveAppUserData } from './app-identity'

app.setName(PRODUCT_NAME)
// Set before the single-instance lock; preserve explicit isolated profiles used by packaged checks.
const userData = resolveAppUserData(
  app.getPath('appData'),
  app.commandLine.getSwitchValue('user-data-dir'),
)
// A fresh install has no legacy directory yet; Electron setPath requires it to exist.
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

let primaryWindow: BrowserWindow | undefined
let runtime: LocalRuntime | undefined
let shuttingDown = false
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
app.on('second-instance', () => {
  if (!primaryWindow || primaryWindow.isDestroyed()) return
  if (primaryWindow.isMinimized()) primaryWindow.restore()
  primaryWindow.show()
  primaryWindow.focus()
})

function openWindow(): void {
  const win = createWindow()
  primaryWindow = win
  void loadRenderer(win).catch((error) => {
    console.error(error)
    dialog.showErrorBox('启动失败', '无法加载界面，请重新构建或检查开发服务器。')
    win.destroy()
  })
}

app
  .whenReady()
  .then(async () => {
    if (!ownsInstance) return
    const dispose = registerDesktopIpc()
    app.once('will-quit', dispose)
    primaryWindow = createWindow()
    // 独立目录，绝不自动迁移或复用其他客服软件的数据和平台登录态。
    runtime = createWorkspaceRuntime({
      factory: () =>
        createLocalRuntime({
          dataDir: path.join(app.getPath('userData'), 'local-runtime'),
          getWindow: () => primaryWindow,
        }),
    })
    const disposeBusiness = registerBusinessIpc(runtime)
    app.once('will-quit', disposeBusiness)
    await runtime.start()
    await loadRenderer(primaryWindow)
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) openWindow()
    })
  })
  .catch((error) => {
    console.error(error)
    dialog.showErrorBox(
      '本地服务启动失败',
      '本地配置或界面未能加载。请保留原数据，查看启动终端或日志后排查；不要删除数据后重试。',
    )
    app.exit(1)
  })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (shuttingDown || !runtime) return
  event.preventDefault()
  shuttingDown = true
  void runtime.dispose().finally(() => app.quit())
})
