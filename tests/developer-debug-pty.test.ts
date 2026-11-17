import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalHost } from '../electron/developer-debug/pty'

class FakePty extends EventEmitter {
  pid = 4242
  writes: string[] = []
  sizes: { cols: number; rows: number }[] = []
  killed = false
  onData = (listener: (data: string) => void) => this.on('data', listener)
  onExit = (listener: (event: { exitCode: number; signal?: number }) => void) =>
    this.on('exit', listener)
  write(data: string) {
    this.writes.push(data)
  }
  resize(cols: number, rows: number) {
    this.sizes.push({ cols, rows })
  }
  kill() {
    this.killed = true
  }
}
function fixture() {
  const instances: FakePty[] = []
  const data = vi.fn()
  const exit = vi.fn()
  const killTree = vi.fn(async () => {
    instances.at(-1)?.emit('exit', { exitCode: 1 })
  })
  const host = createTerminalHost({
    cwd: () => 'C:\\source-project',
    loadPty: async () => ({
      spawn: () => {
        const pty = new FakePty()
        instances.push(pty)
        return pty
      },
    }),
    killProcessTree: killTree,
    onData: data,
    onExit: exit,
  })
  return { host, instances, data, exit, killTree }
}

describe('terminal host', () => {
  it('awaits tree termination before releasing the PTY and never kills after its exit', async () => {
    const pty = new FakePty()
    let finish!: () => void
    const tree = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const host = createTerminalHost({
      cwd: () => '.',
      loadPty: async () => ({ spawn: () => pty }),
      killProcessTree: tree,
      onData: vi.fn(),
      onExit: vi.fn(),
    })
    const session = await host.connect({ ownerId: 1, workspaceId: 'w', cols: 80, rows: 24 })
    let done = false
    const closing = host
      .disconnect({ ownerId: 1, workspaceId: 'w', sessionId: session.sessionId })
      .then(() => {
        done = true
      })
    await Promise.resolve()
    expect(pty.killed).toBe(false)
    expect(done).toBe(false)
    pty.emit('exit', { exitCode: 1 })
    finish()
    await closing
    expect(pty.killed).toBe(false)
    await host.dispose()
  })
  it('does not start automatically and reuses one session for the same owner', async () => {
    const { host, instances } = fixture()
    expect(instances).toHaveLength(0)
    const first = await host.connect({
      ownerId: 7,
      workspaceId: 'workspace-a',
      cols: 80,
      rows: 24,
    })
    expect(instances).toHaveLength(1)
    expect(first.cwd).toBe('C:\\source-project')
    const again = await host.connect({
      ownerId: 7,
      workspaceId: 'workspace-a',
      cols: 100,
      rows: 30,
    })
    expect(instances).toHaveLength(1)
    expect(again.sessionId).toBe(first.sessionId)
    expect(again.reconnected).toBe(true)
    host.dispose()
  })

  it('relays input/output/resize, suppresses stale sessions and keeps the replay buffer bounded', async () => {
    const { host, instances, data } = fixture()
    const session = await host.connect({
      ownerId: 7,
      workspaceId: 'workspace-a',
      cols: 80,
      rows: 24,
    })
    host.write({
      ownerId: 7,
      workspaceId: 'workspace-a',
      sessionId: session.sessionId,
      data: 'echo 中文\r',
    })
    expect(instances[0]!.writes).toEqual(['echo 中文\r'])
    instances[0]!.emit('data', '中文输出\r\n')
    expect(data).toHaveBeenLastCalledWith({ sessionId: session.sessionId, data: '中文输出\r\n' })
    host.resize({
      ownerId: 7,
      workspaceId: 'workspace-a',
      sessionId: session.sessionId,
      cols: 132,
      rows: 43,
    })
    expect(instances[0]!.sizes.at(-1)).toEqual({ cols: 132, rows: 43 })
    for (const cols of [0, -1, 1.5, 501]) {
      expect(() =>
        host.resize({
          ownerId: 7,
          workspaceId: 'workspace-a',
          sessionId: session.sessionId,
          cols,
          rows: 24,
        }),
      ).toThrow()
    }
    for (let i = 0; i < 400; i++) instances[0]!.emit('data', 'x'.repeat(1000))
    const reconnect = await host.connect({
      ownerId: 7,
      workspaceId: 'workspace-a',
      cols: 80,
      rows: 24,
    })
    expect(reconnect.buffer.length).toBeLessThanOrEqual(64 * 1024)
    await host.disconnect({ ownerId: 7, workspaceId: 'workspace-a', sessionId: session.sessionId })
    expect(instances[0]!.killed).toBe(false)
    data.mockClear()
    instances[0]!.emit('data', 'late output')
    expect(data).not.toHaveBeenCalled()
    host.dispose()
  })

  it('ends the process tree on disconnect and does not deliver an old owner output to a new window', async () => {
    const { host, instances, data, killTree, exit } = fixture()
    const old = await host.connect({
      ownerId: 7,
      workspaceId: 'workspace-a',
      cols: 80,
      rows: 24,
    })
    host.write({
      ownerId: 7,
      workspaceId: 'workspace-a',
      sessionId: old.sessionId,
      data: 'dir\r',
    })
    await host.disconnect({ ownerId: 7, workspaceId: 'workspace-a', sessionId: old.sessionId })
    expect(killTree).toHaveBeenCalledWith(4242)
    expect(instances[0]!.killed).toBe(false)
    data.mockClear()
    exit.mockClear()
    instances[0]!.emit('data', 'old window output')
    instances[0]!.emit('exit', { exitCode: 0 })
    expect(data).not.toHaveBeenCalled()

    const fresh = await host.connect({
      ownerId: 8,
      workspaceId: 'workspace-a',
      cols: 80,
      rows: 24,
    })
    expect(fresh.sessionId).not.toBe(old.sessionId)
    expect(() =>
      host.write({
        ownerId: 7,
        workspaceId: 'workspace-a',
        sessionId: old.sessionId,
        data: 'stale',
      }),
    ).toThrow(/会话/)
    host.dispose()
  })

  it('reports spawn failures and never falls back to a fake one-line terminal', async () => {
    const host = createTerminalHost({
      cwd: () => 'C:\\source-project',
      loadPty: async () => ({
        spawn: () => {
          throw new Error('ConPTY unavailable')
        },
      }),
      onData: vi.fn(),
      onExit: vi.fn(),
    })
    await expect(
      host.connect({ ownerId: 1, workspaceId: 'w', cols: 80, rows: 24 }),
    ).rejects.toThrow(/ConPTY unavailable/)
    host.dispose()
  })
})
