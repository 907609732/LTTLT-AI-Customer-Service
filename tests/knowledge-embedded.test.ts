import { expect, it, vi } from 'vitest'
import { createKnowledgeWindow } from '../electron/knowledge-window'

it('知识库内嵌宿主只通知主窗口导航，保留上下文且不创建独立窗口', async () => {
  const publish = vi.fn(),
    open = vi.fn(),
    hide = vi.fn()
  let workspace = 'w'
  const manager = createKnowledgeWindow({
    workspace: () => workspace,
    stores: () => ['a', 'b'],
    embedded: { publish, open, hide },
  })
  await manager.open({ workspaceId: 'w', storeId: 'b', tab: 'training', productId: 'p' })
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ storeId: 'b', tab: 'training', productId: 'p', revision: 1 }),
  )
  expect(publish).toHaveBeenCalledWith(manager.context())
  workspace = 'new'
  manager.rebind('new', 'b')
  expect(manager.context()).toMatchObject({
    workspaceId: 'new',
    storeId: 'b',
    productId: '',
    revision: 2,
  })
  expect(() => manager.hide('w')).toThrow('工作区')
  await expect(manager.open({ workspaceId: 'new', storeId: 'removed' })).rejects.toThrow('店铺')
  manager.hide('new')
  expect(hide).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'new' }))
  manager.dispose()
  await expect(manager.open({ workspaceId: 'new', storeId: 'b' })).rejects.toThrow()
})
