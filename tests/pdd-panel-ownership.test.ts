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
