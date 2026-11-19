import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { protectKnowledgeClose } from '../electron/knowledge-close'

function fixture() {
  let url = 'file:///app/index.html#/knowledge'
  const events = new EventEmitter()
  const webContents = Object.assign(new EventEmitter(), { getURL: () => url, send: vi.fn() })
  const win = Object.assign(events, {
    webContents,
    isDestroyed: () => false,
    close: vi.fn(() => {
      const event = { preventDefault: vi.fn() }
      events.emit('close', event)
      return event
    }),
  })
  const guard = protectKnowledgeClose(win as unknown as BrowserWindow, () => false)
  return {
    win,
    webContents,
    guard,
    navigate: (next: string) => {
      url = next
      webContents.emit('did-navigate-in-page')
    },
  }
}
it('主标题栏关闭与Alt+F4等待草稿保存确认，未确认不关闭，确认后关闭一次', () => {
  const { win, webContents, guard } = fixture()
  const event = win.close()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(webContents.send).toHaveBeenCalledWith('knowledge:close-request')
  // 保存失败不调用 hide/acknowledge，窗口保持打开；重试保存成功后再确认。
  expect(win.close).toHaveBeenCalledTimes(1)
  expect(guard.acknowledge()).toBe(true)
  expect(win.close).toHaveBeenCalledTimes(2)
  expect(guard.acknowledge()).toBe(false)
})
it('导航后清除旧关闭意图，其他内容页正常关闭，销毁时注销监听', () => {
  const { win, webContents, guard, navigate } = fixture()
  win.close()
  navigate('file:///app/index.html#/shop/manage')
  expect(guard.acknowledge()).toBe(false)
  expect(win.close().preventDefault).not.toHaveBeenCalled()
  navigate('file:///app/index.html#/knowledge')
  expect(guard.acknowledge()).toBe(false)
  win.emit('closed')
  expect(win.listenerCount('close')).toBe(0)
  expect(webContents.listenerCount('did-navigate-in-page')).toBe(0)
})
it('原生close事件异步触发时，保存确认仍只放行对应的一次关闭', async () => {
  const events = new EventEmitter()
  const attempts: { preventDefault: ReturnType<typeof vi.fn> }[] = []
  const win = Object.assign(events, {
    webContents: Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html#/knowledge',
      send: vi.fn(),
    }),
    isDestroyed: () => false,
    close: () => {
      queueMicrotask(() => {
        const event = { preventDefault: vi.fn() }
        attempts.push(event)
        events.emit('close', event)
      })
    },
  })
  const guard = protectKnowledgeClose(win as unknown as BrowserWindow, () => false)
  win.close()
  await Promise.resolve()
  expect(attempts[0]!.preventDefault).toHaveBeenCalled()
  guard.acknowledge()
  await Promise.resolve()
  expect(attempts[1]!.preventDefault).not.toHaveBeenCalled()
})
it('窗口销毁后的清理不再读取已经失效的webContents属性', () => {
  let destroyed = false
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'file:///app/index.html#/knowledge',
    send: vi.fn(),
  })
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed, close: vi.fn() })
  Object.defineProperty(win, 'webContents', {
    get: () => {
      if (destroyed) throw Error('Object has been destroyed')
      return contents
    },
  })
  protectKnowledgeClose(win as unknown as BrowserWindow, () => false)
  destroyed = true
  expect(() => win.emit('closed')).not.toThrow()
  expect(contents.listenerCount('did-navigate-in-page')).toBe(0)
})
