import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  emptySnapshot,
  type BackendCommand,
  type BackendEvent,
} from '../src/shared/contracts/backend'
import type { LocalRuntime } from '../electron/local-runtime'
import { createWorkspaceRuntime } from '../electron/workspace-runtime'

function fixture() {
  const source = { ...emptySnapshot().managed.configured }
  const instances: LocalRuntime[] = []
  const calls: string[] = []
  let failStart = false
  let pauseStart = false
  let resumeStart: (() => void) | undefined
  let release: (() => void) | undefined
  const factory = (): LocalRuntime => {
    const state = emptySnapshot()
    state.workspaceId = randomUUID()
    state.stores = [
      {
        id: 'private-store',
        storeName: '私有店铺',
        platform: 'sim-local',
        group: '',
        aiEnabled: false,
        runtime: { open: false, online: false },
      },
    ]
    state.managed.active = { ...source }
    state.managed.configured = { ...source }
    const listeners = new Set<(event: BackendEvent) => void>()
    let closed = false
    const runtime: LocalRuntime = {
      dataDirectory: () => {
        if (closed) throw Error('closed')
        return state.workspaceId
      },
      storeSync: () => {
        throw Error('测试未接同步')
      },
      scheduler: () => {
        throw Error('测试未接调度')
      },
      platformLearning: () => {
        throw Error('测试未接学习')
      },
      openPlatformLearningSource: async () => {
        throw Error('测试未接学习原页')
      },
      platformOrders: () => {
        throw Error('测试未接订单')
      },
      receptionOperations: () => {
        throw Error('测试未接接待')
      },
      serviceRequest: async () => {
        if (closed) throw Error('closed')
        return { workspaceId: state.workspaceId }
      },
      async start() {
        if (failStart) throw new Error('start failed')
        if (pauseStart)
          await new Promise<void>((resolve) => {
            resumeStart = resolve
          })
      },
      snapshot: () => structuredClone(state),
      async execute(command) {
        if (closed) throw new Error('closed')
        calls.push(command.action)
        if (command.action === 'save-model-source') {
          Object.assign(source, command.values)
          state.managed.configured = { ...source }
          state.managed.restartRequired = true
        }
        if (command.action === 'managed-login') state.managed.restartRequired = true
        if (command.action === 'refresh')
          await new Promise<void>((resolve) => {
            release = resolve
          })
        return { status: 'ok', message: '', data: {} }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      presentStore() {
        if (closed) throw new Error('closed')
      },
      simulatorStatus: () => ({ running: false, port: 0, url: '', error: '' }),
      assistPlatformSnapshot: () => ({ workspaceId: state.workspaceId, stores: [] }),
      refreshAssistPlatform: async () => ({ workspaceId: state.workspaceId, stores: [] }),
      openAssistPlatformItem: async () => {},
      setAssistPlatformActive: () => {},
      openSimulatorPage: async () => ({ ok: false, message: '' }),
      async dispose() {
        calls.push('dispose')
        closed = true
      },
    }
    // Expose state mutation through the ordinary controller command above.
    instances.push(runtime)
    return runtime
  }
  const manager = createWorkspaceRuntime({ factory })
  const command = (action: BackendCommand['action'], values = {}): BackendCommand => ({
    workspaceId: manager.snapshot().workspaceId,
    action,
    values,
  })
  return {
    manager,
    command,
    calls,
    instances,
    source,
    fail(value: boolean) {
      failStart = value
    },
    unblock() {
      release?.()
    },
    pauseStartup() {
      pauseStart = true
    },
    resumeStartup() {
      resumeStart?.()
    },
  }
}

describe('workspace runtime activation', () => {
  it('stops old platform sync during activation and restores an open assist window on replacement', async () => {
    const f = fixture()
    const oldActive = vi.spyOn(f.instances[0], 'setAssistPlatformActive')
    f.manager.setAssistPlatformActive(true)
    f.pauseStartup()
    const activation = f.manager.execute(f.command('activate-model-source', { mode: 'managed' }))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(oldActive).toHaveBeenLastCalledWith(false)
    const nextActive = vi.spyOn(f.instances[1], 'setAssistPlatformActive')
    f.resumeStartup()
    await activation
    expect(nextActive).toHaveBeenCalledWith(true)
    await f.manager.dispose()
  })
  it('keeps snapshots empty if shutdown races a replacement startup', async () => {
    const f = fixture()
    f.pauseStartup()
    const activation = f.manager.execute(f.command('activate-model-source', { mode: 'managed' }))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    const closing = f.manager.dispose()
    f.resumeStartup()
    await activation
    expect(f.manager.snapshot().stores).toEqual([])
    await closing
  })
  it('clears business snapshots immediately when shutdown starts', async () => {
    const f = fixture()
    expect(f.manager.snapshot().stores).toHaveLength(1)
    const closing = f.manager.dispose()
    expect(f.manager.snapshot().stores).toEqual([])
    await expect(f.manager.execute(f.command('refresh'))).rejects.toThrow('关闭')
    await closing
  })

  it('rebuilds for source changes and rejects commands queued for the old workspace', async () => {
    const f = fixture()
    await f.manager.start()
    const events: string[] = []
    f.manager.subscribe((event) => events.push(event.type))
    const old = f.command('refresh')
    const activation = f.manager.execute(f.command('activate-model-source', { mode: 'managed' }))
    const queued = f.manager.execute(old)
    await activation
    await expect(queued).rejects.toThrow('重启')
    expect(f.manager.snapshot().managed.active.mode).toBe('managed')
    expect(f.calls).toEqual(['save-model-source', 'dispose'])
    expect(events).toContain('workspace:changed')
    await expect(f.manager.execute(old)).rejects.toThrow('重启')
    await f.manager.dispose()
  })

  it('preserves the configured origins and forbids renderer origin overrides', async () => {
    const f = fixture()
    await expect(
      f.manager.execute(
        f.command('activate-model-source', { mode: 'managed', apiOrigin: 'https://evil.test' }),
      ),
    ).rejects.toThrow()
    expect(f.calls).toEqual([])
    await f.manager.execute(f.command('activate-model-source', { mode: 'managed' }))
    expect(f.source.apiOrigin).toBe('https://api-kefu.lttlt.top')
  })

  it('reloads the same mode after an identity change, but leaves an unchanged workspace alone', async () => {
    const f = fixture()
    const original = f.manager.snapshot().workspaceId
    await f.manager.execute(f.command('activate-model-source', { mode: 'local' }))
    expect(f.manager.snapshot().workspaceId).toBe(original)
    await f.manager.execute(f.command('managed-login'))
    await f.manager.execute(f.command('activate-model-source', { mode: 'local' }))
    expect(f.manager.snapshot().workspaceId).not.toBe(original)
    expect(f.instances).toHaveLength(2)
  })

  it('serializes in-flight business operations before disposing their workspace', async () => {
    const f = fixture()
    const refresh = f.manager.execute(f.command('refresh'))
    await Promise.resolve()
    const activation = f.manager.execute(f.command('activate-model-source', { mode: 'managed' }))
    expect(f.calls).toEqual(['refresh'])
    f.unblock()
    await refresh
    await activation
    expect(f.calls).toEqual(['refresh', 'save-model-source', 'dispose'])
  })

  it('fails closed after startup failure, invalidates old commands and allows activation retry', async () => {
    const f = fixture()
    const old = f.command('save-model-settings')
    f.fail(true)
    await expect(
      f.manager.execute(f.command('activate-model-source', { mode: 'managed' })),
    ).rejects.toThrow('start failed')
    expect(f.manager.snapshot().stores).toEqual([])
    expect(f.manager.snapshot().managed.restartRequired).toBe(true)
    await expect(f.manager.execute(old)).rejects.toThrow('重启')
    await expect(f.manager.execute(f.command('save-model-settings'))).rejects.toThrow('不可用')
    f.fail(false)
    await f.manager.execute(f.command('activate-model-source', { mode: 'managed' }))
    expect(f.manager.snapshot().managed.restartRequired).toBe(false)
    expect(f.manager.snapshot().managed.active.mode).toBe('managed')
  })
})
