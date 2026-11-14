import { app, BrowserWindow } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createAssistQueryMonitor } from './assist-platform-query'
import { clickPddQuery } from './assist-platform-pdd'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-query-'))
app.setPath('userData', profile)
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/query')) {
    res.writeHead(req.url.includes('fail') ? 500 : 200, { 'Content-Type': 'application/json' })
    res.write('{"fixture":')
    setTimeout(() => res.end('true}'), 350)
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<main id="pdd-app-skeleton-main-content"><button>查询</button><p id="status">initial</p></main><script>
      const savedFetch = window.fetch.bind(window)
      window.fetch = () => { throw Error('must use saved fetch') }
      window.mode = 'ok'
      document.querySelector('button').onclick = async () => {
        const r = await savedFetch('/query?'+window.mode)
        await r.json()
        document.querySelector('#status').textContent = 'rendered'
      }
    </script>`)
  }
})
app
  .whenReady()
  .then(async () => {
    const results: { name: string; pass: boolean }[] = []
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const monitor = createAssistQueryMonitor(origin)
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    try {
      win.webContents.on('console-message', (details) => console.log(details.message))
      await win.loadURL(origin)
      const run = () =>
        monitor.run(
          win.webContents,
          async () => {
            await win.webContents.executeJavaScript(`(${clickPddQuery.toString()})()`)
          },
          async () =>
            win.webContents.executeJavaScript(
              `document.querySelector('#status').textContent === 'rendered'`,
            ),
        )
      const start = Date.now()
      await run()
      assert(Date.now() - start >= 350)
      results.push({ name: 'saved fetch and delayed response body', pass: true })
      await win.webContents.executeJavaScript(
        `window.mode='fail'; document.querySelector('#status').textContent='initial'`,
      )
      await assert.rejects(run(), /请求失败/)
      results.push({ name: 'failed response cannot report success', pass: true })
      fs.mkdirSync('artifacts/assist-query', { recursive: true })
      fs.writeFileSync(
        'artifacts/assist-query/report.json',
        JSON.stringify({ electron: process.versions.electron, results }, null, 2),
      )
      console.log('原生查询观察：2/2')
    } finally {
      monitor.dispose()
      win.destroy()
      server.close()
    }
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    server.close()
    app.exit(1)
  })
