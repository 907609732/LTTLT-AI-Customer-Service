import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ReplyMonitorView from '../src/modules/auxiliary/components/ReplyMonitorView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import type { DesktopApi } from '../src/shared/contracts/desktop'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  delete window.yunduoDesktop
})
it('源码监控展开 GM 后 Enter 只执行命令，不触发回复批准', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = '00000000-0000-4000-8000-000000000001'
  runtime.snapshot.stores = [
    {
      id: 'shop',
      storeName: '测试店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: true,
      sendMode: 'review',
      runtime: { open: true, online: true },
    },
  ]
  runtime.snapshot.review.replies = [
    {
      id: 'reply',
      at: 1,
      storeId: 'shop',
      storeName: '测试店',
      uid: 'buyer',
      buyerName: '测试顾客',
      text: '这是待确认的回复',
      traceId: '',
      status: 'pending',
      reason: '等待用户确认',
    },
  ]
  const gm = vi.fn(async () => ({ ok: true, text: 'help output' }))
  const expand = vi.fn(async (input: { expanded: boolean }) => ({
    expanded: input.expanded,
    width: input.expanded ? 960 : 340,
    height: input.expanded ? 620 : 300,
  }))
  window.yunduoDesktop = {
    isElectron: true,
    developerDebug: {
      expand,
      gm,
      ptyConnect: vi.fn(),
      ptyWrite: vi.fn(),
      ptyResize: vi.fn(),
      ptyDisconnect: vi.fn(),
      onPtyData: () => () => {},
      onPtyExit: () => () => {},
    },
  } as unknown as DesktopApi
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  const wrapper = mount(ReplyMonitorView, { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  expect(wrapper.find('[data-action="developer-toggle"]').exists()).toBe(true)
  await wrapper.get('[data-action="developer-toggle"]').trigger('click')
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
  expect(expand).toHaveBeenLastCalledWith({
    workspaceId: runtime.snapshot.workspaceId,
    expanded: true,
  })
  expect(wrapper.find('[data-panel="debug"]').exists()).toBe(true)
  const input = wrapper.get('[data-gm-input]')
  await input.setValue('help')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(gm).toHaveBeenLastCalledWith({
    workspaceId: runtime.snapshot.workspaceId,
    storeId: 'shop',
    input: 'help',
  })
  expect(run).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('help output')
  await wrapper.get('[data-action="approve"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'review-reply',
    values: { id: 'reply', approve: true },
  })
})

it('开发调试入口只在 main 提供的源码能力存在时显示', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useRuntimeStore().snapshot.workspaceId = '00000000-0000-4000-8000-000000000002'
  const wrapper = mount(ReplyMonitorView, { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  expect(wrapper.find('[data-action="developer-toggle"]').exists()).toBe(false)
  expect(wrapper.find('[data-panel="debug"]').exists()).toBe(false)
})
