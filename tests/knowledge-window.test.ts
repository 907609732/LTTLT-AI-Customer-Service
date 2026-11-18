import { describe, expect, it, vi } from 'vitest'
import { createKnowledgeWindow } from '../electron/knowledge-window'
import { registerKnowledgeIpc } from '../electron/knowledge-ipc'
function fixture() {
  const handlers = new Map<string, (event: { preventDefault(): void }) => void>()
  const win = {
    isDestroyed: () => false,
    setBounds: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    on: (event: string, fn: (event: { preventDefault(): void }) => void) => handlers.set(event, fn),
    webContents: { send: vi.fn() },
  }
  let workspaceId = 'w'
  const create = vi.fn(() => win)
  const manager = createKnowledgeWindow({
    create,
    load: async () => {},
    workArea: () => ({ x: 10, y: 20, width: 900, height: 650 }),
    workspace: () => workspaceId,
    stores: () => ['a', 'b'],
  })
  return {
    manager,
    create,
    win,
    handlers,
    switch: () => {
      workspaceId = 'new'
    },
  }
}
describe('trusted knowledge window', () => {
  it('accepts only the owner returned new context after restore and does not treat it as a late old result', async () => {
    const f = fixture(),
      handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
    await f.manager.open({ workspaceId: 'w', storeId: 'a' })
    let workspaceId = 'w'
    const dispose = registerKnowledgeIpc({
      ipc: { handle: (n, h) => handlers.set(n, h), removeHandler: (n) => handlers.delete(n) },
      authorize() {},
      window: f.manager,
      resolve: () => ({
        workspaceId,
        request: async () => {
          throw Error('must not restore inside disposed runtime')
        },
      }),
      restore: async () => {
        f.switch()
        workspaceId = 'new'
        return { workspaceId, recovered: false, message: 'restored' }
      },
    })
    const result = await handlers.get('knowledge:request')!(
      {},
      { workspaceId: 'w', operation: 'restore', token: 'main-owned' },
    )
    expect(result).toMatchObject({
      workspaceId: 'new',
      context: { workspaceId: 'new', storeId: 'a' },
    })
    expect(() =>
      handlers.get('knowledge:request')!(
        {},
        { workspaceId: 'w', operation: 'restore', token: 'main-owned' },
      ),
    ).toThrow('工作区')
    dispose()
  })
  it('focuses one clamped window with explicit local shop context; close waits for draft then hides', async () => {
    const f = fixture()
    await f.manager.open({ workspaceId: 'w', storeId: 'a' })
    await f.manager.open({
      workspaceId: 'w',
      storeId: 'b',
      tab: 'training',
      productId: 'sku-b',
    })
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.manager.context()).toMatchObject({
      storeId: 'b',
      tab: 'training',
      productId: 'sku-b',
      revision: 2,
    })
    expect(f.win.webContents.send).toHaveBeenLastCalledWith(
      'knowledge:context',
      expect.objectContaining({ tab: 'training', productId: 'sku-b' }),
    )
    expect(f.win.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 900, height: 650 })
    const preventDefault = vi.fn()
    f.handlers.get('close')?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(f.win.webContents.send).toHaveBeenCalledWith('knowledge:close-request')
    f.manager.hide('w')
    expect(f.win.hide).toHaveBeenCalledOnce()
    f.switch()
    await expect(f.manager.open({ workspaceId: 'w', storeId: 'a' })).rejects.toThrow()
    f.manager.dispose()
    expect(f.win.destroy).toHaveBeenCalledOnce()
  })
  it('authorizes before parsing and drops a late response after account switch', async () => {
    const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
    let current = 'w',
      allowed = false
    const dispose = registerKnowledgeIpc({
      ipc: {
        handle: (name, handler) => handlers.set(name, handler),
        removeHandler: (name) => handlers.delete(name),
      },
      authorize: () => {
        if (!allowed) throw Error('untrusted')
      },
      resolve: () => ({
        workspaceId: current,
        request: async () => {
          current = 'new'
          return 'private'
        },
      }),
      window: fixture().manager,
    })
    expect(() => handlers.get('knowledge:request')?.({}, {})).toThrow('untrusted')
    allowed = true
    await expect(
      handlers.get('knowledge:request')?.(
        {},
        { workspaceId: 'w', operation: 'query', query: { type: 'summary' } },
      ),
    ).rejects.toThrow('工作区')
    dispose()
    expect(handlers.size).toBe(0)
  })
})
