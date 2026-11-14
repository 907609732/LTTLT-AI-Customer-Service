import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { createAssistWindowManager, dockAssistBounds } from '../electron/assist-window'

class FakeWindow extends EventEmitter {
  bounds = { x: 120, y: 70, width: 1000, height: 800 }
  destroyed = false
  visible = false
  minimized = false
  pinned = false
  focused = false
  webContents = { isDestroyed: () => this.destroyed, send: vi.fn() }
  isDestroyed() {
    return this.destroyed
  }
  getBounds() {
    return { ...this.bounds }
  }
  setBounds(bounds: typeof this.bounds) {
    this.bounds = { ...bounds }
  }
  setAlwaysOnTop(value: boolean) {
    this.pinned = value
  }
  isMinimized() {
    return this.minimized
  }
  restore() {
    this.minimized = false
  }
  show() {
    this.visible = true
  }
  focus() {
    this.focused = true
  }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith('lingtu-assist-test-')
    )
      throw new Error('无效隔离测试目录')
    fs.rmSync(root, { recursive: true, force: true })
  }
})
function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-assist-test-'))
  roots.push(rootDir)
  const primary = new FakeWindow()
  const instances: FakeWindow[] = []
  let workspace = { id: 'local-run-1', identity: 'local' }
  const opened = vi.fn(),
    closed = vi.fn()
  const manager = createAssistWindowManager({
    rootDir,
    getPrimary: () => primary as unknown as BrowserWindow,
    getWorkspace: () => workspace,
    create: () => {
      const win = new FakeWindow()
      instances.push(win)
      return win as unknown as BrowserWindow
    },
    load: async () => {},
    workArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
    opened,
    closed,
  })
  return {
    rootDir,
    manager,
    primary,
    instances,
    opened,
    closed,
    changeWorkspace: (next: typeof workspace) => {
      workspace = next
    },
  }
}

describe('辅助中心独立浮窗', () => {
  it('重复打开只唤起同一300px窗口，最小化重开恢复而不重建', async () => {
    const { manager, instances, opened } = fixture()
    await Promise.all([manager.open(), manager.open()])
    expect(instances).toHaveLength(1)
    expect(instances[0].bounds.width).toBe(300)
    expect(instances[0].pinned).toBe(true)
    instances[0].minimized = true
    await manager.open()
    expect(instances).toHaveLength(1)
    expect(instances[0].minimized).toBe(false)
    expect(opened).toHaveBeenCalledTimes(1)
    manager.dispose()
  })
  it('吸附跟随主窗，用户拖动解除吸附，受限修改拒绝主窗', async () => {
    const { manager, primary, instances } = fixture()
    await manager.open()
    const win = instances[0]
    primary.bounds.x += 40
    primary.emit('move')
    expect(win.bounds.x).toBe(1160)
    expect(() => manager.update(primary as unknown as BrowserWindow, { pinned: false })).toThrow(
      '仅供辅助中心',
    )
    win.emit('will-move')
    expect(manager.state(win as unknown as BrowserWindow).docked).toBe(false)
    expect(() => manager.update(win as unknown as BrowserWindow, { volume: 2 })).toThrow()
    manager.dispose()
  })
  it('系统关闭先要求确认，确认只销毁辅窗，主窗关闭同步清理', async () => {
    const { manager, instances, primary, closed } = fixture()
    await manager.open()
    const preventDefault = vi.fn()
    instances[0].emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(instances[0].webContents.send).toHaveBeenCalledWith('assist:request-close')
    expect(instances[0].destroyed).toBe(false)
    manager.close(instances[0] as unknown as BrowserWindow)
    expect(primary.destroyed).toBe(false)
    expect(closed).toHaveBeenCalledOnce()
    await manager.open()
    primary.destroy()
    expect(instances[1].destroyed).toBe(true)
  })
  it('工作区切换清旧偏好，回到同一身份恢复该身份偏好', async () => {
    const { manager, instances, changeWorkspace } = fixture()
    await manager.open()
    manager.update(instances[0] as unknown as BrowserWindow, { volume: 0.2, soundEnabled: true })
    changeWorkspace({ id: 'managed-run', identity: 'account-2' })
    expect(manager.state().volume).toBe(0.5)
    expect(manager.state().soundEnabled).toBe(false)
    expect(manager.state().workspaceId).toBe('managed-run')
    changeWorkspace({ id: 'local-run-2', identity: 'local' })
    expect(manager.state().volume).toBe(0.2)
    expect(manager.state().soundEnabled).toBe(true)
    manager.dispose()
  })
  it('屏幕边缘优先换侧，负坐标屏幕与矮屏保持可见', () => {
    expect(
      dockAssistBounds(
        { x: 1200, y: 800, width: 600, height: 500 },
        { x: 0, y: 0, width: 1920, height: 900 },
        900,
      ),
    ).toEqual({ x: 900, y: 0, width: 300, height: 900 })
    expect(
      dockAssistBounds(
        { x: -1900, y: -10, width: 1200, height: 800 },
        { x: -1920, y: 0, width: 1920, height: 700 },
        900,
      ),
    ).toEqual({ x: -700, y: 0, width: 300, height: 700 })
  })
  it('旧窗口延迟closed不会拆除新窗口吸附监听', async () => {
    const { manager, primary, instances, closed } = fixture()
    await manager.open()
    const previous = instances[0]
    previous.destroy = () => {
      previous.destroyed = true
    }
    manager.close(previous as unknown as BrowserWindow)
    await manager.open()
    previous.emit('closed')
    primary.bounds.x += 30
    primary.emit('move')
    expect(instances[1].bounds.x).toBe(1150)
    expect(closed).toHaveBeenCalledOnce()
    manager.dispose()
  })
})
