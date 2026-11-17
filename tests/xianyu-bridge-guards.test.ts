import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const source = readFileSync('vendor/xianyu-bridge/bridge.js', 'utf8')

interface Page {
  window: Window & typeof globalThis
}
// Reuse the installed test environment's jsdom; only these page APIs are needed.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => Page
}

const pages: Page[] = []
afterEach(() => {
  for (const page of pages.splice(0)) page.window.close()
})

interface Reply {
  kind: string
  id?: number
  ok?: boolean
  data?: string
  err?: string
}

interface BridgeWindow extends Window {
  ipc?: { postMessage(raw: string): void }
}

const READ_ARGS = {
  conversationActive: '.conv.active',
  conversationNick: '.nick',
  paneNick: '.pane-nick',
  input: '.input',
}

const BASE_HTML = `
  <div class="pane-nick">买家A</div>
  <div class="conv active"><span class="nick">买家A</span></div>
  <textarea class="input"></textarea>
  <div class="sendbox"><button type="button">发送</button></div>
`

function fixture(extraHtml = '') {
  const page = new JSDOM(`<!doctype html><html><body>${BASE_HTML}${extraHtml}</body></html>`, {
    url: 'https://www.goofish.com/im',
    runScripts: 'outside-only',
  })
  pages.push(page)
  const { window } = page
  const replies: Reply[] = []
  Object.assign(window, {
    ipc: {
      postMessage(raw: string) {
        replies.push(JSON.parse(raw) as Reply)
      },
    },
  })
  window.eval(source)
  let nextId = 1
  function call(op: string, args: Record<string, unknown> = {}): Reply {
    const id = nextId++
    const bridge = Reflect.get(window, '__shanhui') as { handle(raw: string): void }
    bridge.handle(JSON.stringify({ id, op, args }))
    const reply = replies.find((item) => item.kind === 'reply' && item.id === id)
    if (!reply) throw new Error(`页面没有回复 ${op}`)
    return reply
  }
  return { window, call }
}

function inputOf(window: BridgeWindow): HTMLTextAreaElement {
  return window.document.querySelector('.input') as HTMLTextAreaElement
}

function setBuyer(window: BridgeWindow, buyer: string): void {
  const pane = window.document.querySelector('.pane-nick')
  const nick = window.document.querySelector('.conv.active .nick')
  if (!pane || !nick) throw new Error('fixture 缺少买家节点')
  pane.textContent = buyer
  nick.textContent = buyer
}

function installImageApis(window: BridgeWindow): void {
  // jsdom has File but no DataTransfer/ClipboardEvent. The bridge only needs these
  // shapes to reach its paste dispatch; the real page supplies its own.
  class FakeDataTransfer {
    items = { add() {} }
    files: unknown[] = []
  }
  const PageEvent = Reflect.get(window, 'Event') as typeof Event
  class FakeClipboardEvent extends PageEvent {
    clipboardData: unknown
    constructor(
      type: string,
      init?: { clipboardData?: unknown; bubbles?: boolean; cancelable?: boolean },
    ) {
      super(type, init)
      this.clipboardData = init?.clipboardData
    }
  }
  Object.assign(window, { DataTransfer: FakeDataTransfer, ClipboardEvent: FakeClipboardEvent })
}

describe('闲鱼桥接页面同步校验', () => {
  it('买家已改变时 write 在写输入框之前中止', () => {
    const { window, call } = fixture()
    const reply = call('write', { ...READ_ARGS, text: 'AI 回复', expectedBuyer: '买家B' })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('当前买家')
    expect(inputOf(window).value).toBe('')
  })

  it('买家一致且唯一时 write 正常写入', () => {
    const { window, call } = fixture()
    const reply = call('write', { ...READ_ARGS, text: 'AI 回复', expectedBuyer: '买家A' })
    expect(reply.ok).toBe(true)
    expect(inputOf(window).value).toBe('AI 回复')
  })

  it('昵称相同但 avatar id 改变时 write 仍中止', () => {
    const { window, call } = fixture()
    setBuyer(window, '买家A#new-id')
    const reply = call('write', {
      ...READ_ARGS,
      text: 'AI 回复',
      expectedBuyer: '买家A',
      expectedBeforeText: '',
    })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('当前买家')
    expect(inputOf(window).value).toBe('')
  })

  it('商家在宿主读取后新敲的草稿不被 guarded write 覆盖', () => {
    const { window, call } = fixture()
    const input = inputOf(window)
    input.value = '人工草稿'
    const reply = call('write', {
      ...READ_ARGS,
      text: 'AI 回复',
      expectedBuyer: '买家A',
      expectedBeforeText: '',
    })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('原有正文')
    expect(input.value).toBe('人工草稿')
  })

  it('原有草稿未变时 guarded write 正常写入并保留内部空格校验', () => {
    const { window, call } = fixture()
    const input = inputOf(window)
    input.value = '你好  世界'
    const reply = call('write', {
      ...READ_ARGS,
      text: 'AI 回复',
      expectedBuyer: '买家A',
      expectedBeforeText: '你好  世界',
    })
    expect(reply.ok).toBe(true)
    expect(input.value).toBe('AI 回复')
  })

  it('带草稿校验时读不到文本必须失败，不能当成空串', () => {
    const { window, call } = fixture()
    const input = inputOf(window)
    Object.defineProperty(input, 'value', { configurable: true, get: () => undefined })
    const reply = call('write', {
      ...READ_ARGS,
      text: 'AI 回复',
      expectedBuyer: '买家A',
      expectedBeforeText: '',
    })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('无法读取输入框正文')
  })

  it('同名选中项不唯一时 write 也中止', () => {
    const { window, call } = fixture(
      '<div class="conv active"><span class="nick">买家A</span></div>',
    )
    const reply = call('write', { ...READ_ARGS, text: 'AI 回复', expectedBuyer: '买家A' })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('不唯一')
    expect(inputOf(window).value).toBe('')
  })

  it('草稿正文在点击前被改写时 commit 不点发送', () => {
    const { window, call } = fixture()
    const input = inputOf(window)
    input.value = '你好  世界'
    const button = window.document.querySelector('.sendbox button')
    if (!button) throw new Error('fixture 缺少发送按钮')
    let clicks = 0
    button.addEventListener('click', () => {
      clicks += 1
    })

    const reply = call('commit', {
      ...READ_ARGS,
      container: '.sendbox',
      buttonText: '发送',
      expectedBuyer: '买家A',
      expectedText: '你好  世界',
    })
    expect(reply.ok).toBe(true)
    expect(clicks).toBe(1)

    input.value = '你好 世界'
    const changed = call('commit', {
      ...READ_ARGS,
      container: '.sendbox',
      buttonText: '发送',
      expectedBuyer: '买家A',
      expectedText: '你好  世界',
    })
    expect(changed.ok).toBe(false)
    expect(changed.err).toContain('正文')
    expect(clicks).toBe(1)
  })

  it('买家在点击前改变时 commit 不点发送', () => {
    const { window, call } = fixture()
    inputOf(window).value = 'AI 回复'
    const button = window.document.querySelector('.sendbox button')
    if (!button) throw new Error('fixture 缺少发送按钮')
    let clicks = 0
    button.addEventListener('click', () => {
      clicks += 1
    })
    setBuyer(window, '买家B')
    const reply = call('commit', {
      ...READ_ARGS,
      container: '.sendbox',
      buttonText: '发送',
      expectedBuyer: '买家A',
      expectedText: 'AI 回复',
    })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('当前买家')
    expect(clicks).toBe(0)
  })

  it('不提供 expectedBuyer/expectedText 时保持旧行为', () => {
    const { window, call } = fixture()
    const button = window.document.querySelector('.sendbox button')
    if (!button) throw new Error('fixture 缺少发送按钮')
    let clicks = 0
    button.addEventListener('click', () => {
      clicks += 1
    })
    expect(call('write', { ...READ_ARGS, text: 'AI 回复' }).ok).toBe(true)
    expect(call('commit', { ...READ_ARGS, container: '.sendbox', buttonText: '发送' }).ok).toBe(
      true,
    )
    expect(clicks).toBe(1)
  })

  it('图片确认按钮在买家改变时不点，买家一致时才点', () => {
    const { window, call } = fixture('<button type="button" class="confirm-send">发送</button>')
    const direct = window.document.querySelector('.confirm-send')
    if (!direct) throw new Error('fixture 缺少图片确认按钮')
    // jsdom 不做布局，getClientRects 恒为空；这里只补桥接判可见性所需的矩形。
    Object.defineProperty(direct, 'getClientRects', {
      value: () => [{ width: 20, height: 20 }],
    })
    let clicks = 0
    direct.addEventListener('click', () => {
      clicks += 1
    })

    const blocked = call('confirmImageSend', {
      ...READ_ARGS,
      selector: '.confirm-send',
      expectedBuyer: '买家B',
      expectedBeforeText: '',
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.err).toContain('当前买家')
    expect(clicks).toBe(0)

    const allowed = call('confirmImageSend', {
      ...READ_ARGS,
      selector: '.confirm-send',
      expectedBuyer: '买家A',
      expectedBeforeText: '',
    })
    expect(allowed.ok).toBe(true)
    expect(clicks).toBe(1)
  })

  it('商家在宿主读取后新敲的草稿不被 guarded paste 覆盖', () => {
    const { window, call } = fixture()
    installImageApis(window)
    const input = inputOf(window)
    input.value = '人工草稿'
    const reply = call('pasteImage', {
      ...READ_ARGS,
      base64: 'AA==',
      name: 'a.png',
      mime: 'image/png',
      expectedBuyer: '买家A',
      expectedBeforeText: '',
    })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('原有正文')
    expect(input.value).toBe('人工草稿')
  })

  it('原有草稿为空时 guarded paste 正常派发', () => {
    const { window, call } = fixture()
    installImageApis(window)
    const input = inputOf(window)
    input.value = ''
    const reply = call('pasteImage', {
      ...READ_ARGS,
      base64: 'AA==',
      name: 'a.png',
      mime: 'image/png',
      expectedBuyer: '买家A',
      expectedBeforeText: '',
    })
    expect(reply.ok).toBe(true)
    expect(input.value).toBe('')
  })

  it('图片粘贴在买家改变时不碰输入框', () => {
    const { window, call } = fixture()
    const reply = call('pasteImage', {
      ...READ_ARGS,
      base64: 'AA==',
      name: 'a.png',
      mime: 'image/png',
      expectedBuyer: '买家B',
    })
    expect(reply.ok).toBe(false)
    expect(reply.err).toContain('当前买家')
    expect(inputOf(window).value).toBe('')
  })
})
