import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { createReplyMonitorWindow } from '../electron/reply-monitor-window'

class Window extends EventEmitter {
  bounds = { x: 100, y: 50, width: 1440, height: 920 }
  destroyed = false
  minimized = false
  visible = true
  resizable = false
  minimum = { width: 340, height: 300 }
  maximum = { width: 340, height: 300 }
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
  getBounds() {
    return this.bounds
  }
  setBounds(bounds: typeof this.bounds) {
    this.bounds = bounds
  }
  setResizable(value: boolean) {
    this.resizable = value
  }
  setMinimumSize(width: number, height: number) {
    this.minimum = { width, height }
  }
  setMaximumSize(width: number, height: number) {
    this.maximum = { width, height }
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

it('展开到 960×620、可调整大小；收起恢复紧凑尺寸且不新建窗口', async () => {
  const parent = new Window(),
    child = new Window()
  const create = vi.fn(() => asWindow(child))
  const manager = createReplyMonitorWindow({
    getParent: () => asWindow(parent),
    create,
    load: async () => {},
  })
  await manager.open()
  let size = manager.setExpanded(true)
  expect(size).toMatchObject({ expanded: true, width: 960, height: 620 })
  expect(child.bounds).toEqual({ x: 112, y: 338, width: 960, height: 620 })
  expect(child.resizable).toBe(true)
  expect(child.maximum).toEqual({ width: 960, height: 620 })
  parent.bounds = { x: 300, y: 20, width: 1000, height: 700 }
  parent.emit('move')
  expect(child.bounds.width).toBe(960)
  expect(child.bounds.height).toBe(620)
  expect(child.bounds.x).toBe(312)
  expect(child.bounds.y).toBe(88)
  parent.bounds = { x: 300, y: 20, width: 800, height: 500 }
  parent.emit('resize')
  expect(child.bounds.width).toBeLessThanOrEqual(776)
  expect(child.bounds.height).toBeLessThanOrEqual(476)
  size = manager.setExpanded(false)
  expect(size).toMatchObject({ expanded: false, width: 340, height: 300 })
  expect(child.resizable).toBe(false)
  expect(create).toHaveBeenCalledTimes(1)
  await manager.open()
  expect(create).toHaveBeenCalledTimes(1)
  manager.dispose()
})
