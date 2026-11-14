import { app, BrowserWindow, dialog, screen, ipcMain } from 'electron'
import { registerDesktopIpc } from './ipc'
import { createWindow, loadRenderer } from './windows'
import path from 'node:path'
import fs from 'node:fs'
import { createLocalRuntime, requireAppFrame, type LocalRuntime } from './local-runtime'
import { registerCustomPhrasesIpc } from './custom-phrases-ipc'
import { registerStoreSyncIpc } from './store-sync-ipc'
import { registerSchedulerIpc } from './scheduler-ipc'
import { createWorkspaceRuntime } from './workspace-runtime'
import { registerBusinessIpc } from './business-ipc'
import { PRODUCT_NAME } from '../src/shared/brand'
import { resolveAppUserData } from './app-identity'
import { createAssistWindowManager, type AssistWindowManager } from './assist-window'

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
let assist: AssistWindowManager | undefined
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
    const dispose = registerDesktopIpc({
      assist: () => assist,
      primary: () => primaryWindow,
      runtime: () => runtime,
    })
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
    const activeRuntime = runtime
    const disposePhrases = registerCustomPhrasesIpc(activeRuntime, () =>
      path.join(activeRuntime.dataDirectory(), 'custom-phrases'),
    )
    const disposeSync = registerStoreSyncIpc({
      ipcMain,
      authorize: requireAppFrame,
      resolveCurrent: () => ({
        workspaceId: activeRuntime.snapshot().workspaceId,
        service: activeRuntime.storeSync(),
      }),
    })
    const disposeScheduler = registerSchedulerIpc({
      requireAppFrame,
      resolveCurrent: () => activeRuntime.scheduler(),
    })
    app.once('will-quit', () => {
      disposePhrases()
      disposeSync()
      disposeScheduler()
    })
    app.once('will-quit', disposeBusiness)
    await runtime.start()
    assist = createAssistWindowManager({
      rootDir: path.join(app.getPath('userData'), 'local-runtime'),
      getPrimary: () => primaryWindow,
      getWorkspace: () => {
        if (!runtime) throw new Error('工作区尚未就绪')
        const snapshot = runtime.snapshot()
        const active = snapshot.managed.active
        return {
          id: snapshot.workspaceId,
          identity:
            active.mode === 'local'
              ? 'local'
              : JSON.stringify([
                  active.apiOrigin,
                  active.portalOrigin,
                  snapshot.managed.session.account?.userId ?? 'signed-out',
                ]),
        }
      },
      create: () => createWindow({ auxiliary: true }),
      load: (win) => loadRenderer(win, '/float/assist'),
      workArea: (parent) => screen.getDisplayMatching(parent.getBounds()).workArea,
      opened: () => runtime?.setAssistPlatformActive(true),
      closed: () => runtime?.setAssistPlatformActive(false),
    })
    const offAssistWorkspace = runtime.subscribe(() => {
      try {
        assist?.syncWorkspace()
      } catch {
        /* A damaged auxiliary preference must not interrupt the store runtime. Opening the panel reports it. */
      }
    })
    app.once('will-quit', () => {
      offAssistWorkspace()
      assist?.dispose()
    })
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
  // Whole-application shutdown is not an auxiliary-only close request.
  assist?.dispose()
  void runtime.dispose().finally(() => app.quit())
})
