import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { PlatformItem, PlatformItemsSnapshot } from '../src/shared/contracts/platform-items'
import { createAssistDetailCatalog } from '../electron/runtime/assist-detail-catalog'
import { createAssistRuntime } from '../electron/runtime/assist-runtime'

const ticket: PlatformItem = {
  id: 't1',
  storeId: 's1',
  platform: 'pdd-web',
  kind: 'ticket',
  title: '退款工单',
  status: '待处理',
  orderNo: '202611180001',
  detailKey: 't1',
}
const detail = 'https://mms.pinduoduo.com/aftersales/work_order/tododetail?id=t1'
const snapshot = (
  status: 'success' | 'syncing',
  items: PlatformItem[] = [ticket],
): PlatformItemsSnapshot => ({
  workspaceId: 'workspace',
  stores: [
    {
      storeId: 's1',
      storeName: '测试店',
      platform: 'pdd-web',
      kind: 'ticket',
      status,
      message: '',
      total: items.length,
      complete: true,
      items,
    },
  ],
})

describe('辅助中心详情发布', () => {
  it('only exposes an observed detail after a successful row is published', () => {
    const catalog = createAssistDetailCatalog()
    catalog.remember('s1', 'ticket', 't1', detail)
    expect(catalog.target('s1', 'ticket', 't1', snapshot('success'))).toBeUndefined()
    catalog.publish(snapshot('success'))
    expect(catalog.target('s1', 'ticket', 't1', snapshot('success'))).toBe(detail)
    expect(catalog.target('s1', 'ticket', 't1', snapshot('syncing'))).toBeUndefined()
    expect(catalog.target('s1', 'ticket', 't1', snapshot('success', []))).toBeUndefined()
  })

  it('drops a published detail when the next snapshot no longer contains the row', () => {
    const catalog = createAssistDetailCatalog()
    catalog.remember('s1', 'ticket', 't1', detail)
    catalog.publish(snapshot('success'))
    expect(catalog.target('s1', 'ticket', 't1', snapshot('success'))).toBe(detail)
    const empty = snapshot('success', [])
    catalog.publish(empty)
    expect(catalog.target('s1', 'ticket', 't1', empty)).toBeUndefined()
  })
})

describe('辅助中心工作区门', () => {
  it('rejects refresh and detail open after the workspace lease changes', async () => {
    const workspaceId = randomUUID()
    const changed = vi.fn()
    const runtime = createAssistRuntime({
      workspaceId,
      namespace: 'workspace',
      getParent: () => undefined,
      stores: () => [{ id: 's1', storeName: '测试店', platform: 'pdd-web' }],
      isActive: () => false,
      changed,
      createWindow: () => {
        throw Error('unused')
      },
      identityScript: () => '',
    })
    await expect(runtime.refresh({ workspaceId, storeId: 's1' })).rejects.toThrow(
      '店铺工作区已改变',
    )
    await expect(
      runtime.openItem({ workspaceId, storeId: 's1', kind: 'ticket', id: 't1' }),
    ).rejects.toThrow('店铺工作区已改变')
    expect(changed).not.toHaveBeenCalled()
  })

  it('rejects unsupported platforms and unpublished details before opening a page', async () => {
    const workspaceId = randomUUID()
    const base = {
      workspaceId,
      namespace: 'workspace',
      getParent: () => undefined,
      isActive: () => true,
      changed: () => {},
      createWindow: () => {
        throw Error('unused')
      },
      identityScript: () => '',
    }
    const doudian = createAssistRuntime({
      ...base,
      stores: () => [{ id: 's1', storeName: '抖店', platform: 'doudian-client' }],
    })
    await expect(doudian.openItem({ workspaceId, storeId: 's1', kind: 'ticket' })).rejects.toThrow(
      '抖店平台工单和售后暂未接入',
    )
    const pdd = createAssistRuntime({
      ...base,
      stores: () => [{ id: 's1', storeName: '拼多多', platform: 'pdd-web' }],
    })
    await expect(
      pdd.openItem({ workspaceId, storeId: 's1', kind: 'ticket', id: 't1' }),
    ).rejects.toThrow('详情页面不可用')
  })
})
