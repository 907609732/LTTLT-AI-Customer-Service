import { describe, it, expect, vi, beforeEach } from 'vitest'
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
    removeHandler: (name: string) => handlers.delete(name),
  },
}))
import { registerSchedulerIpc } from '../electron/scheduler-ipc'
import { ReceptionScheduler } from '../electron/scheduler-runtime'
describe('调度IPC来源与工作区', () => {
  beforeEach(() => handlers.clear())
  it('拒绝不可信窗口，读请求也需当前工作区令牌', () => {
    const runtime = new ReceptionScheduler({
      workspaceId: 'w',
      load: () => undefined,
      save: () => {},
    })
    const off = registerSchedulerIpc({
      requireAppFrame: () => {
        throw Error('untrusted')
      },
      resolveCurrent: () => runtime,
    })
    expect(() => handlers.get('scheduler:snapshot')?.({}, 'w')).toThrow('untrusted')
    expect(() => handlers.get('scheduler:execute')?.({}, {})).toThrow('untrusted')
    off()
    expect(handlers.size).toBe(0)
  })
  it('快照拒绝旧工作区并跟随当前实例', () => {
    let runtime = new ReceptionScheduler({
      workspaceId: 'old',
      load: () => undefined,
      save: () => {},
    })
    registerSchedulerIpc({ requireAppFrame: () => {}, resolveCurrent: () => runtime })
    runtime = new ReceptionScheduler({ workspaceId: 'new', load: () => undefined, save: () => {} })
    expect(() => handlers.get('scheduler:snapshot')?.({}, 'old')).toThrow(/工作区/)
    expect(handlers.get('scheduler:snapshot')?.({}, 'new')).toMatchObject({ workspaceId: 'new' })
    expect(() => handlers.get('scheduler:snapshot')?.({})).toThrow()
  })
})
