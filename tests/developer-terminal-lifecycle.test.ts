import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  instances: [] as {
    reset: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }[],
  connect: vi.fn(),
  resize: vi.fn(async () => {}),
  write: vi.fn(async () => {}),
  data: undefined as ((event: { sessionId: string; data: string }) => void) | undefined,
  exit: undefined as ((event: { sessionId: string; exitCode?: number }) => void) | undefined,
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    reset = vi.fn()
    write = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    constructor() {
      mocks.instances.push(this)
    }
    loadAddon() {}
    open() {}
    onData() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('../src/modules/auxiliary/services/developer-debug', () => ({
  getDeveloperDebugBridge: () => ({
    ptyConnect: mocks.connect,
    ptyResize: mocks.resize,
    ptyWrite: mocks.write,
    onPtyData: (fn: typeof mocks.data) => {
      mocks.data = fn
      return () => {
        mocks.data = undefined
      }
    },
    onPtyExit: (fn: typeof mocks.exit) => {
      mocks.exit = fn
      return () => {
        mocks.exit = undefined
      }
    },
  }),
}))
import DeveloperTerminal from '../src/modules/auxiliary/components/DeveloperTerminal.vue'
const result = { sessionId: 'session', cwd: '.', reconnected: false, buffer: '' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.instances.length = 0
})
async function pending() {
  let resolve!: (value: typeof result) => void
  mocks.connect.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const wrapper = mount(DeveloperTerminal, { props: { expanded: true, workspaceId: 'a' } })
  await flushPromises()
  await wrapper.find('button').trigger('click')
  return { wrapper, resolve, terminal: mocks.instances[0]! }
}
describe('developer terminal asynchronous lifecycle', () => {
  it('ignores a connect result after unmount', async () => {
    const f = await pending()
    f.wrapper.unmount()
    f.resolve(result)
    await flushPromises()
    expect(f.terminal.focus).not.toHaveBeenCalled()
    expect(f.terminal.write).not.toHaveBeenCalled()
  })
  it('ignores a connect result after workspace changes', async () => {
    const f = await pending()
    await f.wrapper.setProps({ workspaceId: 'b' })
    f.resolve(result)
    await flushPromises()
    expect(f.wrapper.attributes('data-terminal-status')).toBe('idle')
    expect(f.terminal.focus).not.toHaveBeenCalled()
    f.wrapper.unmount()
  })
  it('replays data and exit delivered before the connect response', async () => {
    const f = await pending()
    mocks.data!({ sessionId: 'unrelated', data: 'stale' })
    mocks.data!({ sessionId: 'session', data: 'early output' })
    mocks.exit!({ sessionId: 'session', exitCode: 0 })
    f.resolve(result)
    await flushPromises()
    expect(f.terminal.write).toHaveBeenCalledWith('early output')
    expect(f.terminal.write).not.toHaveBeenCalledWith('stale')
    expect(f.wrapper.attributes('data-terminal-status')).toBe('exited')
    f.wrapper.unmount()
  })
})
