import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElInputNumber, ElMessage } from 'element-plus'
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

function receipt(text: string, enabled: boolean, version: number, min = 1, max = 3) {
  return { text, enabled, version, delayMinSeconds: min, delayMaxSeconds: max } as const
}
const ok = (data: Record<string, unknown>): BackendResult => ({
  status: 'ok',
  message: '已保存',
  data,
})

async function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'welcome-autosave'
  runtime.available = true
  runtime.snapshot.stores = [
    {
      id: 'store-a',
      platform: 'sim-local',
      storeName: '自动保存店',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  runtime.snapshot.selection = { storeId: 'store-a', conversationId: '' }
  runtime.snapshot.welcomeByStore = {
    'store-a': { text: 'A', enabled: true, version: 0, delayMinSeconds: 1, delayMaxSeconds: 3 },
  }
  const wrapper = mount(ShopOpsPanel, {
    props: { storeId: 'store-a', viewKey: 'welcome', embedded: true },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const resolvers: ((result: BackendResult) => void)[] = []
  const run = vi.spyOn(runtime, 'run').mockImplementation(
    () =>
      new Promise<BackendResult>((resolve) => {
        resolvers.push(resolve)
      }),
  )
  return { wrapper, run, resolvers }
}

beforeEach(() => {
  vi.spyOn(ElMessage, 'success').mockReturnValue({} as never)
})

it('未修改的失焦不发请求也不提示成功', async () => {
  const { wrapper, run } = await fixture()
  const textarea = wrapper.get('textarea')
  await textarea.trigger('blur')
  await flushPromises()
  expect(run).not.toHaveBeenCalled()
  expect(ElMessage.success).not.toHaveBeenCalled()
})

it('未接入媒体服务的 deferredSave 预览只同步欢迎草稿，不触发保存', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.workspaceId = 'welcome-deferred'
  runtime.snapshot.stores = [
    {
      id: 'store-a',
      platform: 'sim-local',
      storeName: '草稿店',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  runtime.snapshot.selection = { storeId: 'store-a', conversationId: '' }
  runtime.snapshot.welcomeByStore = {}
  const wrapper = mount(ShopOpsPanel, {
    props: {
      storeId: 'store-a',
      viewKey: 'welcome',
      embedded: true,
      deferredSave: true,
      setupDraft: {
        welcome: { text: '导入欢迎', enabled: true },
        handoff: { inherited: true, keywords: [] },
      },
    },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const run = vi.spyOn(runtime, 'run')
  await wrapper.get('textarea[aria-label="文字欢迎语"]').setValue('向导内修改')
  await wrapper.get('textarea[aria-label="文字欢迎语"]').trigger('blur')
  await flushPromises()
  expect(run).not.toHaveBeenCalled()
  expect(wrapper.emitted('update:welcome')?.at(-1)?.[0]).toMatchObject({
    text: '向导内修改',
    enabled: true,
  })
  const media = wrapper.findComponent({ name: 'ReceptionRulesPanel' })
  expect(media.props('mediaAutosave')).toBe(false)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  await flushPromises()
  expect(run).not.toHaveBeenCalled()
})

it('启用开关变化立即自动保存，权威回执后才提示成功', async () => {
  const { wrapper, run, resolvers } = await fixture()
  const control = wrapper.findComponent({ name: 'ElSwitch' })
  control.vm.$emit('update:modelValue', false)
  control.vm.$emit('change', false)
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]![0]).toMatchObject({
    action: 'save-welcome',
    storeId: 'store-a',
    values: { text: 'A', enabled: false, delayMinSeconds: 1, delayMaxSeconds: 3, version: 0 },
  })
  expect(ElMessage.success).not.toHaveBeenCalled()
  resolvers.shift()!(ok(receipt('A', false, 1)))
  await flushPromises()
  expect(ElMessage.success).toHaveBeenCalledTimes(1)
})

it('有效延迟 change/blur 立即保存；回执后重复 blur 为静默 no-op', async () => {
  const { wrapper, run, resolvers } = await fixture()
  const max = wrapper.findAllComponents(ElInputNumber)[1]!
  max.vm.$emit('update:modelValue', 9)
  max.vm.$emit('change', 9)
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]![0].values).toMatchObject({
    delayMinSeconds: 1,
    delayMaxSeconds: 9,
    version: 0,
  })
  resolvers.shift()!(ok(receipt('A', true, 1, 1, 9)))
  await flushPromises()
  max.vm.$emit('blur', new FocusEvent('blur'))
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect(ElMessage.success).toHaveBeenCalledTimes(1)
})

it('A->B->A 在 B 完成后仍以最新 A 和推进后的 CAS 版本保存', async () => {
  const { wrapper, run, resolvers } = await fixture()
  const textarea = wrapper.get('textarea')
  await textarea.setValue('B')
  await textarea.trigger('blur')
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]![0].values).toMatchObject({ text: 'B', version: 0 })

  await textarea.setValue('A')
  await textarea.trigger('blur')
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)

  resolvers.shift()!(ok(receipt('B', true, 1)))
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[1]![0].values).toMatchObject({ text: 'A', version: 1 })
  resolvers.shift()!(ok(receipt('A', true, 2)))
  await flushPromises()
  expect(wrapper.get('textarea').element.value).toBe('A')
  expect(ElMessage.success).toHaveBeenCalledTimes(2)
})

it('保存失败保留草稿、显示错误且不提示成功', async () => {
  const { wrapper, run } = await fixture()
  const textarea = wrapper.get('textarea')
  await textarea.setValue('失败草稿')
  run.mockRejectedValueOnce(new Error('本地服务保存失败'))
  await textarea.trigger('blur')
  await flushPromises()
  expect(wrapper.get('textarea').element.value).toBe('失败草稿')
  expect(wrapper.text()).toContain('本地服务保存失败')
  expect(ElMessage.success).not.toHaveBeenCalled()
})

it('卸载后的迟到成功不提示也不回填', async () => {
  const { wrapper, run, resolvers } = await fixture()
  await wrapper.get('textarea').setValue('卸载前草稿')
  await wrapper.get('textarea').trigger('blur')
  await flushPromises()
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  resolvers.shift()!(ok(receipt('卸载前草稿', true, 1)))
  await flushPromises()
  expect(ElMessage.success).not.toHaveBeenCalled()
  expect(run).toHaveBeenCalledTimes(1)
})
