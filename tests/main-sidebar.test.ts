import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import MainLayout from '../src/app/layouts/MainLayout.vue'
import StoreSidebarCard from '../src/modules/shops/components/StoreSidebarCard.vue'
import { useShopSetupStore } from '../src/modules/shops/setup-store'
import { useRuntimeStore } from '../src/shared/state/runtime'

const knowledge = vi.hoisted(() => ({ open: vi.fn(async () => {}) }))
vi.mock('../src/modules/knowledge/manager-service', () => ({
  openKnowledgeManager: knowledge.open,
  createKnowledgeClient: vi.fn(),
}))

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})
async function fixture() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'sidebar-workspace'
  runtime.snapshot.stores = [
    {
      id: 'shop-a',
      storeName: '验收店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  runtime.platformStoreId = 'shop-a'
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  const present = vi.spyOn(runtime, 'presentStore').mockResolvedValue(undefined)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/settings'].map((path) => ({ path, component: { template: '<div />' } })),
  })
  await router.push('/')
  const wrapper = mount(MainLayout, {
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: {
        AddShopDialog: true,
        QuickReplyDialog: true,
        ScheduledTasksDialog: true,
        LoginDialog: true,
      },
    },
  })
  wrappers.push(wrapper)
  await wrapper.find('[role="tab"]').trigger('click')
  await flushPromises()
  return { wrapper, runtime, run, present, router, setup: useShopSetupStore() }
}
it('基础设置隐藏原生页面，关闭引导后恢复，不顺带打开或启用AI', async () => {
  const { wrapper, run, present, setup } = await fixture()
  wrapper.findComponent(StoreSidebarCard).vm.$emit('setup')
  await flushPromises()
  expect(setup.visible).toBe(true)
  expect(setup.storeId).toBe('shop-a')
  expect(present).toHaveBeenLastCalledWith('shop-a', false)
  expect(wrapper.find('aside.store-sidebar').attributes('inert')).toBeUndefined()
  expect(wrapper.find('header.workbench-titlebar').attributes('inert')).toBeUndefined()
  expect(wrapper.find('main.workbench-main').attributes('inert')).toBeDefined()
  expect(run).not.toHaveBeenCalled()
  setup.finish()
  await flushPromises()
  expect(present).toHaveBeenLastCalledWith('shop-a', true)
})
it('引导显示时点击左侧店铺，可退出引导并显示所选店铺', async () => {
  const { wrapper, setup, runtime, present } = await fixture()
  setup.open('shop-a')
  await flushPromises()
  wrapper.findComponent(StoreSidebarCard).vm.$emit('open')
  await flushPromises()
  expect(setup.visible).toBe(false)
  expect(runtime.platformStoreId).toBe('shop-a')
  expect(present).toHaveBeenLastCalledWith('shop-a', true)
})
it('后台动作独立于聊天；关闭断开而不删除店铺知识记录', async () => {
  const { wrapper, run, runtime } = await fixture()
  const card = wrapper.findComponent(StoreSidebarCard)
  card.vm.$emit('backend')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({ action: 'open-store-backend', storeId: 'shop-a' })
  card.vm.$emit('close')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({ action: 'close-store', storeId: 'shop-a' })
  expect(runtime.snapshot.stores).toHaveLength(1)
  expect(runtime.platformStoreId).toBe('')
  expect(
    run.mock.calls.some(([command]) =>
      ['set-ai', 'remove-store', 'open-store'].includes(command.action),
    ),
  ).toBe(false)
})
it('切换工作区后晚到的打开结果不会重新展示旧店铺', async () => {
  const { wrapper, run, runtime, present } = await fixture()
  let done!: () => void
  run.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      done = resolve
    })
    return { status: 'ok', message: '', data: {} }
  })
  wrapper.findComponent(StoreSidebarCard).vm.$emit('open')
  await flushPromises()
  runtime.snapshot.workspaceId = 'new-workspace'
  runtime.snapshot.stores = []
  runtime.platformStoreId = ''
  await flushPromises()
  present.mockClear()
  done()
  await flushPromises()
  expect(runtime.platformStoreId).toBe('')
  expect(present).not.toHaveBeenCalledWith('shop-a', true)
})
it('设置页点击卡片先返回工作台，再展示平台页', async () => {
  const { wrapper, router, present } = await fixture()
  await router.push('/settings')
  await flushPromises()
  expect(present).toHaveBeenLastCalledWith('shop-a', false)
  wrapper.findComponent(StoreSidebarCard).vm.$emit('open')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/')
  expect(present).toHaveBeenLastCalledWith('shop-a', true)
})

it('单店模式切换只调用指定命令，主入口打开回复监控', async () => {
  const { wrapper, run } = await fixture()
  wrapper.findComponent(StoreSidebarCard).vm.$emit('sendMode', 'auto')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'set-store-send-mode',
    values: { storeId: 'shop-a', mode: 'auto' },
  })
  await wrapper.get('[aria-label="回复监控"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({ action: 'open-reply-monitor' })
})

it('店铺导入知识携带点击店铺打开独立知识库，不切换接待', async () => {
  const { wrapper, runtime } = await fixture()
  const selected = runtime.selectedStoreId
  wrapper.findComponent(StoreSidebarCard).vm.$emit('importKnowledge')
  await flushPromises()
  expect(knowledge.open).toHaveBeenLastCalledWith('shop-a')
  expect(runtime.selectedStoreId).toBe(selected)
})

it('点击已开启的店铺 AI 开关会通过现有命令关闭整店 AI', async () => {
  const { wrapper, runtime, run } = await fixture()
  runtime.snapshot.stores[0]!.aiEnabled = true
  await flushPromises()
  wrapper.findComponent(StoreSidebarCard).vm.$emit('toggleAi')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'set-ai',
    storeId: 'shop-a',
    values: { enabled: false },
  })
})

it('店铺 AI 关闭后点击侧栏开关会调用原 set-ai 命令重新开启', async () => {
  const { wrapper, run } = await fixture()
  wrapper.findComponent(StoreSidebarCard).vm.$emit('toggleAi')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'set-ai',
    storeId: 'shop-a',
    values: { enabled: true },
  })
})

it('待恢复店铺点击实际关闭的 AI 开关会取消恢复而非另发开启', async () => {
  const { wrapper, runtime, run } = await fixture()
  runtime.snapshot.stores[0]!.aiRestore = {
    desiredEnabled: true,
    status: 'waiting',
    message: '等待登录',
  }
  await flushPromises()
  wrapper.findComponent(StoreSidebarCard).vm.$emit('toggleAi')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'set-ai',
    storeId: 'shop-a',
    values: { enabled: false },
  })
})
