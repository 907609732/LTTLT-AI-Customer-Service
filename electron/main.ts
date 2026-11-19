import { app, BrowserWindow, dialog, screen, ipcMain } from 'electron'
import { createAgentGateway } from './agent/gateway'
import { createAgentService } from './agent/service'
import { reportStartupFailure } from './startup-failure'
import { createKnowledgeWindow } from './knowledge-window'
import { protectKnowledgeClose } from './knowledge-close'
import { registerKnowledgeIpc } from './knowledge-ipc'
import { registerDesktopIpc } from './ipc'
import { createWindow, loadRenderer } from './windows'
import path from 'node:path'
import fs from 'node:fs'
import { createLocalRuntime, requireAppFrame } from './local-runtime'
import { registerCustomPhrasesIpc } from './custom-phrases-ipc'
import { registerStoreSyncIpc } from './store-sync-ipc'
import { registerSchedulerIpc } from './scheduler-ipc'
import { createWorkspaceRuntime } from './workspace-runtime'
import { registerBusinessIpc } from './business-ipc'
import { registerPlatformFeatureIpc } from './platform-feature-ipc'
import { registerDeveloperDebugIpc } from './developer-debug/ipc'
import { PRODUCT_NAME } from '../src/shared/brand'
import { resolveAppUserData, WINDOWS_APP_USER_MODEL_ID } from './app-identity'
import { createAssistWindowManager, type AssistWindowManager } from './assist-window'

app.setName(PRODUCT_NAME)
// Match the AppUserModelID written into the installer shortcut (builder appId).
// Only packaged builds own that shortcut: applying it to a source run would make
// Windows group the dev window under an installed shortcut and use that shortcut's
// (possibly stale) icon instead of the window icon under verification.
if (app.isPackaged && process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
// Set before the single-instance lock; preserve explicit isolated profiles used by packaged checks.
const userData = resolveAppUserData(
  app.getPath('appData'),
  app.commandLine.getSwitchValue('user-data-dir'),
)
// A fresh install has no legacy directory yet; Electron setPath requires it to exist.
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

let primaryWindow: BrowserWindow | undefined
let knowledgeClose: ReturnType<typeof protectKnowledgeClose> | undefined
let runtime: ReturnType<typeof createWorkspaceRuntime> | undefined
let assist: AssistWindowManager | undefined
let shuttingDown = false
let restartScheduled = false
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
app.on('second-instance', () => {
  if (!primaryWindow || primaryWindow.isDestroyed()) return
  if (primaryWindow.isMinimized()) primaryWindow.restore()
  primaryWindow.show()
  primaryWindow.focus()
})

function openWindow(): void {
  const win = createWindow({ startMaximized: true })
  primaryWindow = win
  knowledgeClose = protectKnowledgeClose(win, () => shuttingDown)
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
    primaryWindow = createWindow({ startMaximized: true })
    knowledgeClose = protectKnowledgeClose(primaryWindow, () => shuttingDown)
    // 独立目录，绝不自动迁移或复用其他客服软件的数据和平台登录态。
    runtime = createWorkspaceRuntime({
      restartAfterKnowledgeClearFailure: () => {
        if (shuttingDown || restartScheduled) return
        // Electron retains the current source path/profile/arguments; graceful quit
        // drains runtime services before the replacement instance can take the lock.
        app.relaunch()
        restartScheduled = true
        app.quit()
      },
      factory: () =>
        createLocalRuntime({
          dataDir: path.join(app.getPath('userData'), 'local-runtime'),
          getWindow: () => primaryWindow,
        }),
    })
    const disposeBusiness = registerBusinessIpc(runtime)
    const disposePlatformFeatures = registerPlatformFeatureIpc({
      runtime,
      authorize: requireAppFrame,
    })
    app.once('will-quit', disposePlatformFeatures)
    // app.isPackaged is the sole authority: no controller, IPC or preload bridge in a packaged app.
    const disposeDeveloperDebug = registerDeveloperDebugIpc({
      enabled: !app.isPackaged,
      runtime: () => runtime,
    })
    app.once('will-quit', disposeDeveloperDebug)
    const knowledgeWindow = createKnowledgeWindow({
      embedded: {
        publish: (context) => primaryWindow?.webContents.send('knowledge:context', context),
        open: (context) => {
          const win = primaryWindow
          if (!win || win.isDestroyed()) throw Error('主工作台尚未就绪')
          win.webContents.send('knowledge:navigate', {
            workspaceId: context.workspaceId,
            target: 'library',
          })
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        },
        hide: (context) => {
          if (knowledgeClose?.acknowledge()) return
          primaryWindow?.webContents.send('knowledge:navigate', {
            workspaceId: context.workspaceId,
            target: 'home',
          })
        },
      },
      workspace: () => runtime!.snapshot().workspaceId,
      stores: () => runtime!.snapshot().stores.map((s) => s.id),
    })
    const disposeKnowledge = registerKnowledgeIpc({
      ipc: {
        handle: (name, handler) => ipcMain.handle(name, handler),
        removeHandler: (name) => ipcMain.removeHandler(name),
      },
      authorize: (event) => requireAppFrame(event as Electron.IpcMainInvokeEvent),
      authorizeHide: (event) => {
        if ((event as Electron.IpcMainInvokeEvent).sender !== primaryWindow?.webContents)
          throw Error('只能由主工作台关闭内嵌知识库')
      },
      resolve: () => {
        const current = runtime!
        return {
          workspaceId: current.snapshot().workspaceId,
          request: (input) => current.knowledge().request(input),
        }
      },
      window: knowledgeWindow,
      restore: (workspaceId, token) => runtime!.restoreKnowledge(workspaceId, token),
      clear: (workspaceId, token, confirmation) =>
        runtime!.clearKnowledge(workspaceId, token, confirmation),
    })
    app.once('will-quit', () => {
      disposeKnowledge()
      knowledgeWindow.dispose()
    })
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
    const agentService = createAgentService({ version: app.getVersion(), runtime: () => runtime! })
    try {
      const agentGateway = await createAgentGateway({
        directory: app.getPath('userData'),
        call: agentService.call,
        connectorPath: app.isPackaged
          ? path.join(process.resourcesPath, 'ai-interface', 'lingtu-mcp.cjs')
          : path.join(__dirname, 'lingtu-mcp.cjs'),
      })
      app.once('will-quit', () => {
        void agentGateway.close()
      })
    } catch {
      console.error('本机AI接口未启动，请检查资料目录权限或重启；桌面业务继续可用。')
    }
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
    reportStartupFailure(error, {
      showErrorBox: dialog.showErrorBox,
      exit: (code) => app.exit(code),
    })
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
