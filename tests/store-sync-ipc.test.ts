import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { registerStoreSyncIpc } from '../electron/store-sync-ipc'
import { createStoreSyncClient } from '../src/shared/platform/store-sync'
import type { createStoreSync } from '../electron/store-sync-service'

const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
const request = {
  sourceStoreId: 'a',
  targetStoreIds: ['b'],
  sections: ['welcome'] as const,
  productIds: [],
  conflict: 'skip' as const,
}
describe('store sync IPC boundary', () => {
  function fixture() {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, raw: unknown) => unknown>()
    const service = {
      preview: vi.fn(async () => ({ planId: first, expiresAt: 1, rows: [], warnings: [] })),
      apply: vi.fn(),
      rollback: vi.fn(),
      backups: vi.fn(() => []),
    } as unknown as ReturnType<typeof createStoreSync>
    let workspaceId = first
    const authorize = vi.fn()
    const removeHandler = vi.fn()
    const off = registerStoreSyncIpc({
      ipcMain: {
        handle: (channel, listener) => {
          handlers.set(channel, listener)
        },
        removeHandler,
      },
      authorize,
      resolveCurrent: () => ({ workspaceId, service }),
    })
    const invoke = async (channel: string, raw: unknown) =>
      handlers.get(channel)!({} as IpcMainInvokeEvent, raw)
    return {
      service,
      invoke,
      authorize,
      removeHandler,
      off,
      switch: () => {
        workspaceId = second
      },
    }
  }
  it('authorizes all channels and rejects missing, extra, or stale workspace envelopes', async () => {
    const f = fixture()
    for (const channel of ['preview', 'apply', 'rollback', 'backups']) {
      await expect(f.invoke(`store-sync:${channel}`, { workspaceId: second })).rejects.toThrow(
        '切换',
      )
      await expect(
        f.invoke(`store-sync:${channel}`, { workspaceId: first, extra: true }),
      ).rejects.toThrow()
      await expect(f.invoke(`store-sync:${channel}`, {})).rejects.toThrow()
    }
    expect(f.authorize).toHaveBeenCalledTimes(12)
    expect(f.service.backups).not.toHaveBeenCalled()
    f.off()
    expect(f.removeHandler).toHaveBeenCalledTimes(4)
  })
  it('discards results when account changes during a read', async () => {
    const f = fixture()
    vi.mocked(f.service.preview).mockImplementation(async () => {
      f.switch()
      return { planId: first, expiresAt: 1, rows: [], warnings: [] }
    })
    await expect(
      f.invoke('store-sync:preview', { workspaceId: first, input: request }),
    ).rejects.toThrow('丢弃')
  })
  it('refuses all access from untrusted frames', async () => {
    const f = fixture()
    f.authorize.mockImplementation(() => {
      throw Error('untrusted')
    })
    await expect(f.invoke('store-sync:backups', { workspaceId: first })).rejects.toThrow(
      'untrusted',
    )
    expect(f.service.backups).not.toHaveBeenCalled()
  })
  it('client adds workspace ID and also discards late results', async () => {
    let workspace = first
    const invoke = vi.fn(async () => {
      workspace = second
      return []
    })
    const client = createStoreSyncClient(invoke, () => workspace)
    await expect(client.backups()).rejects.toThrow('丢弃')
    expect(invoke).toHaveBeenCalledWith('store-sync:backups', { workspaceId: first })
  })
})
