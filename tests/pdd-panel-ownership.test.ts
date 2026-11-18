import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: string },
  ) => {
    window: Window & typeof globalThis
  }
}

function rects(window: Window & typeof globalThis) {
  for (const node of window.document.querySelectorAll('.chatMessage, .chat-item, p'))
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 600,
        bottom: 40,
        width: 600,
        height: 40,
      }),
    })
}

function mount(panelHtml: string, currentUid: string, messageList: Array<Record<string, unknown>>) {
  const page = new JSDOM(
    `<div id="app"><div class="chat-item-box active" data-random="${currentUid}-0-reply"></div></div>` +
      `<div class="chatMessage">${panelHtml}</div>`,
    { url: 'https://mms.pinduoduo.com/chat-merchant/index.html', runScripts: 'outside-only' },
  )
  const { window } = page
  const current = { userInfo: { uid: currentUid }, messageList }
  Object.assign(window.document.querySelector('#app')!, {
    __vue__: {
      $store: {
        state: { selectingChatUid: currentUid, currentUserInfo: current, chatList: [current] },
        getters: {},
      },
    },
  })
  rects(window)
  window.eval(readFileSync('vendor/lingtu-runtime/desk-v1/src/injections/pdd-web-hook.js', 'utf8'))
  const api = Reflect.get(window, '__pddWeb') as {
    pending(): Record<string, { messages: Array<{ content: string }> }>
    reviewHistory(uid: string): { known: boolean; messages: Array<{ content: string }> }
  }
  return { window, api }
}

it('无消息项 ID 时，公共文本不能证明整个旧面板属于新买家', () => {
  const { window, api } = mount(
    '<div class="chat-item"><p class="chat-message-content">hello</p></div>' +
      '<div class="chat-item"><p class="chat-message-content">A 的私有问题</p></div>',
    '222222',
    [{ msg_id: 'b-1', from: { role: 'buyer' }, content: 'hello', ts: Date.now() }],
  )
  try {
    expect(api.reviewHistory('222222').known).toBe(false)
    expect(api.pending()['222222'].messages.map((m) => m.content)).toEqual(['hello'])
  } finally {
    window.close()
  }
})

it.each(['constructor', 'toString', '__proto__'])(
  '无消息项 ID 时继承属性文本 %s 不能证明旧面板属于当前买家',
  (text) => {
    const { window, api } = mount(
      '<div class="chat-item"><p class="chat-message-content">hello</p></div>' +
        `<div class="chat-item"><p class="chat-message-content">${text}</p></div>`,
      '222222',
      [{ msg_id: 'b-1', from: { role: 'buyer' }, content: 'hello', ts: Date.now() }],
    )
    try {
      expect(api.reviewHistory('222222').known).toBe(false)
      expect(api.pending()['222222'].messages.map((m) => m.content)).toEqual(['hello'])
    } finally {
      window.close()
    }
  },
)

it('无消息项 ID 但所有可见气泡都能对应目标买家已知消息时保留正常采集', () => {
  const { window, api } = mount(
    '<div class="chat-item"><p class="chat-message-content">hello</p></div>' +
      '<div class="chat-item"><p class="chat-message-content">B 的新问题</p></div>',
    '222222',
    [
      { msg_id: 'b-1', from: { role: 'buyer' }, content: 'hello', ts: Date.now() },
      { msg_id: 'b-2', from: { role: 'buyer' }, content: 'B 的新问题', ts: Date.now() + 1 },
    ],
  )
  try {
    const history = api.reviewHistory('222222')
    expect(history.known).toBe(true)
    expect(history.messages.map((m) => m.content)).toEqual(['hello', 'B 的新问题'])
    expect(api.pending()['222222'].messages.map((m) => m.content)).toEqual(['hello', 'B 的新问题'])
  } finally {
    window.close()
  }
})

it('两位买家文字相同，旧消息气泡的明确 ID 不得被当作新买家的复核基线', () => {
  const page = new JSDOM(
    '<div id="app"><div class="chat-item-box active" data-random="222222-0-reply"></div></div>' +
      '<div class="chatMessage"><li id="middlePanel_list_1794938400001" class="chat-item">' +
      '<p class="chat-message-content">你好</p></li></div>',
    { url: 'https://mms.pinduoduo.com/chat-merchant/index.html', runScripts: 'outside-only' },
  )
  const { window } = page
  try {
    const current = {
      userInfo: { uid: '222222' },
      messageList: [
        { msg_id: '1794938400002', from: { role: 'buyer' }, content: '你好', ts: Date.now() },
      ],
    }
    Object.assign(window.document.querySelector('#app')!, {
      __vue__: {
        $store: {
          state: { selectingChatUid: '222222', currentUserInfo: current, chatList: [current] },
          getters: {},
        },
      },
    })
    for (const node of window.document.querySelectorAll('.chatMessage, .chat-item, p')) {
      Object.defineProperty(node, 'getBoundingClientRect', {
        value: () => ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 600,
          bottom: 40,
          width: 600,
          height: 40,
        }),
      })
    }
    window.eval(
      readFileSync('vendor/lingtu-runtime/desk-v1/src/injections/pdd-web-hook.js', 'utf8'),
    )
    const api = Reflect.get(window, '__pddWeb') as {
      reviewHistory(uid: string): { known: boolean }
    }
    expect(api.reviewHistory('222222').known).toBe(false)
    window.document.querySelector('li')!.id = 'middlePanel_list_1794938400002'
    expect(api.reviewHistory('222222').known).toBe(true)
  } finally {
    window.close()
  }
})
