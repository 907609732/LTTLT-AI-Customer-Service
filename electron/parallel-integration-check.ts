import { app, clipboard, ipcMain, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindow, rendererPath } from './windows'
import { createLocalRuntime, requireAppFrame, type LocalRuntime } from './local-runtime'
import { createWorkspaceRuntime } from './workspace-runtime'
import { registerBusinessIpc } from './business-ipc'
import { registerPlatformFeatureIpc } from './platform-feature-ipc'
import { registerDesktopIpc } from './ipc'
import { registerCustomPhrasesIpc } from './custom-phrases-ipc'
import { registerStoreSyncIpc } from './store-sync-ipc'
import { registerSchedulerIpc } from './scheduler-ipc'
import type { PhraseLibrary } from '../src/shared/customer-service/custom-phrases'
import type { BackendResult, CommandInput } from '../src/shared/contracts/backend'

// Deliberately two separate Electron processes: the second must recover real files from the first.
const root = process.env.LINGTU_PARALLEL_CHECK_DIR
if (!root || !path.isAbsolute(root)) throw Error('需提供隔离验证目录')
const output = path.resolve('artifacts/parallel-integration')
fs.mkdirSync(root, { recursive: true })
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', root)
const phase = app.commandLine.getSwitchValue('parallel-phase') || 'setup'
const checks: string[] = []
let win: BrowserWindow
let runtime: LocalRuntime
let off: (() => void)[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const evaluate = <T>(script: string) => win.webContents.executeJavaScript(script) as Promise<T>
async function wait(script: string) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate<boolean>(script)) return
    await delay(100)
  }
  throw Error(`等待界面超时：${script}`)
}
async function click(text: string, selector = 'button') {
  const expression = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(n=>n.textContent.trim()===${JSON.stringify(text)} && !n.matches(':disabled') && n.getClientRects().length)`
  await wait(`Boolean(${expression})`)
  await evaluate(`(${expression}).click()`)
  await delay(120)
}
async function input(selector: string, value: string) {
  await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
  await evaluate(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  )
}
async function screenshot(name: string) {
  await delay(250)
  fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
}
async function load(route: string) {
  const url = pathToFileURL(rendererPath)
  url.searchParams.set('parallel', `${phase}-${Date.now()}`)
  url.hash = route
  await win.loadURL(url.href)
  await wait(
    'Boolean(window.yunduoDesktop?.backendSnapshot) && document.querySelectorAll("#app *").length>20',
  )
  await delay(300)
}
async function execute(command: CommandInput): Promise<BackendResult> {
  return runtime.execute({
    ...command,
    values: command.values ?? {},
    workspaceId: runtime.snapshot().workspaceId,
  })
}
async function openPhrases() {
  await load('/')
  await click('快捷回复', '.sidebar-footer button')
  await click('我的店铺话术')
  await wait(
    'Boolean(document.querySelector("[data-testid=custom-phrases]")) && !document.querySelector("[data-testid=custom-phrases] [role=status]")',
  )
}
async function selectPhraseStore(name: string) {
  await evaluate(`document.querySelector('[aria-label="自定义话术店铺"]').click()`)
  await click(name, '.el-select-dropdown__item')
  await delay(250)
  await wait('!document.querySelector("[data-testid=custom-phrases] [role=status]")')
}
async function library(storeId: string): Promise<PhraseLibrary> {
  return evaluate(
    `window.yunduoDesktop.customPhrases.list(${JSON.stringify({ workspaceId: runtime.snapshot().workspaceId, storeId })})`,
  )
}
async function upload(file: string) {
  const debuggerApi = win.webContents.debugger
  debuggerApi.attach('1.3')
  try {
    const { root: document } = (await debuggerApi.sendCommand('DOM.getDocument')) as {
      root: { nodeId: number }
    }
    const { nodeId } = (await debuggerApi.sendCommand('DOM.querySelector', {
      nodeId: document.nodeId,
      selector: 'input[aria-label="选择话术JSON文件"]',
    })) as { nodeId: number }
    assert.ok(nodeId)
    await debuggerApi.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] })
  } finally {
    debuggerApi.detach()
  }
}

app
  .whenReady()
  .then(async () => {
    win = createWindow({ smoke: true })
    win.webContents.on('render-process-gone', (_event, details) =>
      console.error('render-process-gone', details),
    )
    win.webContents.on('preload-error', (_event, file, error) =>
      console.error('preload-error', file, String(error)),
    )
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) console.error('renderer-console', message)
    })
    if (phase === 'restart') {
      const meta = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8')) as {
        a: string
      }
      fs.writeFileSync(
        path.join(root, 'business', 'conversations.json'),
        JSON.stringify([
          {
            storeId: meta.a,
            uid: 'parallel-buyer',
            name: '隔离顾客',
            status: 'pending',
            messages: [
              { from: 'buyer', content: '本机归档测试，不连接平台', ts: Date.now() - 1000 },
            ],
          },
        ]),
      )
    }
    runtime = createWorkspaceRuntime({
      factory: () =>
        createLocalRuntime({ dataDir: path.join(root, 'business'), getWindow: () => win }),
    })
    off = [
      registerDesktopIpc(),
      registerBusinessIpc(runtime),
      registerPlatformFeatureIpc({ runtime, authorize: requireAppFrame }),
      registerCustomPhrasesIpc(runtime, () => path.join(runtime.dataDirectory(), 'custom-phrases')),
      registerStoreSyncIpc({
        ipcMain,
        authorize: requireAppFrame,
        resolveCurrent: () => ({
          workspaceId: runtime.snapshot().workspaceId,
          service: runtime.storeSync(),
        }),
      }),
      registerSchedulerIpc({ requireAppFrame, resolveCurrent: () => runtime.scheduler() }),
    ]
    await runtime.start()
    if (phase === 'setup') {
      const a = String(
        (
          await execute({
            action: 'add-store',
            values: { platform: 'sim-local', storeName: '并行验收甲店' },
          })
        ).data.id,
      )
      const b = String(
        (
          await execute({
            action: 'add-store',
            values: { platform: 'sim-local', storeName: '并行验收乙店' },
          })
        ).data.id,
      )
      fs.writeFileSync(
        path.join(root, 'fixture.json'),
        JSON.stringify({ a, b, workspaceId: runtime.snapshot().workspaceId }),
      )
      await openPhrases()
      await click('新建话术')
      await input('input[aria-label="话术标题"]', '桌面持久化验收')
      await input('input[aria-label="话术场景"]', '隔离测试')
      await input('textarea[aria-label="话术正文"]', '您好，这是隔离测试话术，不向买家发送。')
      await click('保存话术')
      await wait('document.querySelectorAll(".custom-row").length===1')
      await click('编辑', '.custom-row button')
      const reply = '重启、店铺隔离、复制及文件导入导出验收。'
      await input('textarea[aria-label="话术正文"]', reply)
      await click('保存话术')
      await wait(`document.querySelector('.custom-reply')?.textContent===${JSON.stringify(reply)}`)
      assert.equal((await library(a)).rows[0]?.reply, reply)
      checks.push('真实Vue/preload/IPC创建编辑并保存')
      await click('复制话术', '.custom-row button')
      assert.equal(clipboard.readText(), reply)
      checks.push('实际系统剪贴板内容一致')
      const exported = path.join(output, 'custom-phrases-export.json')
      const downloaded = new Promise<void>((resolve, reject) => {
        win.webContents.session.once('will-download', (_event, item) => {
          item.setSavePath(exported)
          item.once('done', (_event, state) =>
            state === 'completed' ? resolve() : reject(Error(`下载失败:${state}`)),
          )
        })
        setTimeout(() => reject(Error('下载超时')), 15000).unref()
      })
      await click('导出 JSON')
      await downloaded
      assert.equal(JSON.parse(fs.readFileSync(exported, 'utf8')).phrases[0].reply, reply)
      checks.push('实际JSON文件下载与内容验证')
      await screenshot('phrases-store-a')
      await selectPhraseStore('并行验收乙店')
      assert.equal((await library(b)).rows.length, 0)
      await wait('document.querySelectorAll(".custom-row").length===0')
      checks.push('甲乙店话术隔离')
      await click('导入 JSON')
      await upload(exported)
      await wait(
        'document.querySelector("[data-testid=custom-phrases]").innerText.includes("待导入 1 条")',
      )
      await click('确认追加导入')
      await wait('document.querySelectorAll(".custom-row").length===1')
      await click('导入 JSON')
      await upload(exported)
      await wait(
        'document.querySelector("[data-testid=custom-phrases]").innerText.includes("待导入 1 条")',
      )
      await click('确认追加导入')
      await wait('document.querySelectorAll(".custom-row").length===1')
      assert.equal((await library(b)).rows.length, 1)
      checks.push('从真实文件导入到乙店与重复导入去重')
      const invalid = path.join(output, 'invalid-phrases.json')
      fs.writeFileSync(invalid, '{invalid json')
      await click('导入 JSON')
      await upload(invalid)
      await wait(
        'document.querySelector("[data-testid=custom-phrases]").innerText.includes("JSON 格式错误")',
      )
      assert.equal((await library(b)).rows.length, 1)
      assert.equal(
        await evaluate<boolean>(
          'Array.from(document.querySelectorAll("button")).find(n=>n.textContent.trim()==="确认追加导入").disabled',
        ),
        true,
      )
      checks.push('错误文件禁止导入且旧数据保持')
      await screenshot('phrases-import-validation')
      await execute({
        action: 'save-product',
        storeId: a,
        values: {
          productId: 'parallel-sku',
          title: '隔离商品',
          description: '同步前资料',
          specifications: 'M号',
          price: '',
          enabled: true,
        },
      })
      await load('/store-sync')
      await evaluate(
        `(()=>{const n=document.querySelector('select[aria-label="源店铺"]');n.value=${JSON.stringify(a)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      )
      await evaluate(
        `document.querySelector('input[type=checkbox][value=${JSON.stringify(b)}]').click()`,
      )
      await input('textarea[aria-label="源店商品编号"]', 'parallel-sku')
      await click('预览变更')
      await wait('Boolean(document.querySelector("[aria-label=同步预览]"))')
      await evaluate(
        `document.querySelector('[aria-label="同步预览"] input[type=checkbox]').click()`,
      )
      await click('备份并执行同步')
      await wait('document.body.innerText.includes("同步完成")')
      assert.equal(
        (await execute({ action: 'list-products', storeId: b, values: { offset: 0, limit: 10 } }))
          .data.total,
        1,
      )
      checks.push('跨店同步真实页面预览、确认、上游持久化')
      await screenshot('store-sync-complete')
    } else if (phase === 'restart') {
      const meta = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8')) as {
        a: string
        b: string
        workspaceId: string
      }
      assert.notEqual(runtime.snapshot().workspaceId, meta.workspaceId)
      await openPhrases()
      assert.equal(
        (await library(meta.a)).rows[0]?.reply,
        '重启、店铺隔离、复制及文件导入导出验收。',
      )
      await wait('document.querySelectorAll(".custom-row").length===1')
      await selectPhraseStore('并行验收乙店')
      assert.equal((await library(meta.b)).rows.length, 1)
      checks.push('完整进程退出重启后两店话术仍保留')
      await screenshot('phrases-after-process-restart')
      await assert.rejects(
        evaluate(
          `window.yunduoDesktop.customPhrases.list(${JSON.stringify({ workspaceId: meta.workspaceId, storeId: meta.a })})`,
        ),
        /工作区/,
      )
      checks.push('旧工作区ID请求被拒绝')
      await load('/store-sync')
      await wait('document.body.innerText.includes("同步完成")')
      const backups = runtime.storeSync().backups()
      assert.equal(backups.length, 1)
      const rollback = await runtime
        .storeSync()
        .rollback({ backupId: backups[0].backupId, confirmed: true })
      assert.equal(rollback.status, 'rolled-back')
      assert.equal(
        (
          await execute({
            action: 'list-products',
            storeId: meta.b,
            values: { offset: 0, limit: 10 },
          })
        ).data.total,
        0,
      )
      checks.push('同步备份跨进程恢复与目标回滚')
      await execute({ action: 'select-store', storeId: meta.a })
      for (let n = 0; n < 30; n++) {
        await execute({
          action: 'save-product',
          storeId: meta.a,
          values: {
            productId: `ui-check-${n}`,
            title: `隔离跨页验收${n}`,
            description: '本机合成验收，不连接平台',
            specifications: 'M',
            price: '14.9',
            enabled: n % 2 === 0,
          },
        })
      }
      const catalogResult = await execute({
        action: 'list-products',
        storeId: meta.a,
        values: { offset: 0, limit: 20 },
      })
      assert.equal(
        typeof catalogResult.data.codesRevision,
        'number',
        '公共商品入口必须装配目录扩展',
      )
      await load('/shop/manage?panel=goods')
      await wait('document.querySelectorAll(".goods-table .el-table__row").length===20')
      assert.equal(
        await evaluate('document.querySelectorAll(".goods-knowledge .el-table").length'),
        1,
      )
      await screenshot('product-knowledge-list')
      await input('input[aria-label="商品名称或平台编号"]', '隔离跨页验收29')
      await click('查询', '[data-goods-query] button')
      await wait(
        'document.querySelectorAll(".goods-table .el-table__row").length===1 && document.querySelector(".goods-table")?.innerText.includes("ui-check-29")',
      )
      await evaluate('document.querySelector("[data-product-code]").click()')
      await input('input[aria-label="商家编码 ui-check-29"]', 'UI-CODE-29')
      await evaluate('document.querySelector("[data-save-codes]").click()')
      await wait('document.querySelector(".goods-table")?.innerText.includes("UI-CODE-29")')
      await load('/shop/manage?panel=goods')
      await input('input[aria-label="商家编码筛选"]', 'UI-CODE-29')
      await click('查询', '[data-goods-query] button')
      await wait(
        'document.querySelectorAll(".goods-table .el-table__row").length===1 && document.querySelector(".goods-table")?.innerText.includes("UI-CODE-29")',
      )
      checks.push('单店商品页无重复店铺表、全店跨页搜索、真实编码保存及重载筛选')
      await screenshot('product-knowledge-code-persisted')
      for (const panel of ['kb', 'intent-doc', 'team', 'workorder', 'home']) {
        await load(`/shop/manage?panel=${panel}`)
        assert.deepEqual(await evaluate('window.__vueErrors || []'), [])
        await screenshot(`panel-${panel}`)
      }
      await load('/shop/recharge')
      assert.deepEqual(await evaluate('window.__vueErrors || []'), [])
      await screenshot('billing-local-unavailable')
      checks.push('知识、团队、工单、报表和充值入口无Vue异常')
      const scheduler = await evaluate<{ workspaceId: string }>(
        `window.yunduoDesktop.schedulerSnapshot(${JSON.stringify(runtime.snapshot().workspaceId)})`,
      )
      assert.equal(scheduler.workspaceId, runtime.snapshot().workspaceId)
      await assert.rejects(evaluate('window.yunduoDesktop.schedulerSnapshot("old")'), /工作区/)
      checks.push('调度真实IPC工作区校验')
      const currentWorkspace = runtime.snapshot().workspaceId
      assert.equal(
        (
          await evaluate<{ workspaceId: string }>(
            `window.yunduoDesktop.platformLearning.snapshot({workspaceId:${JSON.stringify(currentWorkspace)}})`,
          )
        ).workspaceId,
        currentWorkspace,
      )
      assert.equal(
        (
          await evaluate<{ workspaceId: string }>(
            `window.yunduoDesktop.receptionSnapshot(${JSON.stringify(currentWorkspace)})`,
          )
        ).workspaceId,
        currentWorkspace,
      )
      await assert.rejects(
        evaluate(
          'window.yunduoDesktop.platformLearning.snapshot({workspaceId:"00000000-0000-4000-8000-000000000000"})',
        ),
        /工作区/,
      )
      checks.push('平台学习及接待真实preload/IPC读取与旧工作区拒绝')
      // A simulated store has no native buyer facts. Seed a durable synthetic task through its
      // actual IPC instead of fabricating selectable native customers in the updated form.
      await evaluate(
        `window.yunduoDesktop.schedulerExecute(${JSON.stringify({ type: 'save', workspaceId: currentWorkspace, task: { name: '跨进程调度验收', storeId: meta.a, uid: 'parallel-buyer', enabled: false, action: { kind: 'welcome-text', text: '隔离待确认文字，禁止真实发送' }, schedule: { type: 'once', at: Date.now() + 3 * 86400000 } } })})`,
      )
      await load('/')
      await click('定时任务', '.sidebar-footer button')
      await wait(
        'document.querySelector(".scheduled-tasks-dialog")?.innerText.includes("跨进程调度验收")',
      )
      assert.equal(runtime.scheduler().snapshot().tasks.length, 1)
      await click('启用', '.scheduled-tasks-dialog .task-entry button')
      await wait('document.querySelector(".scheduled-tasks-dialog")?.innerText.includes("下次")')
      await click('停用', '.scheduled-tasks-dialog .task-entry button')
      await wait('document.querySelector(".scheduled-tasks-dialog")?.innerText.includes("已停用")')
      assert.equal(runtime.scheduler().snapshot().tasks[0]?.enabled, false)
      await click('启用', '.scheduled-tasks-dialog .task-entry button')
      await wait('document.querySelector(".scheduled-tasks-dialog")?.innerText.includes("下次")')
      runtime.scheduler().tick(Date.now() + 4 * 86400000)
      assert.equal(runtime.scheduler().snapshot().runs[0]?.state, 'blocked')
      assert.equal(
        runtime.snapshot().stores.every((store) => !store.aiEnabled),
        true,
      )
      await click('刷新', '.scheduled-tasks-dialog .st-toolbar button')
      await wait('document.querySelector(".scheduled-tasks-dialog")?.innerText.includes("未发送")')
      assert.equal(runtime.scheduler().snapshot().tasks[0]?.enabled, false)
      checks.push('真实调度IPC保存、界面启停、未接平台到期阻塞且不发送')
      await screenshot('scheduler-blocked-no-send')
    } else {
      await load('/')
      await click('定时任务', '.sidebar-footer button')
      await wait(
        'document.querySelector(".scheduled-tasks-dialog")?.innerText.includes("跨进程调度验收")',
      )
      assert.equal(runtime.scheduler().snapshot().tasks.length, 1)
      assert.equal(runtime.scheduler().snapshot().tasks[0]?.enabled, false)
      const restoredRun = runtime.scheduler().snapshot().runs[0]
      assert.equal(restoredRun?.state, 'invalidated')
      assert.match(restoredRun?.reason ?? '', /服务关闭|重启/)
      assert.equal(restoredRun?.approvalId, undefined)
      checks.push('第三独立进程恢复调度任务及记录，旧事项失效且未恢复批准')
      await screenshot('scheduler-after-process-restart')
    }
    assert.deepEqual(await evaluate('window.__vueErrors || []'), [])
    fs.writeFileSync(
      path.join(output, `${phase}-report.json`),
      JSON.stringify(
        {
          pass: true,
          phase,
          electron: process.versions.electron,
          checks,
          realBuyerSends: 0,
          payments: 0,
        },
        null,
        2,
      ),
    )
    console.log(JSON.stringify({ phase, pass: true, checks }))
    for (const dispose of off.reverse()) dispose()
    await runtime.dispose()
    win.destroy()
    app.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error(error)
    fs.writeFileSync(
      path.join(output, `${phase}-failure.json`),
      JSON.stringify({ phase, checks, error: String(error) }, null, 2),
    )
    if (win && !win.isDestroyed()) await screenshot(`${phase}-failure`).catch(() => {})
    for (const dispose of off.reverse()) {
      try {
        dispose()
      } catch {
        /* Preserve original failure. */
      }
    }
    if (runtime) await runtime.dispose().catch(() => {})
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(1)
  })
