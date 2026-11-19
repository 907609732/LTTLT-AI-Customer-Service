import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  pinned: true,
  handlers: new Map<string, (event: Electron.IpcMainInvokeEvent, input?: unknown) => unknown>(),
  trusted: true,
  win: {
    id: 7,
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    isAlwaysOnTop: vi.fn(),
    setAlwaysOnTop: vi.fn(),
  },
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.74' },
  BrowserWindow: { fromWebContents: () => state.win },
  clipboard: {},
  shell: {},
  ipcMain: {
    handle: (
      name: string,
      handler: (event: Electron.IpcMainInvokeEvent, input?: unknown) => unknown,
    ) => state.handlers.set(name, handler),
    removeHandler: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))
vi.mock('../electron/windows', () => ({
  isTrustedRenderer: () => state.trusted,
  isAppWebContents: () => state.trusted,
  loadRenderer: vi.fn(),
}))
import { registerDesktopIpc } from '../electron/ipc'
const frame = { url: 'file:///fixture/index.html' }
const event = {
  senderFrame: frame,
  sender: { id: 1, mainFrame: frame },
} as unknown as Electron.IpcMainInvokeEvent
beforeEach(() => {
  vi.clearAllMocks()
  state.handlers.clear()
  state.pinned = true
  state.trusted = true
  state.win.isAlwaysOnTop.mockImplementation(() => state.pinned)
  state.win.setAlwaysOnTop.mockImplementation((value) => {
    state.pinned = value
  })
  registerDesktopIpc()
})
it('reads and sets pinning on the requesting trusted window with boolean validation', () => {
  const read = state.handlers.get('win:is-always-on-top')!,
    set = state.handlers.get('win:set-always-on-top')!
  expect(read(event)).toBe(true)
  expect(set(event, false)).toBe(false)
  expect(set(event, true)).toBe(true)
  expect(() => set(event, 'false')).toThrow()
  expect(state.win.setAlwaysOnTop).toHaveBeenCalledTimes(2)
})
it('rejects pin requests from platform frames or untrusted senders', () => {
  state.trusted = false
  expect(() => state.handlers.get('win:set-always-on-top')!(event, true)).toThrow('不可信')
  expect(state.win.setAlwaysOnTop).not.toHaveBeenCalled()
  state.trusted = true
  expect(() =>
    state.handlers.get('win:is-always-on-top')!({
      ...event,
      senderFrame: { url: 'file:///other' },
    } as unknown as Electron.IpcMainInvokeEvent),
  ).toThrow('不可信')
})
it('update checks reject platform frames and invalid manual flags before any network access', () => {
  const check = state.handlers.get('app:check-updates')!
  expect(() => check(event, 'true')).toThrow()
  state.trusted = false
  expect(() => check(event, true)).toThrow('不可信')
  state.trusted = true
  expect(() =>
    check(
      { ...event, senderFrame: { url: 'file:///other' } } as unknown as Electron.IpcMainInvokeEvent,
      false,
    ),
  ).toThrow('不可信')
})
