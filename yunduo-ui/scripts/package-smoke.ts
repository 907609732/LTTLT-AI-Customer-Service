import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { z } from 'zod'

const output = path.resolve('artifacts/packaged')
fs.mkdirSync(output, { recursive: true })
const executable = path.resolve(
  process.env.YUNDUO_PACKAGED_EXE || 'release/win-unpacked/YunduoCustomerService.exe',
)
const archive = path.join(path.dirname(executable), 'resources', 'app.asar')
// This API comes from the locked electron-builder toolchain, never the app runtime.
const asar = createRequire(import.meta.url)('@electron/asar') as {
  listPackage(file: string): string[]
}
const members = asar.listPackage(archive).map((name) => name.replaceAll('\\', '/'))
for (const required of [
  '/dist/index.html',
  '/dist-electron/main.cjs',
  '/dist-electron/preload.cjs',
  '/vendor/lingtu-runtime/electron/backend.cjs',
  '/vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js',
  '/vendor/lingtu-runtime/LICENSE',
]) {
  if (!members.includes(required)) throw new Error('Missing packaged file: ' + required)
}
const excluded = members.filter(
  (name) =>
    /^\/(server|artifacts|tests|electron)\//.test(name) ||
    /^\/dist-electron\/smoke\./.test(name) ||
    /\/private\.json$|\/master\.key$|\/managed\.db$|\.map$/.test(name),
)
if (excluded.length) throw new Error('Private/development files in package: ' + excluded.join(', '))

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-packaged-'))
const reservation = net.createServer()
await new Promise<void>((resolve, reject) => {
  reservation.once('error', reject)
  reservation.listen(0, '127.0.0.1', resolve)
})
const address = reservation.address()
if (!address || typeof address === 'string') throw new Error('No loopback debug port')
const port = address.port
await new Promise<void>((resolve) => reservation.close(() => resolve()))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.VITE_DEV_SERVER_URL
// Chromium's own user-data-dir keeps this real binary away from everyday customer data.
const child = spawn(
  executable,
  [`--user-data-dir=${temporary}`, `--remote-debugging-port=${port}`],
  {
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let diagnostic = ''
child.stderr?.on('data', (value: Buffer) => {
  diagnostic = (diagnostic + value.toString()).slice(-12000)
})
child.on('error', (error) => {
  diagnostic = error.message
})
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let socket: WebSocket | undefined
let id = 0
const callbacks = new Map<number, (value: unknown) => void>()
async function call(method: string, params: object = {}): Promise<unknown> {
  const requestId = ++id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      callbacks.delete(requestId)
      reject(new Error('Packaged CDP timeout: ' + method))
    }, 15000)
    callbacks.set(requestId, (raw) => {
      clearTimeout(timer)
      const reply = raw as { result?: unknown; error?: unknown }
      if (reply.error) reject(new Error(JSON.stringify(reply.error)))
      else resolve(reply.result)
    })
    socket?.send(JSON.stringify({ id: requestId, method, params }))
  })
}
async function evaluate(expression: string): Promise<unknown> {
  const reply = (await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result: { value: unknown }
    exceptionDetails?: unknown
  }
  if (reply.exceptionDetails)
    throw new Error('Packaged renderer exception: ' + JSON.stringify(reply.exceptionDetails))
  return reply.result.value
}
try {
  let target: { webSocketDebuggerUrl: string } | undefined
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error('Packaged process exited: ' + diagnostic)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, {
        signal: AbortSignal.timeout(1000),
      })
      const targets = (await response.json()) as {
        type: string
        url: string
        webSocketDebuggerUrl: string
      }[]
      target = targets.find(
        (item) =>
          item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'),
      )
      if (target) break
    } catch {
      /* The real application may still be starting. */
    }
    await delay(250)
  }
  if (!target) throw new Error('Packaged UI did not load: ' + diagnostic)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    if (!socket) return reject(new Error('Missing CDP socket'))
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('Cannot inspect packaged window'))
  })
  socket.onmessage = (event) => {
    const reply = JSON.parse(String(event.data)) as { id?: number }
    if (reply.id) {
      callbacks.get(reply.id)?.(reply)
      callbacks.delete(reply.id)
    }
  }
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    ready =
      (await evaluate(
        `Boolean(document.querySelector('#app')?.children.length && window.yunduoDesktop?.isElectron)`,
      )) === true
    if (ready) break
    await delay(250)
  }
  if (!ready) throw new Error('Packaged UI/preload not ready')
  const state = z
    .object({
      capabilities: z.object({ modelMode: z.literal('local'), apiKeyConfigured: z.literal(false) }),
      stores: z.array(z.unknown()).length(0),
    })
    .parse(await evaluate('window.yunduoDesktop.backendSnapshot()'))
  await evaluate(`location.hash = '/settings'`)
  let settingsReady = false
  for (let attempt = 0; attempt < 80; attempt++) {
    settingsReady =
      (await evaluate(`document.body.innerText.includes('模型来源与托管账号')`)) === true
    if (settingsReady) break
    await delay(250)
  }
  if (!settingsReady) throw new Error('Packaged settings route unavailable')
  const screenshot = (await call('Page.captureScreenshot', { format: 'png' })) as { data: string }
  fs.writeFileSync(path.join(output, 'settings.png'), Buffer.from(screenshot.data, 'base64'))
  const report = {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    executable,
    archiveMembers: members.length,
    checks: [
      'ASAR required runtime/license',
      'ASAR private/development exclusion',
      'real packaged window/preload',
      'real business IPC, empty isolated stores and no Key',
      'settings managed/local route',
    ],
    mode: state.capabilities.modelMode,
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  socket?.close()
  // Stop only the isolated process launched above, then check the generated path before cleanup.
  child.kill()
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(3000),
  ])
  if (
    path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporary).startsWith('yunduo-packaged-')
  ) {
    console.error('Refusing cleanup outside isolated packaged directory')
    process.exitCode = 1
  } else {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
  }
}
