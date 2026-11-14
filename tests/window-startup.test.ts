import { afterEach, expect, it, vi } from 'vitest'

const windows = vi.hoisted(() => [] as { ready?: () => void; calls: string[] }[])
vi.mock('electron', () => ({
  BrowserWindow: class {
    calls: string[] = []
    ready?: () => void
    webContents = {
      id: 1,
      once: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn() },
    }
    constructor() {
      windows.push(this)
    }
    once(event: string, callback: () => void) {
      if (event === 'ready-to-show') this.ready = callback
    }
    maximize() {
      this.calls.push('maximize')
    }
    show() {
      this.calls.push('show')
    }
  },
  shell: { openExternal: vi.fn() },
}))
import { createWindow } from '../electron/windows'
afterEach(() => {
  windows.length = 0
})
it('主窗口显式要求默认最大化时，先最大化再显示', () => {
  createWindow({ startMaximized: true })
  windows[0]!.ready!()
  expect(windows[0]!.calls).toEqual(['maximize', 'show'])
})
it('普通工具窗口仍按原尺寸显示', () => {
  createWindow()
  windows[0]!.ready!()
  expect(windows[0]!.calls).toEqual(['show'])
})
it('辅助窗口与离屏验收不会自动最大化', () => {
  createWindow({ auxiliary: true, startMaximized: true })
  createWindow({ smoke: true, startMaximized: true })
  expect(windows.map((win) => win.ready)).toEqual([undefined, undefined])
})
