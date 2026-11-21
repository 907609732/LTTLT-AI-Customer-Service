import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, onBeforeRouteLeave } from 'vue-router'
import { h, ref } from 'vue'
import ElementPlus from 'element-plus'
import MainLayout from '../src/app/layouts/MainLayout.vue'
import ContactQrDialog from '../src/shared/ui/ContactQrDialog.vue'
import { routes } from '../src/app/router'
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
  const blockLeaving = ref(false)
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
  const listenerProbe = {
    template:
      '<div><span data-listener-probe>{{ Object.keys($attrs).sort().join(",") }}</span></div>',
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/shop/recharge',
        name: 'shop-recharge',
        component: { template: '<div>充值页</div>' },
      },
      {
        path: '/',
        component: MainLayout,
        children: [
          { path: '', component: { template: '<div>店铺内容</div>' } },
          { path: 'listener-probe', component: listenerProbe },
          {
            path: 'shop/manage',
            name: 'shop-manage',
            component: listenerProbe,
          },
          { path: 'settings', component: { template: '<div />' } },
          {
            path: 'knowledge',
            component: {
              setup() {
                onBeforeRouteLeave(() => !blockLeaving.value)
                return () => h('div', '知识库编辑器')
              },
            },
          },
        ],
      },
    ],
  })
  await router.push('/')
  const wrapper = mount(
    { template: '<router-view />' },
    {
      global: {
        plugins: [pinia, router, ElementPlus],
        stubs: {
          AddShopDialog: true,
          QuickReplyDialog: true,
          ScheduledTasksDialog: true,
          LoginDialog: true,
        },
      },
    },
  )
  wrappers.push(wrapper)
  await wrapper.find('[role="tab"]').trigger('click')
  await flushPromises()
  return { wrapper, runtime, run, present, router, blockLeaving, setup: useShopSetupStore() }
}
it('知识库阻止离开时不执行开店，也不让原生页面覆盖未保存草稿', async () => {
  const { wrapper, router, blockLeaving, run, present } = await fixture()
  await router.push('/knowledge')
  blockLeaving.value = true
  run.mockClear()
  await wrapper.findComponent(StoreSidebarCard).vm.$emit('open')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/knowledge')
  expect(run).not.toHaveBeenCalled()
  expect(present).toHaveBeenLastCalledWith('shop-a', false)
  expect(wrapper.text()).toContain('知识库编辑器')
})
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
  expect(wrapper.find('header [aria-label="回复监控"]').exists()).toBe(false)
  expect(wrapper.find('footer.sidebar-footer [aria-label="回复监控"]').exists()).toBe(true)
})

it('添加客服复用共享联系方式弹窗，并让原生店铺页避开弹窗', async () => {
  const { wrapper, present } = await fixture()
  const contact = wrapper.findAll('button').find((item) => item.text().includes('添加客服'))!
  await contact.trigger('click')
  await flushPromises()
  expect(wrapper.findComponent(ContactQrDialog).props('modelValue')).toBe(true)
  expect(present).toHaveBeenLastCalledWith('shop-a', false)
  wrapper.findComponent(ContactQrDialog).vm.$emit('update:modelValue', false)
  await flushPromises()
  expect(present).toHaveBeenLastCalledWith('shop-a', true)
})

it('配置中心与其他路由都不再附加 footer 事件监听', async () => {
  const { wrapper, router } = await fixture()
  await router.push('/listener-probe')
  await flushPromises()
  expect(wrapper.get('[data-listener-probe]').text()).toBe('')
  await router.push('/shop/manage')
  await flushPromises()
  expect(wrapper.get('[data-listener-probe]').text()).toBe('')
})

it('店铺导入知识携带点击店铺打开独立知识库，不切换接待', async () => {
  const { wrapper, runtime } = await fixture()
  const selected = runtime.selectedStoreId
  wrapper.findComponent(StoreSidebarCard).vm.$emit('importKnowledge')
  await flushPromises()
  expect(knowledge.open).toHaveBeenLastCalledWith('shop-a')
  expect(runtime.selectedStoreId).toBe(selected)
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

it('配置中心与首页复用同一个工作台，原生店铺页随内容切换隐藏和恢复', async () => {
  const { wrapper, router, runtime, present, run } = await fixture()
  const header = wrapper.get('.workbench-titlebar').element
  const search = wrapper.get('.store-sidebar input')
  await search.setValue('验收')
  const config = wrapper
    .findAll('.top-navigation button')
    .find((button) => button.text() === '配置中心')!
  await config.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/shop/manage')
  expect(wrapper.get('.workbench-titlebar').element).toBe(header)
  expect(wrapper.get('.store-sidebar').attributes('style')).toContain('display: none')
  expect(config.classes()).toContain('active')
  expect(present).toHaveBeenLastCalledWith('shop-a', false)
  await wrapper
    .findAll('.top-navigation button')
    .find((button) => button.text() === '店铺首页')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.get('.workbench-titlebar').element).toBe(header)
  expect(wrapper.get('.store-sidebar').attributes('style') ?? '').not.toContain('display: none')
  expect((wrapper.get('.store-sidebar input').element as HTMLInputElement).value).toBe('验收')
  expect(runtime.platformStoreId).toBe('shop-a')
  expect(present).toHaveBeenLastCalledWith('shop-a', true)
  expect(run).not.toHaveBeenCalled()
})
it('正式配置中心路由归属工作台外壳，保持原有链接地址', () => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const home = router.resolve('/')
  const configuration = router.resolve('/shop/manage?panel=shops')
  expect(configuration.matched).toHaveLength(2)
  expect(configuration.matched[0]).toBe(home.matched[0])
  expect(configuration.name).toBe('shop-manage')
  expect(configuration.query.panel).toBe('shops')
})
