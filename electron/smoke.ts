import { simpleLoginChecks } from './simple-login-checks'
import { app, WebContentsView, type Session } from 'electron'
import type { BackendSnapshot } from '../src/shared/contracts/backend'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
import { createWindow, rendererPath } from './windows'
import { registerDesktopIpc } from './ipc'
import { createLocalRuntime, requireAppFrame } from './local-runtime'
import { createWorkspaceRuntime } from './workspace-runtime'
import { registerBusinessIpc } from './business-ipc'
import { registerPlatformFeatureIpc } from './platform-feature-ipc'
import { businessChecks } from './business-checks'
import { domSendChecks } from './dom-send-checks'
import { simChecks } from './sim-checks'
import { genericPhraseChecks } from './generic-phrase-checks'
import { managedChecks } from './managed-checks'

const isolatedRoot =
  process.env.YUNDUO_SMOKE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-smoke-'))
app.setPath('userData', path.join(isolatedRoot, 'electron'))

const selectedChecks = (process.env.LINGTU_DESKTOP_CHECKS ?? '').split(',').filter(Boolean)
const output = path.join(
  __dirname,
  '..',
  'artifacts',
  selectedChecks.length ? `desktop-selected-${Date.now()}` : 'desktop',
)
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
  ['sim-console', '/sim'],
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
      // WebContentsView 需要正常窗口的合成画面，离屏父窗口无法提供平台页截图。
      win = createWindow()
    const dataDir = path.join(isolatedRoot, 'backend')
    let runtime = createWorkspaceRuntime({
      factory: () => createLocalRuntime({ dataDir, getWindow: () => win }),
    })
    let disposeBusiness = registerBusinessIpc(runtime)
    let disposeFeatures = registerPlatformFeatureIpc({ runtime, authorize: requireAppFrame })
    let pageSequence = 0
    let consoleErrors: string[] = []
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) consoleErrors.push(message)
    })
    const check = async (name: string, route: string, run: () => Promise<void>) => {
      // 日常只执行明确选择的受影响流程；未设置时保留Release全量验收。
      if (selectedChecks.length && !selectedChecks.includes(name)) return
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
      const inspectPage = () =>
        win.webContents.executeJavaScript(
          `({ nodes: document.querySelectorAll('#app *').length, text: document.body.innerText, errors: window.__vueErrors || [] })`,
        ) as Promise<PageInfo>
      let info = await inspectPage()
      // Lazy route chunks can mount after did-finish-load, especially during parallel native builds.
      // Wait for actual app content within a bound; retain all original error/empty-page assertions.
      for (let attempt = 0; attempt < 100 && info.nodes === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        await ready()
        info = await inspectPage()
      }
      assert.deepEqual(info.errors, [], `${route} Vue 渲染错误`)
      assert.deepEqual(consoleErrors, [], `${route} 控制台错误`)
      assert.ok(info.nodes > 0, `${route} 缺少主体`)
      if (!['/snap-overlay', '/float/mascot'].includes(route))
        assert.ok(info.text.trim().length > 2, `${route} 空白页面`)
    }
    for (const [name, route] of routes)
      await check(name, route, async () => {
        await load(route)
        if (route === '/') {
          const brand = await win.webContents.executeJavaScript(
            `({ title: document.title, name: document.querySelector('.brand-mark-copy strong')?.textContent })`,
          )
          assert.equal(brand.title, '工作台 · 灵兔 AI')
          assert.equal(brand.name, '灵兔 AI')
        }
        if (route === '/login') {
          const artwork = await win.webContents.executeJavaScript(
            `(() => { const image = document.querySelector('.login-promo-artwork'); return { source: image?.getAttribute('src'), loaded: image?.complete && image?.naturalWidth > 0 }; })()`,
          )
          assert.ok(artwork.source?.includes('lingtu-ai-login-promo'))
          assert.equal(artwork.loaded, true)
        }
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
          `(() => {
            const dialog = document.querySelector('.add-platform-dialog');
            const card = id => dialog?.querySelector('[data-platform="' + id + '"]');
            return dialog && dialog.querySelectorAll('[data-platform]').length === 11
              && card('pdd-web').textContent.includes('已开通') && !card('pdd-web').disabled
              && card('doudian-client').textContent.includes('已开通') && !card('doudian-client').disabled
              && card('qianniu').textContent.includes('开发中') && card('qianniu').disabled
              && card('doudian-web').textContent.includes('未开通') && card('doudian-web').disabled
              && dialog.querySelector('button[type="submit"]').disabled
              && !dialog.querySelector('[aria-pressed="true"]')
              && !dialog.querySelector('input[aria-label="店铺名称"]');
          })()`,
        ),
        '平台选择应准确显示接入状态，默认不选且禁止直接提交',
      )
      fs.writeFileSync(
        path.join(output, 'add-platform-dialog.png'),
        (await win.capturePage()).toPNG(),
      )
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="取消添加店铺"]').click()`,
      )
      await ready()
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('.el-overlay:not([style*="display: none"])').length === 0`,
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.el-overlay:not([style*="display: none"])').length`,
        ),
        0,
        '取消后弹窗应关闭且不执行添加',
      )
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
    await check('add-store-direct-login', '/', async () => {
      await load('/')
      const sessions = new Set<Session>()
      let storeId = ''
      const onSession = (ses: Session) => {
        // 只在此隔离用例创建店铺时拦截新分区，所有 HTTPS 响应都留在本机。
        ses.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><html><body><h1>离线平台登录夹具</h1><input aria-label="夹具登录账号"></body></html>',
              { headers: { 'content-type': 'text/html; charset=utf-8' } },
            ),
        )
        sessions.add(ses)
      }
      const snapshot = () =>
        win.webContents.executeJavaScript(
          'window.yunduoDesktop.backendSnapshot()',
        ) as Promise<BackendSnapshot>
      const waitFor = async (condition: () => Promise<boolean> | boolean, message: string) => {
        for (let attempt = 0; attempt < 400; attempt++) {
          if (await condition()) return
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(message)
      }
      const execute = async (action: 'close-store' | 'remove-store') => {
        const s = await snapshot()
        await win.webContents.executeJavaScript(
          `window.yunduoDesktop.backendExecute(${JSON.stringify({ action, storeId, values: { confirmed: true }, workspaceId: s.workspaceId })})`,
        )
      }
      const before = new Set((await snapshot()).stores.map((store) => store.id))
      app.on('session-created', onSession)
      try {
        await win.webContents.executeJavaScript(
          `document.querySelector('[aria-label="添加店铺"]').click()`,
        )
        await ready()
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-platform="pdd-web"]').click()`,
        )
        await waitFor(
          async () =>
            win.webContents.executeJavaScript(
              `!document.querySelector('.add-platform-dialog button[type="submit"]').disabled`,
            ),
          '选中平台后添加按钮未启用',
        )
        await win.webContents.executeJavaScript(
          `document.querySelector('.add-platform-dialog button[type="submit"]').click()`,
        )
        await waitFor(async () => {
          const added = (await snapshot()).stores.find((store) => !before.has(store.id))
          storeId = added?.id || ''
          return Boolean(added?.runtime.open)
        }, '添加后没有打开平台店铺')
        const store = (await snapshot()).stores.find((row) => row.id === storeId)
        assert.equal(store?.platform, 'pdd-web')
        assert.equal(store?.aiEnabled, false)
        await waitFor(
          async () =>
            win.webContents.executeJavaScript(
              `!Array.from(document.querySelectorAll('.add-platform-dialog')).some(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height)`,
            ),
          '添加后弹窗未收起',
        )
        assert.equal(
          await win.webContents.executeJavaScript(
            `Boolean(document.querySelector('.shop-setup-page'))`,
          ),
          false,
          '登录完成前不能显示新手引导',
        )
        const view = win.contentView.children.find(
          (child) => child instanceof WebContentsView && child.webContents !== win.webContents,
        )
        assert.ok(view instanceof WebContentsView, '登录 WebContentsView 未建立')
        // 当前 Electron View 没有可见性 getter；平台呈现器只在显示时赋予这组布局尺寸。
        await waitFor(
          () => view.getBounds().width > 0 && view.getBounds().height > 0,
          '登录视图未铺排',
        )
        assert.equal(view.getBounds().x, 300)
        assert.equal(view.getBounds().y, 72)
        assert.ok(view.webContents.getURL().startsWith('https://'), '平台入口地址未加载')
        assert.ok(
          (await view.webContents.executeJavaScript('document.body.innerText')).includes(
            '离线平台登录夹具',
          ),
          '应显示本机拦截的登录内容',
        )
        assert.ok(sessions.size > 0, '必须实际拦截独立店铺分区')
        await view.webContents.executeJavaScript(
          `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
        )
        fs.writeFileSync(
          path.join(output, 'add-store-login-view.png'),
          (await view.webContents.capturePage()).toPNG(),
        )
        fs.writeFileSync(
          path.join(output, 'add-store-direct-login.png'),
          (await win.capturePage()).toPNG(),
        )
      } finally {
        app.removeListener('session-created', onSession)
        if (!storeId)
          storeId = (await snapshot()).stores.find((store) => !before.has(store.id))?.id || ''
        try {
          if (storeId) {
            await execute('close-store')
            await execute('remove-store')
          }
        } finally {
          for (const ses of sessions) ses.protocol.unhandle('https')
        }
      }
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
    await genericPhraseChecks({ win, load, check })
    await simpleLoginChecks({ win, load, check })
    await businessChecks({
      win,
      dataDir,
      check,
      load,
      restart: async () => {
        disposeBusiness()
        disposeFeatures()
        await runtime.dispose()
        runtime = createWorkspaceRuntime({
          factory: () => createLocalRuntime({ dataDir, getWindow: () => win }),
        })
        disposeBusiness = registerBusinessIpc(runtime)
        disposeFeatures = registerPlatformFeatureIpc({ runtime, authorize: requireAppFrame })
        await load('/settings')
      },
    })
    await managedChecks({
      win,
      dataDir,
      original: runtime,
      load,
      check,
      bind(next) {
        disposeBusiness()
        disposeFeatures()
        disposeBusiness = registerBusinessIpc(next)
        disposeFeatures = registerPlatformFeatureIpc({ runtime: next, authorize: requireAppFrame })
      },
    })
    await domSendChecks(check)
    await simChecks({ win, check, load })
    for (const name of selectedChecks) {
      if (!report.some((result) => result.name === name))
        report.push({ name, route: '', pass: false, error: '指定验收项不存在或未运行' })
    }
    const failure = report.some((result) => !result.pass)
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    dispose()
    disposeBusiness()
    disposeFeatures()
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
