import { app, BrowserWindow, screen, session } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createAssistWindowManager } from './assist-window'
import { createWindow, loadRenderer } from './windows'
import { registerDesktopIpc } from './ipc'
import { registerBusinessIpc } from './business-ipc'
import type { LocalRuntime } from './local-runtime'
import { emptySnapshot, type BackendCommand } from '../src/shared/contracts/backend'

/** Real preload/IPC/Vue, synthetic isolated workspace only. No vendor runtime or external traffic. */
delete process.env.VITE_DEV_SERVER_URL
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-assist-integration-'))
app.setPath('userData', isolated)
const output = path.resolve('artifacts/assist-integration')
const report: { name: string; pass: boolean; error?: string }[] = []
const wait = async (condition: () => boolean | Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}
app.on('session-created', (ses) => {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) =>
    callback({ cancel: true }),
  )
})
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(output, { recursive: true })
    // Initialize the blocked default session before loading any synthetic application windows.
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    )
    const snapshot = emptySnapshot()
    snapshot.workspaceId = randomUUID()
    snapshot.stores = [
      {
        id: 'synthetic-store',
        storeName: '隔离验证店铺',
        platform: 'sim-local',
        group: '',
        aiEnabled: true,
        runtime: { open: false, online: false },
      },
    ]
    const commands: BackendCommand[] = []
    let active = false
    const platformSnapshot = () => ({ workspaceId: snapshot.workspaceId, stores: [] })
    const runtime: LocalRuntime = {
      start: async () => {},
      snapshot: () => structuredClone(snapshot),
      execute: async (command) => {
        commands.push(command)
        throw new Error('窗口专项验证不执行业务命令')
      },
      subscribe: () => () => false,
      presentStore: () => {},
      assistPlatformSnapshot: platformSnapshot,
      refreshAssistPlatform: async () => platformSnapshot(),
      openAssistPlatformItem: async () => {
        throw new Error('隔离验证不打开真实平台')
      },
      setAssistPlatformActive: (value) => {
        active = value
      },
      simulatorStatus: () => ({ running: false, port: 0, url: '', error: '' }),
      openSimulatorPage: async () => ({ ok: false, message: '窗口专项验证不运行模拟服务' }),
      dispose: async () => {},
    }
    const primary = createWindow({ smoke: true })
    let created = 0
    const manager = createAssistWindowManager({
      rootDir: isolated,
      getPrimary: () => primary,
      getWorkspace: () => ({ id: snapshot.workspaceId, identity: 'synthetic-local' }),
      create: () => {
        created++
        return createWindow({ auxiliary: true })
      },
      load: (win) => loadRenderer(win, '/float/assist'),
      workArea: (parent) => screen.getDisplayMatching(parent.getBounds()).workArea,
      opened: () => runtime.setAssistPlatformActive(true),
      closed: () => runtime.setAssistPlatformActive(false),
    })
    const disposeDesktop = registerDesktopIpc({
      assist: () => manager,
      primary: () => primary,
      runtime: () => runtime,
    })
    const disposeBusiness = registerBusinessIpc(runtime)
    const check = async (name: string, run: () => Promise<void>) => {
      try {
        await run()
        report.push({ name, pass: true })
      } catch (error) {
        report.push({ name, pass: false, error: String(error) })
      }
    }
    await loadRenderer(primary, '/')
    await wait(
      () =>
        primary.webContents.executeJavaScript(
          'Boolean(document.querySelector(".workbench-shell"))',
        ),
      '主界面未挂载',
    )
    const initialUrl = primary.webContents.getURL()
    await check('real-preload-opens-single-vue-sidebar-with-main-preserved', async () => {
      await primary.webContents.executeJavaScript('window.yunduoDesktop.openAssist()')
      await primary.webContents.executeJavaScript('window.yunduoDesktop.openAssist()')
      const auxiliary = manager.window!
      await wait(
        () =>
          auxiliary.webContents.executeJavaScript(
            'document.querySelectorAll("[data-assist-tab]").length === 4',
          ),
        '真实辅助中心四标签未挂载',
      )
      assert.equal(created, 1)
      assert.equal(auxiliary.getBounds().width, 300)
      assert.equal(primary.webContents.getURL(), initialUrl)
      assert.equal(primary.isDestroyed(), false)
      assert.equal(
        await auxiliary.webContents.executeJavaScript(
          'window.yunduoDesktop.assistState().then(s=>s.isAssistWindow)',
        ),
        true,
      )
      assert.equal(
        await primary.webContents.executeJavaScript(
          'window.yunduoDesktop.assistState().then(s=>s.isAssistWindow)',
        ),
        false,
      )
      assert.deepEqual(
        await auxiliary.webContents.executeJavaScript(
          'Array.from(document.querySelectorAll("[data-assist-tab]")).map(n=>n.dataset.assistTab)',
        ),
        ['consult', 'handoff', 'ticket', 'aftersale'],
      )
      assert.deepEqual(
        await auxiliary.webContents.executeJavaScript('window.__vueErrors || []'),
        [],
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      fs.writeFileSync(
        path.join(output, 'empty-sidebar.png'),
        (await auxiliary.webContents.capturePage()).toPNG(),
      )
    })
    await check('vue-toolbar-updates-pinning-and-docking-through-guarded-ipc', async () => {
      const auxiliary = manager.window!
      await auxiliary.webContents.executeJavaScript(
        'document.querySelector("[aria-label=浮窗置顶]").click()',
      )
      await wait(() => !manager.state().pinned, '置顶按钮未更新主进程')
      assert.equal(auxiliary.isAlwaysOnTop(), false)
      await auxiliary.webContents.executeJavaScript(
        'document.querySelector("[aria-label=吸附主窗口]").click()',
      )
      await wait(() => !manager.state().docked, '吸附按钮未更新主进程')
      const invalid = await auxiliary.webContents.executeJavaScript(
        `window.yunduoDesktop.updateAssistPreferences({volume:2},${JSON.stringify(snapshot.workspaceId)}).then(()=>false,()=>true)`,
      )
      assert.equal(invalid, true)
      assert.equal(
        await primary.webContents.executeJavaScript(
          `window.yunduoDesktop.updateAssistPreferences({pinned:false},${JSON.stringify(snapshot.workspaceId)}).then(()=>false,()=>true)`,
        ),
        true,
        '主窗不得修改辅助窗口偏好',
      )
    })
    await check('untrusted-renderer-cannot-call-new-assist-channels', async () => {
      const untrusted = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      try {
        await untrusted.loadURL(
          'data:text/html,<html><body>Untrusted isolated fixture</body></html>',
        )
        const args = JSON.stringify({
          workspaceId: snapshot.workspaceId,
          storeId: 'synthetic-store',
          conversationId: 'synthetic-buyer',
          kind: 'ticket',
        })
        const rejected = await untrusted.webContents.executeJavaScript(
          `(async()=>{const api=window.yunduoDesktop; const value=${args}; const calls=[()=>api.openAssist(),()=>api.assistState(),()=>api.updateAssistPreferences({pinned:false},value.workspaceId),()=>api.closeAssist(),()=>api.openMainSection('settings'),()=>api.openAssistConversation({workspaceId:value.workspaceId,storeId:value.storeId,conversationId:value.conversationId}),()=>api.assistPlatformSnapshot(),()=>api.refreshAssistPlatform({workspaceId:value.workspaceId}),()=>api.openAssistPlatformItem({workspaceId:value.workspaceId,storeId:value.storeId,kind:'ticket'})]; return Promise.all(calls.map(call=>call().then(()=>false,error=>String(error).includes('不可信'))))})()`,
        )
        assert.deepEqual(rejected, Array(9).fill(true))
        assert.equal(created, 1)
      } finally {
        untrusted.destroy()
      }
    })
    await check('system-close-reaches-vue-confirmation-and-keeps-ai-unchanged', async () => {
      const auxiliary = manager.window!
      auxiliary.close()
      const visibleDialog = `Array.from(document.querySelectorAll('.el-dialog')).find(n=>n.getBoundingClientRect().width>0 && n.innerText.includes('关闭 AI 辅助中心'))`
      await wait(
        () => auxiliary.webContents.executeJavaScript(`Boolean(${visibleDialog})`),
        '系统关闭没有显示Vue确认',
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      fs.writeFileSync(
        path.join(output, 'close-confirmation.png'),
        (await auxiliary.webContents.capturePage()).toPNG(),
      )
      await auxiliary.webContents.executeJavaScript(
        `Array.from((${visibleDialog}).querySelectorAll('button')).find(n=>n.textContent.trim()==='取消').click()`,
      )
      await wait(
        () => auxiliary.webContents.executeJavaScript(`!Boolean(${visibleDialog})`),
        '取消后确认弹窗未收起',
      )
      assert.equal(auxiliary.isDestroyed(), false)
      assert.equal(active, true)
      auxiliary.minimize()
      assert.equal(active, true, '最小化不得停止辅助采集')
      await manager.open()
      auxiliary.close()
      await wait(
        () => auxiliary.webContents.executeJavaScript(`Boolean(${visibleDialog})`),
        '第二次关闭未显示确认',
      )
      // The confirmed close destroys this renderer before an executeJavaScript reply can arrive.
      void auxiliary.webContents
        .executeJavaScript(
          `Array.from((${visibleDialog}).querySelectorAll('button')).find(n=>n.textContent.trim()==='关闭').click()`,
        )
        .catch(() => {})
      await wait(() => auxiliary.isDestroyed(), '确认后辅助窗口未关闭')
      assert.equal(active, false)
      assert.equal(primary.isDestroyed(), false)
      assert.equal(snapshot.stores[0].aiEnabled, true, '关闭辅助窗口不得改变店铺AI')
      assert.deepEqual(commands, [], '窗口操作不得执行店铺AI或发送命令')
    })
    manager.dispose()
    disposeDesktop()
    disposeBusiness()
    primary.destroy()
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(
      `辅助中心 preload/IPC/Vue 专项集成：${report.filter((row) => row.pass).length}/${report.length}`,
    )
    app.exit(report.every((row) => row.pass) ? 0 : 1)
  })
  .catch((error) => {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error))
    console.error(error)
    app.exit(1)
  })
