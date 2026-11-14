import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { registerPlatformFeatureIpc } from '../electron/platform-feature-ipc'
import type { LocalRuntime } from '../electron/local-runtime'
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (event: unknown, input: unknown) => Promise<unknown>) =>
      fake.handlers.set(name, fn),
    removeHandler: (name: string) => fake.handlers.delete(name),
  },
}))
describe('真实平台功能IPC边界', () => {
  it('验证可信frame及工作区，并丢弃切换后晚到结果', async () => {
    let workspaceId = randomUUID()
    const original = workspaceId,
      authorize = vi.fn()
    const request = vi.fn(async () => ({
      workspaceId,
      storeId: 'store-a',
      report: null,
      task: null,
    }))
    const runtime = {
      snapshot: () => ({ workspaceId }),
      platformOrders: () => ({ execute: request }),
    } as unknown as LocalRuntime
    const dispose = registerPlatformFeatureIpc({ runtime, authorize })
    const invoke = (id: string) =>
      fake.handlers.get('platform-orders:request')!(
        {},
        { type: 'snapshot', workspaceId: id, storeId: 'store-a' },
      )
    await expect(invoke(original)).resolves.toMatchObject({ workspaceId: original })
    expect(authorize).toHaveBeenCalledOnce()
    await expect(invoke(randomUUID())).rejects.toThrow('工作区')
    expect(request).toHaveBeenCalledOnce()
    request.mockImplementationOnce(async () => {
      workspaceId = randomUUID()
      return { workspaceId, storeId: 'store-a', report: null, task: null }
    })
    await expect(invoke(original)).rejects.toThrow('工作区')
    dispose()
    expect(fake.handlers.size).toBe(0)
  })
})
