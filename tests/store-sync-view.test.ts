import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StoreSyncView from '../src/modules/sync/components/StoreSyncView.vue'
import { installStoreSyncClient } from '../src/modules/sync/services/client'
import { useRuntimeStore } from '../src/shared/state/runtime'
import type { StoreSyncClient, SyncPreview } from '../src/shared/contracts/store-sync'

const planId = '00000000-0000-4000-8000-000000000001'
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
})
function setup(client?: StoreSyncClient) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = planId
  runtime.snapshot.stores = ['a', 'b'].map((id) => ({
    id,
    storeName: `店${id}`,
    platform: 'sim',
    group: '',
    aiEnabled: false,
    runtime: { open: false, online: false },
  }))
  if (client) dispose = installStoreSyncClient(client)
  return { wrapper: mount(StoreSyncView, { global: { plugins: [pinia] } }), runtime }
}
const preview: SyncPreview = {
  planId,
  expiresAt: Date.now() + 60000,
  warnings: ['核对商品编号'],
  rows: [{ storeId: 'b', section: 'products', key: 'sku', action: 'add' }],
}
function clientFixture() {
  return {
    preview: vi.fn(async () => preview),
    apply: vi.fn(async () => ({
      backupId: planId,
      status: 'completed' as const,
      applied: 1,
      restored: 0,
    })),
    rollback: vi.fn(async () => ({
      backupId: planId,
      status: 'rolled-back' as const,
      applied: 1,
      restored: 1,
    })),
    backups: vi.fn(async () => []),
  }
}
describe('store sync independent page', () => {
  it('同一工作区的后台快照刷新不会清除刚返回的同步预览', async () => {
    const client = clientFixture(),
      { wrapper, runtime } = setup(client)
    await flushPromises()
    await wrapper.get('select[aria-label="源店铺"]').setValue('a')
    await wrapper.get('input[type="checkbox"][value="b"]').setValue(true)
    await wrapper.get('textarea').setValue('sku')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('section[aria-label="同步预览"]').exists()).toBe(true)
    runtime.snapshot = { ...runtime.snapshot, revision: runtime.snapshot.revision + 1 }
    await flushPromises()
    expect(wrapper.find('section[aria-label="同步预览"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('shows unavailable and prevents writes without installed platform client', async () => {
    const { wrapper } = setup()
    await flushPromises()
    expect(wrapper.text()).toContain('不能保存')
    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('requires review confirmation and invalidates preview on form changes', async () => {
    const client = clientFixture(),
      { wrapper } = setup(client)
    await flushPromises()
    await wrapper.get('select[aria-label="源店铺"]').setValue('a')
    await wrapper.get('input[type="checkbox"][value="b"]').setValue(true)
    await wrapper.get('textarea').setValue('sku')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(client.preview).toHaveBeenCalledWith({
      sourceStoreId: 'a',
      targetStoreIds: ['b'],
      sections: ['products'],
      productIds: ['sku'],
      conflict: 'skip',
    })
    const apply = wrapper.findAll('button').find((b) => b.text() === '备份并执行同步')!
    expect(apply.attributes('disabled')).toBeDefined()
    await wrapper.get('section[aria-label="同步预览"] input').setValue(true)
    expect(apply.attributes('disabled')).toBeUndefined()
    await wrapper.get('textarea').setValue('sku2')
    expect(wrapper.find('section[aria-label="同步预览"]').exists()).toBe(false)
    expect(client.apply).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('clears private drafts and discards late preview on workspace change', async () => {
    const client = clientFixture()
    let resolve!: (p: SyncPreview) => void
    client.preview.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const { wrapper, runtime } = setup(client)
    await flushPromises()
    await wrapper.get('textarea').setValue('private-sku')
    await wrapper.get('button').trigger('click')
    runtime.snapshot.workspaceId = '00000000-0000-4000-8000-000000000002'
    await flushPromises()
    resolve(preview)
    await flushPromises()
    expect(wrapper.find('section[aria-label="同步预览"]').exists()).toBe(false)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    wrapper.unmount()
  })
})
