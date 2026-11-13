import { BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { BackendResult, BackendSnapshot, CommandInput } from '../src/shared/contracts/backend'
import {
  SIM_PLATFORM_ID,
  SIM_PLATFORM_LABEL,
  type SimulatorActionResult,
  type SimulatorStatus,
} from '../src/shared/contracts/simulation'

type Check = (name: string, route: string, run: () => Promise<void>) => Promise<void>

interface PersonaRow {
  uid: string
  name: string
  unread: number
}

interface ThreadBody {
  messages: { from: string; content: string }[]
}

/**
 * 本机模拟店铺的端到端验收：添加店铺 → 打开模拟顾客页 → 顾客发消息进会话 → 人工确认回复。
 *
 * 全程只走真实链路（IPC、业务命令、采集监控、确认后的发送），不直接调用 SimHub，
 * 这样任何一处接线断开都会在这里失败，而不是被“模拟成功”掩盖。
 */
export async function simChecks(options: {
  win: BrowserWindow
  check: Check
  load: (route: string) => Promise<void>
}) {
  const { win, check, load } = options
  const evaluate = <T>(script: string) => win.webContents.executeJavaScript(script) as Promise<T>
  const simulatorStatus = () => evaluate<SimulatorStatus>('window.yunduoDesktop.simulatorStatus()')
  const openSimulatorPage = () =>
    evaluate<SimulatorActionResult>('window.yunduoDesktop.openSimulatorPage()')
  const snapshot = () => evaluate<BackendSnapshot>('window.yunduoDesktop.backendSnapshot()')
  const execute = async (command: CommandInput): Promise<BackendResult> => {
    const current = await snapshot()
    return evaluate<BackendResult>(
      `window.yunduoDesktop.backendExecute(${JSON.stringify({ ...command, values: command.values ?? {}, workspaceId: current.workspaceId })})`,
    )
  }
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (expression: string, note: string) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate<boolean>(expression)) return
      await delay(100)
    }
    throw new Error(`等待界面超时：${note}`)
  }
  const until = async <T>(
    probe: () => Promise<T>,
    accept: (value: T) => boolean,
    note: string,
  ): Promise<T> => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await probe()
      if (accept(value)) return value
      await delay(100)
    }
    throw new Error(`等待状态超时：${note}`)
  }
  const api = async <T>(path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await response.text()
    return { status: response.status, text, body: text ? (JSON.parse(text) as T) : ({} as T) }
  }
  let baseUrl = ''
  let pageUrl = ''
  let storeId = ''
  let buyerUid = ''

  await check('sim:closed-by-default', '/', async () => {
    const before = await simulatorStatus()
    assert.equal(before.running, false, '未打开前不得报告模拟顾客页已运行')
    assert.equal(before.port, 0)
    assert.equal(before.url, '')
  })

  await check('sim:add-store-from-dialog', '/', async () => {
    await load('/')
    await evaluate(`document.querySelector('[aria-label="添加店铺"]').click()`)
    await waitFor(
      `Boolean(document.querySelector('.el-dialog input[aria-label="店铺名称"]'))`,
      '添加店铺弹窗未出现',
    )
    await evaluate(`document.querySelector('.el-dialog [aria-label="店铺平台"]').click()`)
    await waitFor(
      `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(item => item.textContent.includes(${JSON.stringify(SIM_PLATFORM_LABEL)}))`,
      '平台下拉里没有本机模拟店铺',
    )
    await evaluate(
      `(() => {const item = Array.from(document.querySelectorAll('.el-select-dropdown__item')).find(node => node.textContent.includes(${JSON.stringify(SIM_PLATFORM_LABEL)})); if(!item) throw Error('平台选项缺失'); item.click()})()`,
    )
    await waitFor(
      `document.body.innerText.includes('只在本机运行')`,
      '选择本机模拟店铺后没有出现诚实说明',
    )
    await evaluate(
      `(() => {const input = document.querySelector('.el-dialog input[aria-label="店铺名称"]'); if(!input) throw Error('店铺名称输入框缺失'); input.value='本机演练店'; input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    // 弹窗里选中“本机模拟店铺”的样子要留证据：这是用户新加的入口，不能只在报告里写字符串。
    // 只截弹窗矩形并等动画结束，避免把工作台悬浮卡片一起截进来当成交付截图。
    await delay(400)
    const dialogRect = await evaluate<{ x: number; y: number; width: number; height: number }>(
      `(() => {const dialog = document.querySelector('.el-dialog'); if(!dialog) throw Error('添加店铺弹窗缺失'); const box = dialog.getBoundingClientRect(); return {x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height)}})()`,
    )
    fs.mkdirSync(path.resolve('artifacts', 'desktop'), { recursive: true })
    fs.writeFileSync(
      path.resolve('artifacts', 'desktop', 'sim-add-store-dialog.png'),
      (await win.webContents.capturePage(dialogRect)).toPNG(),
    )
    await evaluate(`document.querySelector('.el-dialog form button[type="submit"]').click()`)
    const added = await until(
      snapshot,
      (value) => value.stores.some((store) => store.platform === SIM_PLATFORM_ID),
      '本机模拟店铺未出现在快照里',
    )
    const simStore = added.stores.find((store) => store.platform === SIM_PLATFORM_ID)
    assert.ok(simStore)
    assert.equal(simStore.storeName, '本机演练店')
    // 添加不等于已打开：模拟店铺也必须显式打开后才有采集。
    assert.equal(simStore.runtime.open, false)
    storeId = simStore.id
  })

  await check('sim:open-page-and-token-gates', '/', async () => {
    const opened = await openSimulatorPage()
    assert.equal(opened.ok, true, opened.message)
    const running = await simulatorStatus()
    assert.equal(running.running, true)
    assert.ok(running.port > 0, '端口没有真正监听')
    pageUrl = running.url
    assert.ok(pageUrl.startsWith(`http://127.0.0.1:${running.port}/`), pageUrl)
    const token = new URL(pageUrl).searchParams.get('token') ?? ''
    assert.ok(token.length >= 20, '缺少一次性口令')
    baseUrl = `http://127.0.0.1:${running.port}`

    const page = await fetch(pageUrl)
    assert.equal(page.status, 200)
    assert.match(String(page.headers.get('content-security-policy')), /default-src 'none'/)
    const html = await page.text()
    // 页面必须自己说清这是本机模拟，不能让用户以为连的是真实平台。
    assert.ok(html.includes('本机模拟'), '页面缺少本机模拟标注')
    assert.ok(html.includes('不代表真实平台'), '页面缺少不冒充真实平台的声明')
    assert.equal((await fetch(`${baseUrl}/`)).status, 403)
    assert.equal((await fetch(`${baseUrl}/api/stores`)).status, 401)
    assert.equal((await fetch(`${baseUrl}/api/stores?token=${'x'.repeat(24)}`)).status, 401)

    const stores = await api<{ stores: { storeId: string; storeName: string }[] }>(
      `/api/stores?token=${token}`,
    )
    assert.deepEqual(stores.body.stores, [{ storeId, storeName: '本机演练店' }])
  })

  await check('sim:customer-message-reaches-conversation', '/', async () => {
    const token = new URL(pageUrl).searchParams.get('token') ?? ''
    const state = await api<{ personas: PersonaRow[] }>(
      `/api/state?token=${token}&storeId=${storeId}`,
    )
    assert.equal(state.status, 200)
    assert.equal(state.body.personas.length, 3, '新店铺应有三个默认模拟顾客')
    buyerUid = state.body.personas[0]!.uid
    const sent = await api(`/api/send?token=${token}`, {
      method: 'POST',
      body: { storeId, uid: buyerUid, text: '你好，这件卫衣有 L 码吗？', as: 'buyer' },
    })
    assert.equal(sent.status, 200)
    // 采集监控器按间隔拉取，消息要真的进到供应商会话里才算接通。
    const reached = await until(
      snapshot,
      (value) =>
        value.conversations.some(
          (conversation) => conversation.storeId === storeId && conversation.uid === buyerUid,
        ),
      '模拟顾客消息没有进入会话列表',
    )
    const target = reached.conversations.find(
      (conversation) => conversation.storeId === storeId && conversation.uid === buyerUid,
    )
    assert.ok(target)
    assert.equal(target.messages.at(-1)?.content, '你好，这件卫衣有 L 码吗？')
    assert.equal(target.messages.at(-1)?.from, 'buyer')
  })

  await check('sim:manual-reply-after-approval', '/', async () => {
    await execute({ action: 'select-conversation', storeId, conversationId: buyerUid })
    const reply = await execute({
      action: 'send-reply',
      storeId,
      conversationId: buyerUid,
      values: { reply: '有 L 码的，今天下单今天发出。' },
    })
    assert.equal(reply.status, 'ok')
    assert.equal(reply.data.confirmed, true)
    const token = new URL(pageUrl).searchParams.get('token') ?? ''
    const thread = await api<ThreadBody>(
      `/api/thread?token=${token}&storeId=${storeId}&uid=${buyerUid}`,
    )
    assert.equal(thread.body.messages.at(-1)?.from, 'seller')
    assert.equal(thread.body.messages.at(-1)?.content, '有 L 码的，今天下单今天发出。')
    // 顾客页只代表“本机收到”，回复必须写明这一点，不能宣称真实平台已送达。
    assert.ok(reply.message.includes('回复已发送'))
  })

  await check('sim:closed-store-refuses-reply', '/', async () => {
    await execute({ action: 'close-store', storeId })
    await assert.rejects(
      () =>
        execute({
          action: 'send-reply',
          storeId,
          conversationId: buyerUid,
          values: { reply: '关店后不该发出去' },
        }),
      /店铺未连接/,
    )
    await execute({ action: 'open-store', storeId })
    const reopened = await simulatorStatus()
    assert.equal(reopened.running, true)
  })

  await check('sim:console-page-shows-store', '/sim', async () => {
    await load('/sim')
    await waitFor(
      `document.body.innerText.includes('本机演练店')`,
      '模拟客服台没有显示本机模拟店铺',
    )
    // 选中刚有消息的模拟会话：截图要能证明“顾客消息进到了真实会话列表”，空状态截图不算证据。
    await evaluate(
      `(() => {const list = document.querySelector('[aria-label="会话列表"]'); const item = list && list.querySelector('button.runtime-entry'); if (!item) throw Error('模拟会话列表里没有会话'); item.click()})()`,
    )
    // 会话摘要列表里也含同样的文字，所以必须在聊天记录区域里核对，避免拿左侧摘要冒充已打开会话。
    await waitFor(
      `(() => {const log = document.querySelector('[aria-label="模拟会话消息"]'); return Boolean(log && log.innerText.includes('你好，这件卫衣有 L 码吗？') && log.innerText.includes('有 L 码的，今天下单今天发出。'))})()`,
      '模拟客服台没有显示顾客消息与已确认的回复',
    )
    const output = path.resolve('artifacts', 'desktop')
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'sim-console-ready.png'), (await win.capturePage()).toPNG())
  })

  await check('sim:sidebar-entry-opens-console', '/shop/manage?panel=sim', async () => {
    // 侧栏入口走的是 /shop/manage?panel=sim，与 /sim 是两条独立路径，两条都要能用。
    await load('/shop/manage?panel=sim')
    await waitFor(
      `Boolean(document.querySelector('[aria-label="模拟店铺操作"]'))`,
      '侧栏入口没有打开模拟客服台',
    )
    await waitFor(
      `document.body.innerText.includes('本机演练店')`,
      '侧栏打开的模拟客服台没有显示本机模拟店铺',
    )
  })

  await check('sim:customer-page-screenshot', '/sim', async () => {
    const output = path.resolve('artifacts', 'desktop')
    fs.mkdirSync(output, { recursive: true })
    const view = new BrowserWindow({
      show: false,
      width: 1120,
      height: 780,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    try {
      await view.loadURL(pageUrl)
      // 页面是客户端渲染：必须等默认顾客与刚才那条会话真的画出来再截图，
      // 否则截到的是“加载中/空列表”，不能当成交付证据。
      const waitInPage = async (expression: string, note: string) => {
        for (let attempt = 0; attempt < 120; attempt++) {
          const ok = await view.webContents.executeJavaScript(`Boolean(${expression})`)
          if (ok) return
          await delay(100)
        }
        throw new Error(`等待模拟顾客页超时：${note}`)
      }
      await waitInPage(`document.body.innerText.includes('小雨')`, '页面没有显示默认模拟顾客')
      await waitInPage(
        `document.body.innerText.includes('你好，这件卫衣有 L 码吗？')`,
        '页面没有显示顾客发来的消息',
      )
      await delay(200)
      fs.writeFileSync(
        path.join(output, 'sim-customer-page.png'),
        (await view.capturePage()).toPNG(),
      )
    } finally {
      view.destroy()
    }
  })
}
