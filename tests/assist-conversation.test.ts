import { expect, it, vi } from 'vitest'
import { createAssistConversationNavigator } from '../electron/assist-conversation'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type { BrowserWindow } from 'electron'

const workspaceId = '1093130e-c6f3-4dc0-9ad8-cfb530c5c017'
function fixture() {
  const snapshot = emptySnapshot()
  snapshot.workspaceId = workspaceId
  snapshot.stores = [
    {
      id: 'store-b',
      storeName: '测试店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  snapshot.conversations = [
    { storeId: 'store-b', uid: 'buyer-b', name: '测试顾客', status: 'pending', messages: [] },
  ]
  const execute = vi.fn().mockResolvedValue({ status: 'ok' })
  const primary = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
  const load = vi.fn().mockResolvedValue(undefined)
  const navigate = createAssistConversationNavigator({
    runtime: () => ({ snapshot: () => snapshot, execute }),
    primary: () => primary as unknown as BrowserWindow,
    load,
  })
  return {
    snapshot,
    execute,
    primary,
    load,
    navigate,
    input: { workspaceId, storeId: 'store-b', conversationId: 'buyer-b' },
  }
}
it('定位后回到首页指定店铺并唤起主窗，不启AI或发送', async () => {
  const { navigate, input, execute, load, primary, snapshot } = fixture()
  await navigate(input)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledWith({
    action: 'focus-conversation',
    ...input,
    values: {},
  })
  const route = load.mock.calls[0][1] as string
  expect(new URL('https://fixture.invalid/' + route).searchParams.get('assistStore')).toBe(
    'store-b',
  )
  expect(route).not.toContain('buyer-b')
  expect(primary.restore).toHaveBeenCalledOnce()
  expect(primary.show).toHaveBeenCalledOnce()
  expect(primary.focus).toHaveBeenCalledOnce()
  expect(snapshot.stores[0].aiEnabled).toBe(false)
})
it('拒绝旧工作区、未知会话及离线店铺，不打开主窗', async () => {
  const { navigate, input, snapshot, load, execute } = fixture()
  await expect(
    navigate({ ...input, workspaceId: '35b50079-de77-4328-811d-35eb4e9cc848' }),
  ).rejects.toThrow('工作区已切换')
  await expect(navigate({ ...input, conversationId: 'unknown' })).rejects.toThrow('会话不存在')
  snapshot.stores[0].runtime.online = false
  await expect(navigate(input)).rejects.toThrow('店铺未连接')
  expect(load).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})
it('定位期间切工作区或适配器失败不展示旧平台', async () => {
  const { navigate, input, snapshot, load, execute } = fixture()
  execute.mockImplementationOnce(async () => {
    snapshot.workspaceId = 'changed'
    return {}
  })
  await expect(navigate(input)).rejects.toThrow('工作区已切换')
  expect(load).not.toHaveBeenCalled()
  snapshot.workspaceId = workspaceId
  execute.mockRejectedValueOnce(new Error('平台会话不可用'))
  await expect(navigate(input)).rejects.toThrow('平台会话不可用')
  expect(load).not.toHaveBeenCalled()
})
