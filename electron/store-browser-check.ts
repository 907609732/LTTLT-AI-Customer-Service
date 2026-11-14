import { app, BrowserWindow } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { registerStoreBrowserEnvironment } from './store-browser'

// Only loopback synthetic pages and a fresh profile; never opens a merchant platform.
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-store-browser-'))
app.setPath('userData', isolated)
const output = path.resolve('artifacts/store-browser')
app
  .whenReady()
  .then(async () => {
    const requests: string[] = []
    const server = http.createServer((request, response) => {
      requests.push(request.headers['user-agent'] ?? '')
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><title>隔离浏览器验证</title><body>仅本机验证</body>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const stop = registerStoreBrowserEnvironment({
      app,
      namespace: 'browser-check',
      chromiumVersion: process.versions.chrome,
      userDataDir: isolated,
    })
    const windows: BrowserWindow[] = []
    const create = () => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: 'persist:lingtu-browser-check-store-a',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      windows.push(win)
      return win
    }
    try {
      const chat = create()
      await chat.loadURL(origin + '/chat')
      const ua: unknown = await chat.webContents.executeJavaScript('navigator.userAgent')
      assert.equal(typeof ua, 'string')
      assert.ok(
        String(ua).includes(`Chrome/${process.versions.chrome}`),
        'UA必须使用当前真实内核版本',
      )
      assert.ok(!String(ua).includes('Electron/'), '店铺页不带桌面容器产品标识')
      await chat.webContents.executeJavaScript('localStorage.setItem("isolated-profile", "kept")')
      const backend = create()
      await backend.loadURL(origin + '/backend')
      assert.equal(await backend.webContents.executeJavaScript('navigator.userAgent'), ua)
      assert.equal(
        await backend.webContents.executeJavaScript('localStorage.getItem("isolated-profile")'),
        'kept',
      )
      assert.equal(chat.webContents.session, backend.webContents.session)
      assert.ok(
        requests.length >= 2 && requests.every((value) => value === ua),
        '请求UA和页面UA必须一致',
      )
      assert.equal(await backend.webContents.executeJavaScript('typeof require'), 'undefined')
      assert.equal(await backend.webContents.executeJavaScript('typeof process'), 'undefined')
      fs.mkdirSync(output, { recursive: true })
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(
          {
            pass: true,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
            sameSession: true,
            persistentProfile: true,
            requestAndPageUaMatch: true,
            sandbox: true,
          },
          null,
          2,
        ),
      )
      console.log('店铺浏览器原生环境：通过（仅回环隔离页面）')
    } finally {
      stop()
      for (const win of windows) if (!win.isDestroyed()) win.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
