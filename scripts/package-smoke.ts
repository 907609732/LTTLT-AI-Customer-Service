import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { z } from 'zod'

const output = path.resolve('artifacts/packaged')
fs.mkdirSync(output, { recursive: true })
const expectedVersion = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))).version
const executable = path.resolve(
  process.env.LINGTU_PACKAGED_EXE ||
    process.env.YUNDUO_PACKAGED_EXE ||
    'release/win-unpacked/LingtuAI.exe',
)
const archive = path.join(path.dirname(executable), 'resources', 'app.asar')
// This API comes from the locked electron-builder toolchain, never the app runtime.
const asar = createRequire(import.meta.url)('@electron/asar') as {
  listPackage(file: string): string[]
  extractFile(file: string, member: string): Buffer
}
const members = asar.listPackage(archive).map((name) => name.replaceAll('\\', '/'))
for (const required of [
  '/dist/index.html',
  '/dist-electron/main.cjs',
  '/dist-electron/preload.cjs',
  '/vendor/lingtu-runtime/electron/backend.cjs',
  '/vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js',
  '/vendor/lingtu-runtime/LICENSE',
  '/LICENSE',
  '/NOTICE',
  '/docs/legal/LICENSE_SCOPE.md',
  '/vendor/xianyu-bridge/LICENSE',
]) {
  if (!members.includes(required)) throw new Error('Missing packaged file: ' + required)
}
// 混合许可交付必须保留各组件原文，不能只检查根Apache声明而漏掉AGPL运行时。
for (const member of [
  'LICENSE',
  'NOTICE',
  'docs/legal/LICENSING.md',
  'docs/legal/LICENSE_SCOPE.md',
  'docs/legal/THIRD_PARTY_NOTICES.md',
  'vendor/lingtu-runtime/LICENSE',
  'vendor/xianyu-bridge/LICENSE',
]) {
  if (
    !asar.extractFile(archive, path.normalize(member)).equals(fs.readFileSync(path.resolve(member)))
  )
    throw new Error('Packaged licensing material differs from source: ' + member)
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
const mainReservation = net.createServer()
await new Promise<void>((resolve, reject) => {
  mainReservation.once('error', reject)
  mainReservation.listen(0, '127.0.0.1', resolve)
})
const mainAddress = mainReservation.address()
if (!mainAddress || typeof mainAddress === 'string') throw new Error('No main inspector port')
const mainPort = mainAddress.port
await new Promise<void>((resolve) => mainReservation.close(() => resolve()))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.VITE_DEV_SERVER_URL
// Chromium's own user-data-dir keeps this real binary away from everyday customer data.
const child = spawn(
  executable,
  [
    `--user-data-dir=${temporary}`,
    `--remote-debugging-port=${port}`,
    `--inspect-brk=127.0.0.1:${mainPort}`,
  ],
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
let mainSocket: WebSocket | undefined
let mainId = 0
let pausedFrame = ''
const mainCallbacks = new Map<number, (value: unknown) => void>()
async function mainCall(method: string, params: object = {}): Promise<unknown> {
  const requestId = ++mainId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mainCallbacks.delete(requestId)
      reject(new Error('Packaged main inspector timeout: ' + method))
    }, 15000)
    mainCallbacks.set(requestId, (raw) => {
      clearTimeout(timer)
      const reply = raw as { result?: unknown; error?: unknown }
      if (reply.error) reject(new Error(JSON.stringify(reply.error)))
      else resolve(reply.result)
    })
    mainSocket?.send(JSON.stringify({ id: requestId, method, params }))
  })
}
async function mainEvaluate(expression: string, frame = ''): Promise<unknown> {
  const reply = (await mainCall(frame ? 'Debugger.evaluateOnCallFrame' : 'Runtime.evaluate', {
    ...(frame ? { callFrameId: frame } : {}),
    expression,
    returnByValue: true,
    ...(frame ? {} : { awaitPromise: true }),
  })) as { result: { value: unknown }; exceptionDetails?: unknown }
  if (reply.exceptionDetails)
    throw new Error('Packaged main exception: ' + JSON.stringify(reply.exceptionDetails))
  return reply.result.value
}
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
  // Inspect only this isolated child before its entry point. Keep the real application hidden;
  // no source-only environment switch or business preload is added to the shipped program.
  let mainTarget: { webSocketDebuggerUrl: string } | undefined
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error('Packaged process exited: ' + diagnostic)
    try {
      const response = await fetch(`http://127.0.0.1:${mainPort}/json`, {
        signal: AbortSignal.timeout(1000),
      })
      const targets = (await response.json()) as { webSocketDebuggerUrl: string }[]
      mainTarget = targets[0]
      if (mainTarget) break
    } catch {
      /* The isolated child's main inspector is still starting. */
    }
    await delay(250)
  }
  if (!mainTarget) throw new Error('Packaged main inspector unavailable: ' + diagnostic)
  mainSocket = new WebSocket(mainTarget.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    if (!mainSocket) return reject(new Error('Missing main inspector socket'))
    mainSocket.onopen = () => resolve()
    mainSocket.onerror = () => reject(new Error('Cannot inspect packaged main'))
  })
  mainSocket.onmessage = (event) => {
    const reply = JSON.parse(String(event.data)) as {
      id?: number
      method?: string
      params?: { callFrames?: { callFrameId: string }[] }
    }
    if (reply.id) {
      mainCallbacks.get(reply.id)?.(reply)
      mainCallbacks.delete(reply.id)
    } else if (reply.method === 'Debugger.paused')
      pausedFrame = reply.params?.callFrames?.[0]?.callFrameId || ''
  }
  await mainCall('Debugger.enable')
  await mainCall('Runtime.runIfWaitingForDebugger')
  for (let attempt = 0; attempt < 80 && !pausedFrame; attempt++) await delay(100)
  if (!pausedFrame) throw new Error('Packaged main did not pause before startup')
  await mainEvaluate(
    `(() => {
      const electron = require('electron');
      for (const action of ['show', 'showInactive', 'maximize'])
        electron.BrowserWindow.prototype[action] = function() {};
      globalThis.__lingtuPackageDialog = electron.dialog;
      globalThis.__lingtuPackageWindows = electron.BrowserWindow;
      electron.dialog.showErrorBox = (title, message) => console.error(title, message);
      return true;
    })()`,
    pausedFrame,
  )
  await mainCall('Debugger.resume')
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
      (await evaluate(
        `location.hash.includes('/shop/manage') && document.body.innerText.includes('店铺与商品')`,
      )) === true
    if (settingsReady) break
    await delay(250)
  }
  if (!settingsReady) throw new Error('Packaged legacy settings redirect unavailable')
  await evaluate(`location.hash = '/'`)
  let workbenchReady = false
  for (let attempt = 0; attempt < 80; attempt++) {
    workbenchReady =
      (await evaluate(
        `(() => {
          const footer = document.querySelector('.sidebar-footer');
          const actions = footer?.querySelectorAll('button');
          return Boolean(actions?.length === 1 && actions[0].textContent.trim() === '快捷回复' &&
            footer.querySelector('.app-version')?.textContent.trim() === ${JSON.stringify('v' + expectedVersion)} &&
            !document.querySelector('.advanced-model') && document.querySelector('.login-trigger'));
        })()`,
      )) === true
    if (workbenchReady) break
    await delay(250)
  }
  if (!workbenchReady)
    throw new Error('Packaged simplified sidebar, source version or login entry unavailable')
  const captureHidden = () =>
    mainEvaluate(`(async () => {
      const win = globalThis.__lingtuPackageWindows.getAllWindows().find(window =>
        window.webContents.getURL().includes('index.html'));
      const image = await win.webContents.capturePage(undefined, {stayHidden:true, stayAwake:true});
      return image.toPNG().toString('base64');
    })()`)
  const screenshot = z
    .string()
    .min(1)
    .parse(await captureHidden())
  fs.writeFileSync(path.join(output, 'settings.png'), Buffer.from(screenshot, 'base64'))
  await evaluate(`document.querySelector('.login-trigger').click()`)
  let loginReady = false
  for (let attempt = 0; attempt < 80; attempt++) {
    loginReady =
      (await evaluate(`(() => {
        const dialog = document.querySelector('.simple-login-dialog');
        return Boolean(dialog && dialog.getBoundingClientRect().width &&
          dialog.innerText.includes('使用自己的 Key') && dialog.innerText.includes('服务端登录') &&
          !dialog.innerText.includes('托管 API 服务地址') &&
          dialog.querySelector('input[aria-label="登录 API Key"]'));
      })()`)) === true
    if (loginReady) break
    await delay(250)
  }
  if (!loginReady) throw new Error('Packaged simple login dialog unavailable')
  const loginScreenshot = z
    .string()
    .min(1)
    .parse(await captureHidden())
  fs.writeFileSync(path.join(output, 'login.png'), Buffer.from(loginScreenshot, 'base64'))
  const fixturePaths = ['scan.pdf', 'text.docx', 'image.docx', 'sheets.xlsx', 'image.png'].map(
    (name) => path.resolve('tests/fixtures/knowledge-ingestion', name),
  )
  for (const file of fixturePaths)
    if (!fs.existsSync(file)) throw new Error('Missing fixture: ' + file)
  await mainEvaluate(
    `globalThis.__lingtuPackageDialog.showOpenDialog = async () => ({
      canceled: false, filePaths: ${JSON.stringify(fixturePaths)}
    })`,
  )
  const knowledge = await evaluate(`(async () => {
    const desktop = window.yunduoDesktop;
    const before = await desktop.backendSnapshot();
    const added = await desktop.backendExecute({workspaceId: before.workspaceId,
      action:'add-store', values:{platform:'sim-local',storeName:'隔离安装包知识验收'}});
    const storeId = added.data.id;
    const request = input => desktop.knowledge.request({workspaceId:before.workspaceId,
      operation:'pipeline', input});
    const selected = await request({action:'choose-sources',storeId});
    return request({action:'preview-import',storeId,sourceIds:selected.sourceIds,bindingIds:[]});
  })()`)
  const preview = z
    .object({
      parts: z.number().int().positive(),
      rows: z.array(
        z
          .object({
            locator: z
              .object({
                page: z.number().optional(),
                sheet: z.string().optional(),
                image: z.number().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(knowledge)
  if (!preview.rows.some((row) => row.locator.page)) throw new Error('Packaged PDF was not parsed')
  if (
    new Set(preview.rows.flatMap((row) => (row.locator.sheet ? [row.locator.sheet] : []))).size < 2
  )
    throw new Error('Packaged XLSX did not read all sheets')
  if (!preview.rows.some((row) => row.locator.image))
    throw new Error('Packaged DOCX images missing')
  if (
    (await mainEvaluate(
      'globalThis.__lingtuPackageWindows.getAllWindows().every(win => !win.isVisible())',
    )) !== true
  )
    throw new Error('Packaged check must not display a user window')
  const report = {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    executable,
    archiveMembers: members.length,
    checks: [
      'ASAR required runtime/license',
      'ASAR Apache/AGPL license texts and scope match source bytes',
      'ASAR private/development exclusion',
      'real packaged window/preload',
      'real business IPC, empty isolated stores and no Key',
      'legacy settings redirects to configuration center; sidebar keeps only quick replies and matching source version',
      'simple own-Key/server login without server address fields',
      'packaged main parses scan PDF, DOCX embedded image, all XLSX sheets and PNG from ASAR dependencies',
    ],
    mode: state.capabilities.modelMode,
    parsedParts: preview.parts,
    visibleWindows: false,
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  socket?.close()
  mainSocket?.close()
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
