import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { createReplyMonitorWindow } from '../electron/reply-monitor-window'

class Window extends EventEmitter {
  bounds = { x: 100, y: 50, width: 1440, height: 920 }
  destroyed = false
  minimized = false
  visible = true
  showInactive = vi.fn(() => {
    this.visible = true
  })
  hide = vi.fn(() => {
    this.visible = false
  })
  isDestroyed() {
    return this.destroyed
  }
  isMinimized() {
    return this.minimized
  }
  isVisible() {
    return this.visible
  }
  getContentBounds() {
    return this.bounds
  }
  setBounds(bounds: typeof this.bounds) {
    this.bounds = bounds
  }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}
const asWindow = (win: Window) => win as unknown as BrowserWindow

it('浮窗在主窗口内左下角，不抢焦点，重复打开不创建第二个窗口', async () => {
  const parent = new Window(),
    child = new Window()
  const create = vi.fn(() => asWindow(child))
  const manager = createReplyMonitorWindow({
    getParent: () => asWindow(parent),
    create,
    load: async () => {},
  })
  await Promise.all([manager.open(), manager.open()])
  expect(create).toHaveBeenCalledTimes(1)
  expect(child.bounds).toEqual({ x: 112, y: 658, width: 340, height: 300 })
  expect(child.showInactive).toHaveBeenCalled()
  parent.bounds.x = 400
  parent.emit('move')
  expect(child.bounds.x).toBe(412)
  parent.minimized = true
  parent.emit('minimize')
  expect(child.visible).toBe(false)
  parent.minimized = false
  parent.emit('restore')
  expect(child.visible).toBe(true)
  manager.dispose()
  expect(child.destroyed).toBe(true)
  expect(parent.listenerCount('move')).toBe(0)
})

it('加载期间父窗口关闭或运行时销毁，不会迟到弹出窗口', async () => {
  const parent = new Window(),
    child = new Window()
  let loaded = () => {}
  const manager = createReplyMonitorWindow({
    getParent: () => asWindow(parent),
    create: () => asWindow(child),
    load: () =>
      new Promise<void>((resolve) => {
        loaded = resolve
      }),
  })
  const opening = manager.open()
  parent.emit('closed')
  loaded()
  await opening
  expect(child.showInactive).not.toHaveBeenCalled()
  expect(child.destroyed).toBe(true)
  manager.dispose()
})
