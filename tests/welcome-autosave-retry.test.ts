import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import { expect, it, vi } from 'vitest'
import ShopOpsPanel from '../src/modules/reception/components/ShopOpsPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import type { BackendResult } from '../src/shared/contracts/backend'
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => ({ isElectron: false }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
it('retries the same queued welcome draft after the preceding save fails', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.workspaceId = 'welcome-retry'
  let reject!: (cause: Error) => void
  const first = new Promise<BackendResult>((_resolve, fail) => {
    reject = fail
  })
  const run = vi
    .spyOn(runtime, 'run')
    .mockReturnValueOnce(first)
    .mockResolvedValue({
      status: 'ok',
      message: '已保存',
      data: { text: 'B', enabled: false, delayMinSeconds: 1, delayMaxSeconds: 3, version: 1 },
    })
  const success = vi.spyOn(ElMessage, 'success')
  const wrapper = mount(ShopOpsPanel, {
    props: { viewKey: 'welcome', storeId: 's', embedded: true },
    global: { plugins: [ElementPlus] },
  })
  try {
    const text = wrapper.get('textarea[aria-label="文字欢迎语"]')
    await text.setValue('A')
    await text.trigger('blur')
    await text.setValue('B')
    await text.trigger('blur')
    reject(new Error('首次保存失败'))
    await flushPromises()
    expect(success).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('首次保存失败')
    await text.trigger('blur')
    await flushPromises()
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]![0].values).toMatchObject({ text: 'B', version: 0 })
    expect(success).toHaveBeenCalledWith('保存成功')
  } finally {
    wrapper.unmount()
    ElMessage.closeAll()
    vi.restoreAllMocks()
  }
})
