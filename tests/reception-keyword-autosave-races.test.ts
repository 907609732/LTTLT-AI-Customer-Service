import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ShopOpsPanel from '../src/modules/reception/components/ShopOpsPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import type { BackendResult } from '../src/shared/contracts/backend'

vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => ({ isElectron: false }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
async function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'keyword-races'
  runtime.available = true
  runtime.snapshot.config.safety.manualReplyKeywords = ['A']
  const wrapper = mount(ShopOpsPanel, {
    props: { storeId: 'test-store', viewKey: 'transfer', embedded: true },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const resolvers: ((result: BackendResult) => void)[] = []
  const run = vi
    .spyOn(runtime, 'run')
    .mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)))
  return { wrapper, run, resolvers }
}
const ok = (): BackendResult => ({ status: 'ok', message: '保存成功', data: {} })
it('saving B then blurring reverted A persists the latest A after B completes', async () => {
  const { wrapper, run, resolvers } = await fixture()
  const input = wrapper.get('textarea[aria-label="客服接管关键词"]')
  await input.setValue('B')
  await input.trigger('blur')
  await input.setValue('A')
  await input.trigger('blur')
  expect(run).toHaveBeenCalledTimes(1)
  resolvers.shift()!(ok())
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[1]![0].values).toMatchObject({ keywords: ['A'], expectedKeywords: ['B'] })
  resolvers.shift()!(ok())
  await flushPromises()
})
it('rapid off then on persists the final on after the off request completes', async () => {
  const { wrapper, run, resolvers } = await fixture()
  const control = wrapper
    .findAllComponents({ name: 'ElSwitch' })
    .find((item) => item.classes().includes('keyword-switch-handoff'))!
  control.vm.$emit('update:modelValue', false)
  control.vm.$emit('change', false)
  await flushPromises()
  control.vm.$emit('update:modelValue', true)
  control.vm.$emit('change', true)
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  resolvers.shift()!(ok())
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[1]![0].values).toMatchObject({ enabled: true, expectedEnabled: false })
  resolvers.shift()!(ok())
  await flushPromises()
})
it('rapid custom then inherit saves the final inherit choice', async () => {
  const { wrapper, run, resolvers } = await fixture()
  const control = wrapper
    .findAllComponents({ name: 'ElSwitch' })
    .find((item) => item.classes().includes('store-inherit-switch'))!
  control.vm.$emit('update:modelValue', false)
  control.vm.$emit('change', false)
  await flushPromises()
  control.vm.$emit('update:modelValue', true)
  control.vm.$emit('change', true)
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  resolvers.shift()!(ok())
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[1]![0].values).toEqual({ mode: 'inherit' })
  resolvers.shift()!(ok())
  await flushPromises()
})
