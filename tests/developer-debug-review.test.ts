// @vitest-environment node
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalHost, type PtyModule } from '../electron/developer-debug/pty'
import * as terminalModule from '../electron/developer-debug/pty'
import { createDeveloperDebugController } from '../electron/developer-debug/controller'
import { createPopupPolicy } from '../electron/developer-debug/popup-policy'

const ipc = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
  removeListener: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: ipc }))
vi.mock('../electron/windows', () => ({
  isAppWebContents: () => true,
  isTrustedRenderer: () => true,
}))
import { registerDeveloperDebugIpc } from '../electron/developer-debug/ipc'
import { developerDebugChannels } from '../src/shared/contracts/developer-debug'

class FakePty extends EventEmitter {
  pid = 1234
  kill = vi.fn()
  write = vi.fn()
  resize = vi.fn()
  onData = (fn: (data: string) => void) => {
    this.on('data', fn)
  }
  onExit = (fn: (event: { exitCode: number }) => void) => {
    this.on('exit', fn)
  }
}
const input = { ownerId: 1, workspaceId: 'w', cols: 80, rows: 24 }
function deferredHost() {
  let resolve!: (module: PtyModule) => void
  const pty = new FakePty()
  const spawn = vi.fn(() => pty)
  const onData = vi.fn()
  const host = createTerminalHost({
    cwd: () => '.',
    loadPty: () =>
      new Promise((r) => {
        resolve = r
      }),
    onData,
    onExit: vi.fn(),
    killProcessTree: async () => {
      pty.emit('exit', { exitCode: 1 })
    },
  })
  return { host, pty, spawn, onData, resolve: () => resolve({ spawn }) }
}

describe('developer debug lifecycle regression', () => {
  it('never spawns after a pending connection is disposed', async () => {
    const f = deferredHost()
    const pending = f.host.connect(input)
    f.host.dispose()
    f.resolve()
    await expect(pending).rejects.toThrow()
    expect(f.spawn).not.toHaveBeenCalled()
  })
  it.each([{ ownerId: 2 }, { workspaceId: 'other' }])(
    'does not share a pending connection across identities %j',
    async (change) => {
      const f = deferredHost()
      const first = f.host.connect(input)
      const second = f.host.connect({ ...input, ...change })
      const assertion = expect(second).rejects.toThrow()
      f.resolve()
      await first
      await assertion
      f.host.dispose()
      f.pty.emit('data', 'late')
      expect(f.onData).not.toHaveBeenCalled()
    },
  )
  it('does not kill a naturally exited PTY again', async () => {
    const f = deferredHost()
    const pending = f.host.connect(input)
    f.resolve()
    await pending
    f.pty.emit('exit', { exitCode: 0 })
    f.host.dispose()
    expect(f.pty.kill).not.toHaveBeenCalled()
  })
  it('registers a synchronous capability reply and cleans it symmetrically', () => {
    ipc.on.mockClear()
    const dispose = registerDeveloperDebugIpc({
      enabled: true,
      runtime: () => ({ developerDebug: () => ({ ownerId: () => 1 }) as never }),
    })
    const registration = ipc.on.mock.calls.find(
      (call) => call[0] === developerDebugChannels.capability,
    )
    expect(registration).toBeDefined()
    const frame = { url: 'file:///app/index.html#/reply-monitor' }
    const event = {
      senderFrame: frame,
      sender: { id: 1, mainFrame: frame },
      returnValue: undefined,
    }
    registration![1](event)
    expect(event.returnValue).toBe(true)
    const unauthorized = {
      ...event,
      senderFrame: { url: 'https://example.com' },
      returnValue: undefined,
    }
    registration![1](unauthorized)
    expect(unauthorized.returnValue).toBe(false)
    dispose()
    expect(ipc.removeListener).toHaveBeenCalledWith(
      developerDebugChannels.capability,
      registration![1],
    )
  })
  it('suppresses output from a previous controller host after owner replacement', () => {
    const hosts: Parameters<typeof createTerminalHost>[0][] = []
    const factory = vi.spyOn(terminalModule, 'createTerminalHost').mockImplementation((options) => {
      hosts.push(options)
      return {
        dispose: vi.fn(),
        status: () => ({ connected: false, cwd: '.', sessionId: '' }),
      } as never
    })
    try {
      const window = (id: number) =>
        Object.assign(new EventEmitter(), {
          id,
          isDestroyed: () => false,
          webContents: { id, send: vi.fn() },
        })
      const first = window(1)
      const second = window(2)
      let current = first
      const controller = createDeveloperDebugController({
        workspaceId: 'w',
        appVersion: 'test',
        monitor: {
          window: () => current as never,
          isExpanded: () => false,
          setExpanded: () => ({}) as never,
        },
        isWorkspaceActive: () => true,
        stores: () => [],
        logs: () => [],
        getStoreWebContents: () => null,
        openExternal: async () => {},
        ptyCwd: () => '.',
      })
      controller.attach(first as never)
      const oldHost = hosts.at(-1)!
      current = second
      controller.attach(second as never)
      oldHost.onData({ sessionId: 'old', data: 'late' })
      oldHost.onExit({ sessionId: 'old', exitCode: 0 })
      expect(second.webContents.send).not.toHaveBeenCalled()
      hosts.at(-1)!.onData({ sessionId: 'new', data: 'current' })
      expect(second.webContents.send).toHaveBeenCalledTimes(1)
      controller.dispose()
    } finally {
      factory.mockRestore()
    }
  })
  it.each([false, true])('compiles preload with source gate %s', async (source) => {
    const result = await build({
      entryPoints: ['electron/preload.ts'],
      bundle: true,
      write: false,
      format: 'cjs',
      minifySyntax: true,
      platform: 'node',
      external: ['electron'],
      define: { __SOURCE_DEVELOPER_PRELOAD__: String(source) },
    })
    const probe = vi.fn(() => true)
    const expose = vi.fn()
    if (!source) expect(result.outputFiles[0]!.text).not.toContain('sendSync')
    vm.runInNewContext(result.outputFiles[0]!.text, {
      require: () => ({
        contextBridge: { exposeInMainWorld: expose },
        ipcRenderer: { sendSync: probe, invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
      }),
      process: { argv: ['--lingtu-developer-debug'] },
    })
    expect(probe).toHaveBeenCalledTimes(source ? 1 : 0)
    expect(Boolean(expose.mock.calls[0]![1].developerDebug)).toBe(source)
  })
  it('uses the current popup mode for children after allow then block', () => {
    const page = Object.assign(new EventEmitter(), {
      id: 1,
      isDestroyed: () => false,
      getURL: () => 'https://mms.pinduoduo.com/path?unknownTicket=secret#secret',
      setWindowOpenHandler: vi.fn(),
    })
    const policy = createPopupPolicy({
      getStoreWebContents: () => page as never,
      getOwnerWebContents: () => null,
      openExternal: async () => {},
    })
    policy.set('s', 'allow')
    policy.set('s', 'block')
    expect(policy.status('s').url).toBe('https://mms.pinduoduo.com/path')
    const child = { webContents: { setWindowOpenHandler: vi.fn() } }
    page.emit('did-create-window', child)
    const handler = child.webContents.setWindowOpenHandler.mock.calls[0]![0]
    expect(handler({ url: 'https://example.com' }).action).toBe('deny')
  })
})
