// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  createPddHistoryObserver,
  type NativeHistoryDebugger,
} from '../electron/platform-learning-chat'

class DebuggerFixture extends EventEmitter {
  attached = false
  bodies = new Map<string, unknown>()
  commands: string[] = []
  attach() {
    this.attached = true
  }
  detach() {
    this.attached = false
  }
  isAttached() {
    return this.attached
  }
  async sendCommand(method: string, input?: { requestId?: string }) {
    this.commands.push(method)
    return method === 'Network.getResponseBody'
      ? { body: JSON.stringify(this.bodies.get(input?.requestId ?? '')), base64Encoded: false }
      : {}
  }
  response(id: string, path: string, body: unknown, size = 100) {
    this.bodies.set(id, body)
    this.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: id,
      request: { url: `https://mms.pinduoduo.com${path}` },
      type: 'XHR',
    })
    this.emit('message', {}, 'Network.responseReceived', {
      requestId: id,
      response: {
        status: 200,
        mimeType: 'application/json',
        url: `https://mms.pinduoduo.com${path}`,
      },
    })
    this.emit('message', {}, 'Network.loadingFinished', { requestId: id, encodedDataLength: size })
  }
}
const usersPath = '/latitude/search/message/getMessagesUsers',
  messagesPath = '/latitude/search/message/getMessages'
function fixture() {
  const debuggerFixture = new DebuggerFixture()
  const observer = createPddHistoryObserver(debuggerFixture as unknown as NativeHistoryDebugger)
  return { debuggerFixture, observer }
}

describe('bounded native PDD history response metadata', () => {
  it('projects only verified identities, totals, and message metadata from native responses', async () => {
    const f = fixture()
    try {
      await f.observer.ready()
      f.observer.begin()
      f.debuggerFixture.response('users', usersPath, {
        success: true,
        result: {
          mallInfo: { mallId: 'mall' },
          convUsers: [{ uid: 'buyer', nickname: 'private-name', avatar: 'private-image' }],
          total: 1,
        },
      })
      const users = await f.observer.waitUsers(new AbortController().signal)
      expect(users).toEqual({ mallId: 'mall', total: 1, uids: ['buyer'] })
      f.debuggerFixture.response('messages', messagesPath, {
        success: true,
        result: {
          mallInfo: { mallId: 'mall' },
          userInfo: { uid: 'buyer' },
          contentList: [
            {
              msgId: 123,
              ts: 1000,
              type: 0,
              direction: false,
              content: 'private-message',
              csname: 'private-staff',
            },
          ],
          total: 1,
          pageNum: null,
        },
      })
      const messages = await f.observer.waitMessages(new AbortController().signal)
      expect(messages).toEqual({
        mallId: 'mall',
        uid: 'buyer',
        total: 1,
        pageNum: null,
        messages: [{ id: '123', at: 1000000, type: 0, seller: false }],
      })
      expect(JSON.stringify(messages)).not.toContain('private')
    } finally {
      f.observer.dispose()
    }
    expect(f.debuggerFixture.attached).toBe(false)
  })
  it('ignores unrelated or earlier-generation requests without reading their response bodies', async () => {
    const f = fixture()
    try {
      await f.observer.ready()
      f.observer.begin()
      f.debuggerFixture.response('ad', '/marketing/private', { secret: 'not-read' })
      f.debuggerFixture.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'old',
        request: { url: `https://mms.pinduoduo.com${messagesPath}` },
        type: 'XHR',
      })
      f.observer.begin()
      f.debuggerFixture.emit('message', {}, 'Network.responseReceived', {
        requestId: 'old',
        response: { status: 200, mimeType: 'application/json' },
      })
      f.debuggerFixture.emit('message', {}, 'Network.loadingFinished', {
        requestId: 'old',
        encodedDataLength: 10,
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      expect(f.debuggerFixture.commands).toEqual(['Network.enable'])
    } finally {
      f.observer.dispose()
    }
  })
  it('rejects oversized or detached observations instead of claiming an empty history', async () => {
    const f = fixture()
    try {
      await f.observer.ready()
      f.observer.begin()
      f.debuggerFixture.response('large', messagesPath, { success: true }, 1048577)
      await expect(f.observer.waitMessages(new AbortController().signal)).rejects.toThrow('容量')
      f.observer.begin()
      f.debuggerFixture.emit('detach', {}, 'target_closed')
      await expect(f.observer.waitUsers(new AbortController().signal)).rejects.toThrow('中断')
    } finally {
      f.observer.dispose()
    }
  })
  it('does not read a response body after a foreign-origin redirect', async () => {
    const f = fixture()
    try {
      await f.observer.ready()
      f.observer.begin()
      f.debuggerFixture.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: 'foreign',
        request: { url: `https://mms.pinduoduo.com${messagesPath}` },
        type: 'XHR',
      })
      f.debuggerFixture.emit('message', {}, 'Network.responseReceived', {
        requestId: 'foreign',
        response: { status: 200, mimeType: 'application/json', url: 'https://example.com/history' },
      })
      f.debuggerFixture.emit('message', {}, 'Network.loadingFinished', {
        requestId: 'foreign',
        encodedDataLength: 10,
      })
      await expect(f.observer.waitMessages(new AbortController().signal)).rejects.toThrow()
      expect(f.debuggerFixture.commands).toEqual(['Network.enable'])
    } finally {
      f.observer.dispose()
    }
  })
})
