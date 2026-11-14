// CDP 真机验收：用 DevTools 协议驱动真实窗口，不启动任何测试桩。
// 覆盖「加本机模拟店铺 → 顾客页发言 → 桌面端确认回复 → 顾客页收到回复 → 无口令被拒」这条链路。
//
// 运行前提：先构建过一次（node_modules 已装好）、本机有 Microsoft Edge、端口 5173 / 9222 / 9333 / 43100 空闲。
// 全程使用临时 user-data-dir 与临时浏览器资料目录：不读写日常数据，也不连任何真实平台。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'artifacts', 'cdp')
const APP_PORT = 9222
const BR_PORT = 9333
const APP_NAME = '本机演练店'
const PERSONA = '张女士'
const PERSONA_NOTE = '想退货'
const BUYER_TEXT = '你好，我买的卫衣想退货，可以吗？'
const SELLER_TEXT = '可以的，7 天无理由，我这边帮您登记退货地址。'
const DEFAULT_PERSONAS = ['小雨', '阿哲', '陈女士']

fs.mkdirSync(OUT, { recursive: true })
// 上一轮失败留下的现场图/失败报告会和本次成功证据混在一起，开跑前先清掉。
for (const file of fs.readdirSync(OUT)) {
  if (file === 'failure.json' || /^99-failure-.*\.png$/.test(file)) {
    fs.rmSync(path.join(OUT, file), { force: true })
  }
}
const started = Date.now()
const steps = []
const log = (...args) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function step(name, detail) {
  steps.push({ name, detail, at: new Date().toISOString() })
  log('✔', name, detail === undefined ? '' : JSON.stringify(detail))
}

async function getJson(url) {
  const res = await fetch(url)
  return res.json()
}

// 每个 Target 是一个独立的调试目标（Electron 窗口 / 浏览器标签），只暴露本次验收需要的方法。
class Target {
  #ws
  #next = 1
  #pending = new Map()

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data)
      const hit = this.#pending.get(data.id)
      if (!hit) return
      this.#pending.delete(data.id)
      if (data.error) hit.reject(new Error(`${data.error.message} (${data.error.code})`))
      else hit.resolve(data.result)
    })
  }

  static async open(port, match, label) {
    let last = ''
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const list = await getJson(`http://127.0.0.1:${port}/json/list`)
        const hit = list.find((item) => item.type === 'page' && match(item))
        if (hit) {
          const ws = new WebSocket(hit.webSocketDebuggerUrl)
          await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true })
            ws.addEventListener('error', reject, { once: true })
          })
          const target = new Target(ws)
          await target.send('Runtime.enable')
          await target.send('Page.enable')
          return target
        }
        last = list.map((item) => `${item.type}:${item.url}`).join(' | ')
      } catch (error) {
        last = String(error?.message || error)
      }
      await sleep(200)
    }
    throw new Error(`${label}：${port} 上找不到可调试页面（最后看到 ${last}）`)
  }

  send(method, params = {}) {
    const id = this.#next++
    this.#ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description || result.exceptionDetails.text || '未知异常'
      throw new Error(`页面内执行失败：${detail}`)
    }
    return result.result.value
  }

  async waitFor(expression, note, attempts = 200) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return
      } catch {
        // 页面切换过程中执行上下文会短暂失效，重试即可。
      }
      await sleep(100)
    }
    throw new Error(`等待超时：${note}`)
  }

  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'))
    return path.join(OUT, file)
  }

  async navigate(url) {
    await this.send('Page.navigate', { url })
  }
}

const children = []
function launch(command, args, options = {}) {
  const out = fs.openSync(options.logPath || path.join(OUT, 'child.log'), 'a')
  const child = spawn(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', out, out],
    windowsHide: false,
  })
  children.push(child)
  return child
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

async function waitHttp(url, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // 还没起来
    }
    await sleep(250)
  }
  throw new Error(`等待 ${url} 就绪超时`)
}

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate))

const ELECTRON = [
  path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
].find((candidate) => fs.existsSync(candidate))

let edgeProfile = ''
let userDataDir = ''
let viteJob = null
let electronJob = null
let appTarget = null
let browserTarget = null

try {
  if (typeof WebSocket !== 'function') {
    throw new Error('需要 Node 22 及以上（内置 WebSocket），当前版本不支持')
  }
  if (!ELECTRON) throw new Error('没有找到 electron 可执行文件，先执行 npm install')
  if (!EDGE) throw new Error('没有找到 msedge.exe，无法用真实浏览器验证顾客页')

  // 1) 起开发服务器与带调试端口的 Electron；--user-data-dir 让这次运行完全不碰日常数据。
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-cdp-data-'))
  viteJob = launch(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')], {
    logPath: path.join(OUT, 'vite.log'),
  })
  await waitHttp('http://127.0.0.1:5173')
  step('dev-server-ready', 'http://127.0.0.1:5173')

  electronJob = launch(
    ELECTRON,
    ['.', `--remote-debugging-port=${APP_PORT}`, `--user-data-dir=${userDataDir}`],
    {
      env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
      logPath: path.join(OUT, 'electron.log'),
    },
  )
  const app = await Target.open(
    APP_PORT,
    (item) => item.url.includes('127.0.0.1:5173'),
    'Electron 窗口',
  )
  appTarget = app
  step('electron-debug-target', await app.evaluate('location.href'))

  // 2) 界面里真的点「添加店铺」→ 选「本机模拟店铺」→ 起名 → 提交。
  await app.waitFor(`document.querySelector('[aria-label="添加店铺"]')`, '工作台没有添加店铺按钮')
  await app.evaluate(`document.querySelector('[aria-label="添加店铺"]').click()`)
  await app.waitFor(`document.querySelector('.el-dialog')`, '添加店铺弹窗没有打开')
  await app.evaluate(`document.querySelector('[aria-label="本机模拟店铺入口"]').click()`)
  await app.waitFor(
    `document.querySelector('.el-dialog [aria-label="店铺平台"]')`,
    '模拟店铺入口未展开',
  )
  await app.evaluate(`document.querySelector('.el-dialog [aria-label="店铺平台"]').click()`)
  await app.waitFor(
    `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some((node) => node.textContent.includes('本机模拟店铺'))`,
    '平台下拉里没有「本机模拟店铺」',
  )
  await app.evaluate(
    `Array.from(document.querySelectorAll('.el-select-dropdown__item')).find((node) => node.textContent.includes('本机模拟店铺')).click()`,
  )
  await app.waitFor(`document.body.innerText.includes('只在本机运行')`, '选中后没有出现诚实说明')
  await app.evaluate(
    `(() => {const input = document.querySelector('.el-dialog input[aria-label="店铺名称"]'); input.value = ${JSON.stringify(APP_NAME)}; input.dispatchEvent(new Event('input', { bubbles: true }))})()`,
  )
  await app.waitFor(
    `document.querySelector('.el-dialog input[aria-label="店铺名称"]').value === ${JSON.stringify(APP_NAME)}`,
    '店铺名称没有写进输入框',
  )
  step('dialog-filled', { shot: await app.shot('01-add-store-dialog.png') })

  await app.evaluate(`document.querySelector('.el-dialog form button[type="submit"]').click()`)
  // Element Plus 关闭弹窗后元素还留在 DOM 里（只是隐藏），所以“弹窗关掉”要看可见性，不看节点是否存在。
  await app.waitFor(
    `(() => {
      const dialog = document.querySelector('.el-dialog')
      const overlay = dialog && dialog.closest('.el-overlay')
      const closed = !dialog || (overlay && overlay.style.display === 'none') || dialog.offsetParent === null
      return closed && document.body.innerText.includes(${JSON.stringify(APP_NAME)})
    })()`,
    '提交后店铺没有出现在工作台',
  )
  step('store-created', await app.shot('02-dashboard-after-add.png'))

  // 3) 进模拟客服台，通过 preload 桥打开模拟顾客页并拿到真实端口/口令地址。
  await app.evaluate(`location.hash = '#/sim'`)
  await app.waitFor(`document.querySelector('[aria-label="模拟店铺操作"]')`, '模拟客服台没有渲染')
  const opened = await app.evaluate(`window.yunduoDesktop.openSimulatorPage()`)
  const status = await app.evaluate(`window.yunduoDesktop.simulatorStatus()`)
  if (!status?.running || !status?.url) {
    throw new Error(`模拟服务没有真的跑起来：${JSON.stringify(status)}`)
  }
  const pageUrl = status.url
  step('simulator-opened', { message: opened?.message, port: status.port, url: pageUrl })
  const consoleShot = await app.shot('03-sim-console-opened.png')

  // 4) 用真实 Edge 浏览器打开顾客页，新增一位顾客并发言。
  edgeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-cdp-edge-'))
  launch(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${BR_PORT}`,
      `--user-data-dir=${edgeProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1200,860',
      'about:blank',
    ],
    { logPath: path.join(OUT, 'edge.log') },
  )
  const browser = await Target.open(
    BR_PORT,
    (item) => item.url.startsWith('http') || item.url === 'about:blank',
    'Edge 顾客页',
  )
  browserTarget = browser
  await browser.navigate(pageUrl)
  await browser.waitFor(
    `document.querySelectorAll('#persona-list .persona').length >= ${DEFAULT_PERSONAS.length}`,
    '顾客页没有默认人设',
  )
  // 名字节点里还挂着「待回复条数」徽标，所以只取第一个文本子节点，避免把数字当成名字的一部分。
  const personaNames = () =>
    browser.evaluate(
      `Array.from(document.querySelectorAll('#persona-list .persona .persona-name')).map((node) => String(node.childNodes[0] && node.childNodes[0].textContent).trim())`,
    )
  const defaults = await personaNames()
  for (const name of DEFAULT_PERSONAS) {
    if (!defaults.includes(name))
      throw new Error(`顾客页默认人设缺少 ${name}：${defaults.join('、')}`)
  }
  step('customer-page-loaded', { title: await browser.evaluate('document.title'), defaults })

  await browser.evaluate(
    `(() => {
      const name = document.querySelector('#new-name')
      name.value = ${JSON.stringify(PERSONA)}
      name.dispatchEvent(new Event('input', { bubbles: true }))
      const note = document.querySelector('#new-note')
      note.value = ${JSON.stringify(PERSONA_NOTE)}
      note.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('#add-persona').click()
    })()`,
  )
  await browser.waitFor(
    `Array.from(document.querySelectorAll('.persona .persona-name')).some((node) => node.textContent.includes(${JSON.stringify(PERSONA)}))`,
    '新增的顾客没有出现在列表里',
  )
  await browser.evaluate(
    `Array.from(document.querySelectorAll('#persona-list .persona')).find((node) => node.textContent.includes(${JSON.stringify(PERSONA)})).click()`,
  )
  await browser.evaluate(
    `(() => {const input = document.querySelector('#message-input'); input.value = ${JSON.stringify(BUYER_TEXT)}; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#send-button').click()})()`,
  )
  await browser.waitFor(
    `document.querySelector('#messages').innerText.includes(${JSON.stringify(BUYER_TEXT)})`,
    '顾客页没有显示刚发出的消息',
  )
  const personas = await personaNames()
  step('buyer-message-sent', { personas, shot: await browser.shot('04-customer-page.png') })

  // 5) 回到桌面端：消息应进真实会话列表，人工确认后回复写进线程。
  await app.waitFor(
    `(() => {const list = document.querySelector('[aria-label="会话列表"]'); return Boolean(list && list.innerText.includes(${JSON.stringify(PERSONA)}))})()`,
    '顾客消息没有进入桌面端会话列表',
  )
  await app.evaluate(
    `Array.from(document.querySelectorAll('[aria-label="会话列表"] button.runtime-entry')).find((node) => node.textContent.includes(${JSON.stringify(PERSONA)})).click()`,
  )
  // 左侧摘要里也有同样的文字，必须在聊天记录区域里核对，避免拿摘要冒充“会话已打开”。
  await app.waitFor(
    `(() => {const log = document.querySelector('[aria-label="模拟会话消息"]'); return Boolean(log && log.innerText.includes(${JSON.stringify(BUYER_TEXT)}))})()`,
    '会话内容里没有顾客原话',
  )
  const draftShot = await app.shot('05-console-before-reply.png')
  await app.evaluate(
    `(() => {
      const host = document.querySelector('[aria-label="回复内容"]')
      const area = host && host.tagName === 'TEXTAREA' ? host : host && host.querySelector('textarea')
      if (!area) throw new Error('回复输入框缺失')
      area.value = ${JSON.stringify(SELLER_TEXT)}
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })()`,
  )
  await app.waitFor(
    `!document.querySelector('.sim-composer button[type="submit"]').disabled`,
    '回复按钮仍不可点',
  )
  const replyShotBefore = await app.shot('06-console-draft.png')
  await app.evaluate(`document.querySelector('.sim-composer button[type="submit"]').click()`)
  await app.waitFor(
    `(() => {const log = document.querySelector('[aria-label="模拟会话消息"]'); return Boolean(log && log.innerText.includes(${JSON.stringify(SELLER_TEXT)}))})()`,
    '确认后的回复没有写进会话',
  )
  const replyShot = await app.shot('07-console-after-reply.png')
  step('seller-reply-confirmed', { draftShot, replyShotBefore, replyShot })

  // 6) 回复也必须出现在顾客页，且标注为“客服（本机模拟）”。
  await browser.waitFor(
    `document.querySelector('#messages').innerText.includes(${JSON.stringify(SELLER_TEXT)})`,
    '顾客页没有收到客服回复',
  )
  await browser.waitFor(
    `document.querySelector('#messages').innerText.includes('客服（本机模拟）')`,
    '顾客页没有把回复标注成本机模拟客服',
  )
  const threadText = await browser.evaluate(`document.querySelector('#messages').innerText`)
  step('customer-sees-reply', { shot: await browser.shot('08-customer-page-with-reply.png') })

  // 7) 去掉口令直接访问：必须被拒，不能靠“页面能打开”冒充可用。
  const origin = new URL(pageUrl).origin
  await browser.navigate(`${origin}/`)
  await browser.waitFor(`document.body.innerText.includes('运行口令无效')`, '无口令访问没有被拒绝')
  const gateText = await browser.evaluate('document.body.innerText.trim()')
  step('token-gate-refused', { shot: await browser.shot('09-customer-page-no-token.png') })

  fs.writeFileSync(
    path.join(OUT, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        pageUrl,
        consoleShot,
        steps,
        bridgeKeys: await app.evaluate(`Object.keys(window.yunduoDesktop)`),
        personas,
        customerThreadText: threadText,
        tokenGateText: gateText,
      },
      null,
      2,
    ),
  )
  log('全部步骤通过')
} catch (error) {
  const detail = String(error?.stack || error)
  log('失败：', detail)
  const diagnostics = {}
  for (const [name, target] of [
    ['app', appTarget],
    ['browser', browserTarget],
  ]) {
    if (!target) continue
    try {
      diagnostics[name] = {
        url: await target.evaluate('location.href'),
        text: String(await target.evaluate('document.body.innerText')).slice(0, 3000),
        shot: await target.shot(`99-failure-${name}.png`),
      }
    } catch (inner) {
      diagnostics[name] = { error: String(inner?.message || inner) }
    }
  }
  fs.writeFileSync(
    path.join(OUT, 'failure.json'),
    JSON.stringify({ ok: false, error: detail, steps, diagnostics }, null, 2),
  )
  process.exitCode = 1
} finally {
  killTree(electronJob)
  killTree(viteJob)
  for (const child of children) killTree(child)
  // 临时资料目录用完就删：这次运行里的模拟店铺、会话和浏览器状态都不该留下来。
  for (const dir of [edgeProfile, userDataDir].filter(Boolean)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        // 进程刚被杀掉时文件还锁着，等一会儿再删。
        await sleep(400)
      }
    }
    if (fs.existsSync(dir)) log('临时目录暂时删不掉（下次运行不影响）：', dir)
  }
}
