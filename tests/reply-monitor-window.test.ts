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
    const changed =
      bounds.x !== this.bounds.x ||
      bounds.y !== this.bounds.y ||
      bounds.width !== this.bounds.width ||
      bounds.height !== this.bounds.height
    this.bounds = bounds
    // 真实 Electron 的 setBounds 也会触发 resize；不能把它当成用户拖动。
    if (changed) this.emit('resize')
  }
  dragResize(bounds: typeof this.bounds) {
    this.emit('will-resize', {}, bounds, { edge: 'top' })
    this.setBounds(bounds)
    this.emit('resized')
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
  child.dragResize({ x: 112, y: 438, width: 820, height: 520 })
  child.dragResize({ x: 112, y: 338, width: 960, height: 620 })
  await manager.open()
  expect(child.bounds).toEqual({ x: 112, y: 338, width: 960, height: 620 })
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
  // 普通模式保留系统原生边缘缩放，但宽度由最小/最大尺寸锁在 340。
  expect(child.resizable).toBe(true)
  expect(child.minimum.width).toBe(340)
  expect(child.maximum.width).toBe(340)
  expect(create).toHaveBeenCalledTimes(1)
  await manager.open()
  expect(create).toHaveBeenCalledTimes(1)
  manager.dispose()
})

it('普通模式只放开高度：宽度锁 340，用户上拖后父窗移动、新消息重新打开仍保留高度并可缩回', async () => {
  const parent = new Window(),
    child = new Window()
  const manager = createReplyMonitorWindow({
    getParent: () => asWindow(parent),
    create: () => asWindow(child),
    load: async () => {},
  })
  await manager.open()
  expect(child.bounds).toEqual({ x: 112, y: 658, width: 340, height: 300 })
  expect(child.resizable).toBe(true)
  expect(child.minimum).toEqual({ width: 340, height: 300 })
  // 普通模式的最大高度跟随父窗可用高度（920 - 上下各 12），宽度仍是 340。
  expect(child.maximum).toEqual({ width: 340, height: 896 })
  // 用户拖动上边缘向上：原生缩放保持底边不动，只改变高度。
  child.dragResize({ x: 112, y: 498, width: 340, height: 460 })
  child.dragResize({ x: 112, y: 658, width: 340, height: 300 })
  await manager.open()
  expect(child.bounds.height).toBe(300)
  child.dragResize({ x: 112, y: 498, width: 340, height: 460 })
  parent.bounds.x = 400
  parent.emit('move')
  expect(child.bounds).toEqual({ x: 412, y: 498, width: 340, height: 460 })
  // 新消息触发的重新 open 不能把用户首选高度重置回 300。
  await manager.open()
  expect(child.bounds).toEqual({ x: 412, y: 498, width: 340, height: 460 })
  // 用户缩回默认高度后同样要记住，下一次父窗移动不再弹回 460。
  child.dragResize({ x: 412, y: 658, width: 340, height: 300 })
  parent.bounds.x = 100
  parent.emit('move')
  expect(child.bounds).toEqual({ x: 112, y: 658, width: 340, height: 300 })
  manager.dispose()
})

it('父窗变矮时夹取普通模式高度且不覆盖首选高度，父窗恢复后回到用户高度', async () => {
  const parent = new Window(),
    child = new Window()
  const manager = createReplyMonitorWindow({
    getParent: () => asWindow(parent),
    create: () => asWindow(child),
    load: async () => {},
  })
  await manager.open()
  child.dragResize({ x: 112, y: 258, width: 340, height: 700 })
  parent.bounds = { x: 100, y: 50, width: 1440, height: 500 }
  parent.emit('resize')
  // 夹取到父窗可用高度 500 - 24，setBounds 触发的 resize 不能改写首选高度。
  expect(child.bounds).toEqual({ x: 112, y: 62, width: 340, height: 476 })
  expect(child.maximum).toEqual({ width: 340, height: 476 })
  parent.bounds = { x: 100, y: 50, width: 1440, height: 920 }
  parent.emit('resize')
  expect(child.bounds).toEqual({ x: 112, y: 258, width: 340, height: 700 })
  manager.dispose()
})

it('切进 GM 再收起保持本次普通模式高度，GM 展开尺寸和可缩放范围不变', async () => {
  const parent = new Window(),
    child = new Window()
  const manager = createReplyMonitorWindow({
    getParent: () => asWindow(parent),
    create: () => asWindow(child),
    load: async () => {},
  })
  await manager.open()
  child.dragResize({ x: 112, y: 558, width: 340, height: 400 })
  expect(manager.setExpanded(true)).toMatchObject({ expanded: true, width: 960, height: 620 })
  expect(child.bounds).toEqual({ x: 112, y: 338, width: 960, height: 620 })
  expect(child.maximum).toEqual({ width: 960, height: 620 })
  expect(manager.setExpanded(false)).toMatchObject({ expanded: false, width: 340, height: 400 })
  expect(child.bounds).toEqual({ x: 112, y: 558, width: 340, height: 400 })
  expect(child.resizable).toBe(true)
  expect(child.maximum).toEqual({ width: 340, height: 896 })
  manager.dispose()
})
