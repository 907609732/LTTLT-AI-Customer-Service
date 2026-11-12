import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
import { createWindow, rendererPath } from './windows'
import { registerDesktopIpc } from './ipc'
import { createLocalRuntime } from './local-runtime'
import { registerBusinessIpc } from './business-ipc'
import { businessChecks } from './business-checks'
import { domSendChecks } from './dom-send-checks'

const isolatedRoot =
  process.env.YUNDUO_SMOKE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-smoke-'))
app.setPath('userData', path.join(isolatedRoot, 'electron'))

const output = path.join(__dirname, '..', 'artifacts', 'desktop')
const routes = [
  ['login', '/login'],
  ['dashboard', '/'],
  ['settings', '/settings'],
  ['runtime-logs', '/logs'],
  ['shop-manage', '/shop/manage'],
  ['shop-recharge', '/shop/recharge'],
  ['shop-login', '/shop/login'],
  ['shop-forgot', '/shop/forgot-password'],
  ['shop-home', '/shop/home'],
  ['shop-aftersale', '/shop/aftersale-warning'],
  ['hub', '/hub'],
  ['snap-overlay', '/snap-overlay'],
  ['float-assist', '/float/assist'],
  ['float-mascot', '/float/mascot'],
] as const
const panels = [
  'home',
  'shops',
  'goods',
  'desk',
  'transfer',
  'welcome',
  'auto',
  'image',
  'intent',
  'intent-doc',
  'intent-chat',
  'training',
  'aicustom',
  'kb',
  'banned',
  'workorder',
  'qc',
  'orders',
  'usage',
  'general',
  'account',
]
interface PageInfo {
  nodes: number
  text: string
  errors: unknown[]
}
interface CheckResult {
  name: string
  route: string
  pass: boolean
  error?: string
}
const report: CheckResult[] = []

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(output, { recursive: true })
    const dispose = registerDesktopIpc(),
      win = createWindow({ smoke: true })
    const dataDir = path.join(isolatedRoot, 'backend')
    let runtime = createLocalRuntime({ dataDir, getWindow: () => win })
    let disposeBusiness = registerBusinessIpc(runtime)
    let pageSequence = 0
    let consoleErrors: string[] = []
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) consoleErrors.push(message)
    })
    const check = async (name: string, route: string, run: () => Promise<void>) => {
      try {
        await run()
        report.push({ name, route, pass: true })
      } catch (error) {
        report.push({ name, route, pass: false, error: String(error) })
      }
    }
    const ready = () =>
      win.webContents.executeJavaScript(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      )
    const load = async (route: string) => {
      consoleErrors = []
      // 相同 file URL 只改变 hash 时不会重载；每个用例使用独立文档，隔离弹窗和提示状态。
      await win.loadFile(rendererPath, { hash: route, query: { smoke: String(++pageSequence) } })
      await ready()
      await new Promise((resolve) => setTimeout(resolve, 150))
      const info = (await win.webContents.executeJavaScript(
        `({ nodes: document.querySelectorAll('#app *').length, text: document.body.innerText, errors: window.__vueErrors || [] })`,
      )) as PageInfo
      assert.deepEqual(info.errors, [], `${route} Vue 渲染错误`)
      assert.deepEqual(consoleErrors, [], `${route} 控制台错误`)
      assert.ok(info.nodes > 0, `${route} 缺少主体`)
      if (!['/snap-overlay', '/float/mascot'].includes(route))
        assert.ok(info.text.trim().length > 2, `${route} 空白页面`)
    }
    for (const [name, route] of routes)
      await check(name, route, async () => {
        await load(route)
        const shot = await win.webContents.capturePage()
        assert.ok(!shot.isEmpty(), '截图为空')
        fs.writeFileSync(path.join(output, `${name}.png`), shot.toPNG())
      })
    for (const panel of panels)
      await check(`panel:${panel}`, '/shop/manage', async () => {
        await load(`/shop/manage?panel=${panel}`)
        const nodes = await win.webContents.executeJavaScript(
          `document.querySelector('.shop-main-panel-host')?.children.length`,
        )
        assert.ok(nodes > 0, `${panel} 面板未挂载`)
      })
    await check('redirect', '/float/messages', async () => {
      await load('/float/messages')
      assert.equal(await win.webContents.executeJavaScript('location.hash'), '#/float/assist')
    })
    await check('unknown-route', '/unknown', async () => {
      await load('/unknown')
      assert.equal(await win.webContents.executeJavaScript('location.hash'), '#/')
    })
    await check('login-preview', '/login', async () => {
      await load('/login')
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.login-mode-switch button')[1].click()`,
      )
      await ready()
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('input[type="password"]').length`,
        ),
        1,
      )
      await win.webContents.executeJavaScript(
        `const input = document.querySelector('input[autocomplete="username"]'); input.value = '13800000000'; input.dispatchEvent(new Event('input', {bubbles:true}))`,
      )
      await ready()
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('input[autocomplete="username"]').value`,
        ),
        '13800000000',
      )
      await win.webContents.executeJavaScript(`document.querySelector('.login-submit').click()`)
      await ready()
      assert.equal(
        await win.webContents.executeJavaScript('location.hash'),
        '#/login',
        '未接入登录不能伪造成功跳转',
      )
      assert.equal(
        await win.webContents.executeJavaScript(`document.querySelectorAll('.el-message').length`),
        1,
      )
    })
    await check('dialogs-and-navigation', '/', async () => {
      await load('/')
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.el-overlay:not([style*="display: none"])').length`,
        ),
        0,
      )
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="添加店铺"]').click()`,
      )
      await ready()
      assert.ok(
        await win.webContents.executeJavaScript(
          `document.body.innerText.includes('添加后 AI 默认关闭')`,
        ),
      )
      await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.el-dialog button')).find(b => b.textContent.trim() === '关闭').click()`,
      )
      await ready()
      await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.top-navigation button')).find(b => b.textContent.includes('配置中心')).click()`,
      )
      await ready()
      assert.equal(await win.webContents.executeJavaScript('location.hash'), '#/shop/manage')
      assert.equal(
        await win.webContents.executeJavaScript(`document.querySelectorAll('.el-message').length`),
        0,
        '导航不应触发业务占位提示',
      )
    })
    await check('desktop-ipc', '/', async () => {
      await load('/')
      win.setPosition(120, 120)
      const start = win.getPosition()
      assert.equal(
        await win.webContents.executeJavaScript(
          `window.yunduoDesktop.beginMove({screenX:NaN,screenY:10})`,
        ),
        false,
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          `window.yunduoDesktop.beginMove({screenX:${start[0] + 200},screenY:${start[1] + 20}})`,
        ),
        true,
      )
      await win.webContents.executeJavaScript(
        `window.yunduoDesktop.move({screenX:${start[0] + 260},screenY:${start[1] + 80}})`,
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.deepEqual(win.getPosition(), [start[0] + 60, start[1] + 60])
      await win.webContents.executeJavaScript('window.yunduoDesktop.endMove()')
      await win.webContents.executeJavaScript(
        `window.yunduoDesktop.move({screenX:800,screenY:800})`,
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.deepEqual(win.getPosition(), [start[0] + 60, start[1] + 60], '结束拖动后不能继续移动')
      const rejected = await win.webContents.executeJavaScript(
        `window.yunduoDesktop.openExternal('javascript:alert(1)').then(() => false, () => true)`,
      )
      assert.equal(rejected, true)
      assert.equal(await win.webContents.executeJavaScript(`typeof window.require`), 'undefined')
    })
    await businessChecks({
      win,
      dataDir,
      check,
      load,
      restart: async () => {
        disposeBusiness()
        await runtime.dispose()
        runtime = createLocalRuntime({ dataDir, getWindow: () => win })
        disposeBusiness = registerBusinessIpc(runtime)
        await load('/settings')
      },
    })
    await domSendChecks(check)
    const failure = report.some((result) => !result.pass)
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    dispose()
    disposeBusiness()
    await runtime.dispose()
    win.destroy()
    console.log(
      `桌面验收：${report.filter((r) => r.pass).length}/${report.length} 通过；报告 ${output}`,
    )
    app.exit(failure ? 1 : 0)
  })
  .catch((error) => {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error))
    console.error(error)
    app.exit(1)
  })
