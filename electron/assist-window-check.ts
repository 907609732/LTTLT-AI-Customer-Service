import { app, BrowserWindow, screen } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createAssistWindowManager } from './assist-window'
import { createWindow } from './windows'

// Targeted native window verification only: no store runtime, credentials, platform traffic or AI.
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-assist-native-'))
app.setPath('userData', isolated)
const output = path.resolve('artifacts/assist-window')
const report: { name: string; pass: boolean; error?: string }[] = []
const wait = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('原生窗口状态等待超时')
}
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(output, { recursive: true })
    const primary = new BrowserWindow({ width: 1000, height: 700, show: false })
    let created = 0,
      active = false
    let workspace = { id: 'native-local', identity: 'local' }
    const manager = createAssistWindowManager({
      rootDir: isolated,
      getPrimary: () => primary,
      getWorkspace: () => workspace,
      create: () => {
        created++
        return createWindow({ auxiliary: true })
      },
      load: async (win) => {
        await win.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(
              '<!doctype html><html><body style="margin:0;background:#eef6ff;color:#26364c;font:14px sans-serif"><h3>AI 辅助中心 · 隔离窗口验收</h3><p>不加载店铺，不访问网络</p></body></html>',
            ),
        )
      },
      workArea: (parent) => screen.getDisplayMatching(parent.getBounds()).workArea,
      opened: () => {
        active = true
      },
      closed: () => {
        active = false
      },
    })
    const check = async (name: string, run: () => Promise<void> | void) => {
      try {
        await run()
        report.push({ name, pass: true })
      } catch (error) {
        report.push({ name, pass: false, error: String(error) })
      }
    }
    await check('single-300px-window', async () => {
      await manager.open()
      await manager.open()
      assert.equal(created, 1)
      assert.equal(manager.window?.getBounds().width, 300)
      assert.equal(manager.window?.isDestroyed(), false)
      assert.equal(manager.state(manager.window).isAssistWindow, true)
      assert.equal(manager.state(primary).isAssistWindow, false)
    })
    await check('native-docking-and-pinning', async () => {
      const win = manager.window!
      primary.setPosition(100, 100)
      await wait(() => win.getBounds().y === 100)
      manager.update(win, { pinned: false })
      assert.equal(win.isAlwaysOnTop(), false)
      manager.update(win, { pinned: true })
      await wait(() => win.isAlwaysOnTop())
      assert.equal(win.getBounds().width, 300)
      assert.equal(manager.state().docked, true)
      const image = await win.webContents.capturePage()
      fs.writeFileSync(path.join(output, 'window.png'), image.toPNG())
    })
    await check('minimize-keeps-collection-active', async () => {
      manager.window!.minimize()
      assert.equal(active, true)
      await manager.open()
      assert.equal(created, 1)
    })
    await check('workspace-preferences-isolated', () => {
      const win = manager.window!
      manager.update(win, { soundEnabled: true, volume: 0.2 })
      workspace = { id: 'native-account', identity: 'account' }
      manager.syncWorkspace()
      assert.equal(manager.state().soundEnabled, false)
      assert.equal(manager.state().volume, 0.5)
    })
    await check('close-confirmation-and-reopen', async () => {
      const win = manager.window!
      win.close()
      assert.equal(win.isDestroyed(), false, '系统关闭应等界面确认')
      manager.close(win)
      assert.equal(active, false)
      assert.equal(primary.isDestroyed(), false)
      await manager.open()
      assert.equal(created, 2)
      primary.destroy()
      assert.equal(manager.window, undefined)
      assert.equal(active, false)
    })
    manager.dispose()
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`辅助浮窗专项验收：${report.filter((row) => row.pass).length}/${report.length}`)
    app.exit(report.every((row) => row.pass) ? 0 : 1)
  })
  .catch((error) => {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error))
    console.error(error)
    app.exit(1)
  })
