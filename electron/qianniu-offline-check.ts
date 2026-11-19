import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow } from 'electron'
import type { BackendResult, BackendSnapshot, CommandInput } from '../src/shared/contracts/backend'
import type { ReplyReview } from '../src/shared/contracts/review'
import { SIM_PLATFORM_ID } from '../src/shared/contracts/simulation'
import { registerBusinessIpc } from './business-ipc'
import { registerDesktopIpc } from './ipc'
import { createLocalRuntime } from './local-runtime'
import { createQianniuOfflineFixture } from './qianniu-offline-fixture'
import { createWindow, loadRenderer } from './windows'

const [isolatedRoot = '', deliveryDir = '', output = ''] = process.argv.slice(2)
const question = '【离线演练】这款卫衣有 L 码吗？'
const reply = '【模拟模型】您好，请以演练商品页面的尺码选项为准。'
const modelName = 'qianniu-offline-fixture'
const checks: string[] = []
let stage = '初始化'

async function until<Value>(probe: () => Promise<Value | undefined>, note: string): Promise<Value> {
  const deadline = Date.now() + 18000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await delay(100)
  }
  throw Error(`等待超时：${note}`)
}

async function startModel() {
  const calls: string[] = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (body.length > 150000) {
          response.writeHead(413).end()
          return
        }
      }
      const input = JSON.parse(body) as { model?: unknown; messages?: unknown }
      assert.equal(input.model, modelName)
      assert.ok(Array.isArray(input.messages))
      calls.push(JSON.stringify(input.messages))
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply }) } }] }))
    } catch {
      response.writeHead(400).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    calls,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

async function click(win: BrowserWindow, button: string, container = 'body') {
  const selector = JSON.stringify(container)
  const label = JSON.stringify(button)
  const find = `[...document.querySelectorAll(${selector})].flatMap(node =>
    [...node.querySelectorAll('button,[role="tab"]')]).find(node =>
      !node.disabled && node.getClientRects().length && node.textContent.trim() === ${label})`
  await until(async () => {
    const found = await win.webContents.executeJavaScript(`(() => {
      const item = ${find}
      if (!item) return false
      item.click()
      return true
    })()`)
    return found === true ? true : undefined
  }, button)
}

async function capture(win: BrowserWindow, filename: string) {
  // DOM assertions can pass before Chromium has painted the updated route or tab.
  await win.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))',
  )
  await delay(100)
  const image = await win.webContents.capturePage()
  assert.ok(!image.isEmpty(), '验收截图为空')
  await fs.writeFile(path.join(output, filename), image.toPNG())
}

async function run() {
  const window = createWindow()
  const fixture = await createQianniuOfflineFixture(deliveryDir)
  let model: Awaited<ReturnType<typeof startModel>> | undefined
  let runtime: ReturnType<typeof createLocalRuntime> | undefined
  let unregister = () => {}
  let unregisterDesktop = () => {}
  try {
    unregisterDesktop = registerDesktopIpc({ primary: () => window, runtime: () => runtime })
    model = await startModel()
    runtime = createLocalRuntime({
      dataDir: path.join(isolatedRoot, 'local-runtime'),
      getWindow: () => window,
      createSimulationAdapter: fixture.adapterFactory,
    })
    unregister = registerBusinessIpc(runtime)
    await runtime.start({ restoreAi: false })
    await loadRenderer(window, '/')
    window.show()
    const snapshot = (): Promise<BackendSnapshot> =>
      window.webContents.executeJavaScript('window.yunduoDesktop.backendSnapshot()')
    const workspaceId = (await snapshot()).workspaceId
    const execute = (input: CommandInput): Promise<BackendResult> =>
      window.webContents.executeJavaScript(
        `window.yunduoDesktop.backendExecute(${JSON.stringify({ values: {}, ...input, workspaceId })})`,
      )
    assert.ok(workspaceId)
    const initial = await snapshot()
    assert.equal(initial.stores.length, 0, '必须使用全新隔离资料目录')
    assert.equal(initial.capabilities.modelMode, 'local')
    assert.ok(!initial.capabilities.platforms.some((platform) => platform.id === 'qianniu'))
    await assert.rejects(
      execute({ action: 'add-store', values: { platform: 'qianniu' } }),
      /该平台尚未接入/,
    )
    const added = await execute({
      action: 'add-store',
      values: { platform: SIM_PLATFORM_ID, storeName: '千牛离线演练 · 非实店' },
    })
    assert.equal(typeof added.data.id, 'string')
    const storeId = String(added.data.id)
    await execute({ action: 'open-store', storeId })
    const [firstBuyer, cancelBuyer, noEchoBuyer] = fixture.buyers()
    assert.ok(firstBuyer && cancelBuyer && noEchoBuyer)
    const delivery = () => fixture.count('/textToSend')
    const conversation = (state: BackendSnapshot, uid: string) =>
      state.conversations.find((row) => row.storeId === storeId && row.uid === uid)
    const candidate = (uid: string, status: ReplyReview['status']) =>
      until(
        async () =>
          (await snapshot()).review.replies.find((row) => row.uid === uid && row.status === status),
        `${status}：${uid}`,
      )

    stage = 'AI 关闭时收件与去重'
    fixture.queueBuyer(firstBuyer.uid, question, { duplicate: true })
    const received = await until(async () => {
      const state = await snapshot()
      return fixture.count('/popPending') >= 2 && conversation(state, firstBuyer.uid)
        ? state
        : undefined
    }, 'SDK 模拟买家消息进入灵兔会话')
    assert.equal(received.stores[0]?.aiEnabled, false)
    assert.equal(received.stores[0]?.runtime.authenticated, undefined)
    assert.equal(conversation(received, firstBuyer.uid)?.messages.length, 1)
    assert.equal(conversation(received, firstBuyer.uid)?.messages[0]?.content, question)
    assert.equal(conversation(received, firstBuyer.uid)?.messages[0]?.from, 'buyer')
    assert.equal(received.review.logs.filter((row) => row.text === question).length, 1)
    assert.equal(model.calls.length, 0)
    assert.equal(delivery(), 0)
    checks.push(stage)

    stage = '模拟模型生成并等待人工确认'
    await execute({
      action: 'save-model-settings',
      values: { model: modelName, baseUrl: model.baseUrl },
    })
    await execute({ action: 'set-ai', storeId, values: { enabled: true } })
    const pending = await candidate(firstBuyer.uid, 'pending')
    assert.equal(pending.storeId, storeId)
    assert.equal(pending.sendMode, 'review')
    assert.equal(pending.text, reply)
    assert.equal(model.calls.length, 1)
    assert.ok(model.calls[0]?.includes(question), '正式模型的请求须包含 SDK 买家正文')
    assert.ok(
      (await snapshot()).review.traces.some(
        (trace) => trace.id === pending.traceId && trace.submittedAt,
      ),
      '须经真实模型准备和提交路径，不能直接制造候选',
    )
    const monitor = await until(async () => {
      const view = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().endsWith('#/reply-monitor'),
      )
      return view &&
        (await view.webContents.executeJavaScript('document.body.innerText')).includes(reply)
        ? view
        : undefined
    }, '回复监控显示真实待确认正文')
    await capture(monitor, '01-review-pending.png')
    assert.equal(delivery(), 0, '打开候选窗口不能触发发送')
    checks.push(stage)

    stage = '会话历史不可读时保留候选并拒绝发送'
    fixture.setHistoryAvailable(firstBuyer.uid, false)
    await assert.rejects(
      execute({ action: 'review-reply', values: { id: pending.id, approve: true } }),
      /暂时无法核对/,
    )
    assert.equal((await candidate(firstBuyer.uid, 'pending')).id, pending.id)
    assert.equal(delivery(), 0)
    fixture.setHistoryAvailable(firstBuyer.uid, true)
    checks.push(stage)

    stage = '确认、匹配模拟回显、拒绝重复确认'
    const historyReads = fixture.count('/chatHistory')
    await click(monitor, '确认发送')
    const sent = await candidate(firstBuyer.uid, 'sent')
    assert.equal(sent.id, pending.id)
    assert.ok(fixture.count('/chatHistory') > historyReads)
    assert.equal(delivery(), 1)
    assert.equal(fixture.count('/popOutbound'), 1)
    assert.equal(conversation(await snapshot(), firstBuyer.uid)?.messages.at(-1)?.content, reply)
    assert.equal(conversation(await snapshot(), firstBuyer.uid)?.messages.at(-1)?.from, 'seller')
    await assert.rejects(
      execute({ action: 'review-reply', values: { id: pending.id, approve: true } }),
      /不能重复发送/,
    )
    assert.equal(delivery(), 1)
    checks.push(stage)

    await loadRenderer(window, '/logs')
    const reviewCard = (id: string) => `[data-review-id="${id}"]`
    const waitForText = async (selector: string, text: string) =>
      until(async () => {
        const found = await window.webContents.executeJavaScript(
          `document.querySelector(${JSON.stringify(selector)})?.innerText.includes(${JSON.stringify(text)})`,
        )
        return found === true ? true : undefined
      }, text)
    await waitForText(reviewCard(sent.id), '本机模拟已收到回复')
    await capture(window, '02-mock-delivered.png')

    stage = '没有回显时不标成功且不重发'
    fixture.queueBuyer(noEchoBuyer.uid, '【离线演练】请问有 M 码吗？', { muteEcho: true })
    const noEcho = await candidate(noEchoBuyer.uid, 'pending')
    assert.equal(delivery(), 1)
    await click(window, '确定发送这条消息', reviewCard(noEcho.id))
    await candidate(noEchoBuyer.uid, 'failed')
    await waitForText(reviewCard(noEcho.id), '请核对本机模拟记录')
    await capture(window, '03-missing-echo.png')
    await delay(2200)
    assert.equal(delivery(), 2, '无回显的请求不得自动再次发送')
    assert.ok(
      conversation(await snapshot(), noEchoBuyer.uid)?.messages.every(
        (row) => row.from === 'buyer',
      ),
    )
    checks.push(stage)

    // Cancellation can trigger the existing store-wide AI stop on the next queue tick.
    stage = '人工取消不发送'
    fixture.queueBuyer(cancelBuyer.uid, '【离线演练】请问有蓝色吗？')
    const toCancel = await candidate(cancelBuyer.uid, 'pending')
    assert.equal(toCancel.sendMode, 'review')
    assert.equal(delivery(), 2)
    await click(window, '取消，不发送', reviewCard(toCancel.id))
    await candidate(cancelBuyer.uid, 'rejected')
    await assert.rejects(
      execute({ action: 'review-reply', values: { id: toCancel.id, approve: true } }),
      /不能重复发送/,
    )
    await delay(1200)
    assert.equal(delivery(), 2)
    assert.ok(
      conversation(await snapshot(), cancelBuyer.uid)?.messages.every(
        (row) => row.from === 'buyer',
      ),
    )
    await waitForText(reviewCard(toCancel.id), '已取消')
    await capture(window, '04-review-canceled.png')
    checks.push(stage)

    await click(window, '消息与运行日志')
    await waitForText('[role="tab"][aria-selected="true"]', '消息与运行日志')
    await waitForText('#pane-logs', question)
    await capture(window, '05-message-log.png')
    assert.equal(model.calls.length, 3)
    return {
      sdkVersion: fixture.version,
      mode: '离线：合成店铺、测试买家、本机模型夹具',
      checks,
      modelCalls: model.calls.length,
      mockRequests: {
        receive: fixture.count('/popPending'),
        history: fixture.count('/chatHistory'),
        send: delivery(),
        echo: fixture.count('/popOutbound'),
      },
    }
  } finally {
    unregister()
    unregisterDesktop()
    try {
      await runtime?.dispose()
    } finally {
      if (!window.isDestroyed()) window.destroy()
      await Promise.all([fixture.dispose(), model?.dispose()])
    }
  }
}

async function main() {
  assert.ok(isolatedRoot && deliveryDir && output, '请通过离线验收脚本运行')
  const userData = path.join(isolatedRoot, 'electron')
  await fs.mkdir(userData)
  app.setPath('userData', userData)
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  await app.whenReady()
  try {
    const result = await run()
    checks.push('验收窗口及本机模拟服务正常释放')
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify({ pass: true, ...result }, null, 2),
    )
    console.log(`千牛离线验收：${checks.length}/${checks.length} 通过`)
    app.exit(0)
  } catch (error) {
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify({ pass: false, checks, stage, error: String(error) }, null, 2),
    )
    throw error
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
