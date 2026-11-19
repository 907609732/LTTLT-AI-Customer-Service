import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ShopSetupGuide from '../src/modules/shops/components/ShopSetupGuide.vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useShopSetupStore } from '../src/modules/shops/setup-store'

const knowledge = vi.hoisted(() => ({ open: vi.fn(async () => {}) }))
vi.mock('../src/modules/knowledge/manager-service', () => ({
  openKnowledgeManager: knowledge.open,
  createKnowledgeClient: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  knowledge.open.mockClear()
})
function fixture() {
  const runtime = useRuntimeStore()
  runtime.onboardingSupported = true
  runtime.snapshot.workspaceId = 'workspace-a'
  runtime.snapshot.stores.push({
    id: 'shop-a',
    storeName: '店铺A',
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: false, online: false },
  })
  const setup = useShopSetupStore()
  return { runtime, setup }
}
it('固定店铺引导可重开，完成和跳过不会启用AI或修改配置', () => {
  const { runtime, setup } = fixture()
  const run = vi.spyOn(runtime, 'run')
  setup.open('shop-a')
  expect(setup.visible).toBe(true)
  expect(setup.step).toBe(0)
  setup.dismiss()
  expect(setup.storeId).toBe('')
  setup.open('shop-a')
  setup.finish()
  expect(run).not.toHaveBeenCalled()
  expect(runtime.snapshot.stores[0]?.aiEnabled).toBe(false)
})
it('旧桌面没有布局能力时保留原引导，不热加载会被原生网页盖住的新步骤条', async () => {
  const { runtime, setup } = fixture()
  runtime.onboardingSupported = false
  setup.queueAfterLogin('shop-a')
  expect(setup.onboardingPhase).toBeNull()
  runtime.snapshot.stores[0]!.runtime = { open: true, online: true, authenticated: true }
  await nextTick()
  expect(setup.visible).toBe(true)
})
it('新店引导切换目标必须重置旧加载状态与租约，普通基础设置不继承新店阶段', () => {
  const { runtime, setup } = fixture()
  runtime.snapshot.stores.push({ ...runtime.snapshot.stores[0]!, id: 'shop-b', storeName: 'B' })
  setup.queueAfterLogin('shop-a')
  setup.onboardingPhase = 'settings'
  setup.loaded = true
  setup.loading = true
  setup.open('shop-b')
  expect(setup.storeId).toBe('shop-b')
  expect(setup.onboardingPhase).toBeNull()
  expect(setup.loaded).toBe(false)
  expect(setup.loading).toBe(false)
  setup.queueAfterLogin('shop-a')
  expect(setup.onboardingPhase).toBe('login')
  expect(setup.loaded).toBe(false)
})
it('账号变化即使共用同一工作区也清除新店任务与草稿租约', () => {
  const { runtime, setup } = fixture()
  setup.queueAfterLogin('shop-a')
  const workspace = runtime.snapshot.workspaceId
  runtime.snapshot.managed.session.account = {
    userId: 2,
    displayName: 'B',
    trial: { limit: 0, used: 0, reserved: 0, remaining: 0, expiresAt: 0 },
  }
  expect(runtime.snapshot.workspaceId).toBe(workspace)
  expect(setup.storeId).toBe('')
  expect(setup.onboardingPhase).toBeNull()
  expect(setup.onboarding.jobId).toBe('')
  setup.queueAfterLogin('shop-a')
  runtime.snapshot.managed.session.account = { ...runtime.snapshot.managed.session.account! }
  expect(setup.storeId).toBe('shop-a')
  expect(setup.onboardingPhase).toBe('login')
})
it('点击我已登录仍未认证时不得进入导入，切店后的登录结果不得推进旧流程', async () => {
  const { runtime, setup } = fixture()
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  setup.queueAfterLogin('shop-a')
  await setup.confirmLogin()
  expect(setup.onboardingPhase).toBe('login')
  expect(setup.error).toContain('尚未确认登录')
  let finish!: () => void
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ status: 'ok', message: '', data: {} })
      }),
  )
  const pending = setup.confirmLogin()
  runtime.snapshot.stores.push({ ...runtime.snapshot.stores[0]!, id: 'shop-b', storeName: 'B' })
  setup.open('shop-b')
  finish()
  await pending
  expect(setup.storeId).toBe('shop-b')
  expect(setup.onboardingPhase).toBeNull()
  expect(setup.pending).toBe(false)
})
it('配置页保留返回入口，切工作区或移除店铺清空', async () => {
  const { runtime, setup } = fixture()
  setup.open('shop-a')
  setup.pauseForConfiguration()
  expect(setup.visible).toBe(false)
  expect(setup.returnAvailable).toBe(true)
  setup.resume()
  expect(setup.visible).toBe(true)
  runtime.snapshot.workspaceId = 'workspace-b'
  await nextTick()
  expect(setup.storeId).toBe('')
  setup.open('missing')
  expect(setup.visible).toBe(false)
  setup.open('shop-a')
  runtime.snapshot.stores = []
  await nextTick()
  expect(setup.storeId).toBe('')
})
it('登录期间隐藏引导，真实在线后继续，不自动开启AI', async () => {
  const { runtime, setup } = fixture()
  vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  setup.open('shop-a')
  await setup.connect(async () => {})
  expect(setup.visible).toBe(false)
  expect(setup.awaitingLogin).toBe(true)
  expect(runtime.platformStoreId).toBe('shop-a')
  runtime.snapshot.stores[0]!.runtime.online = true
  runtime.snapshot.stores[0]!.runtime.authenticated = true
  await nextTick()
  expect(setup.visible).toBe(true)
  expect(setup.step).toBe(0)
})
it('新店登录须用户确认并重新核验，自动检测不得跳步', async () => {
  const { runtime, setup } = fixture()
  vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  setup.queueAfterLogin('shop-a')
  expect(setup.visible).toBe(false)
  runtime.snapshot.stores[0]!.runtime.open = true
  runtime.snapshot.stores[0]!.runtime.online = true
  await nextTick()
  expect(setup.visible).toBe(false)
  runtime.snapshot.stores[0]!.runtime.authenticated = false
  await nextTick()
  expect(setup.visible).toBe(false)
  runtime.snapshot.stores[0]!.runtime.authenticated = true
  await nextTick()
  expect(setup.visible).toBe(false)
  expect(setup.onboardingPhase).toBe('login')
  await setup.confirmLogin()
  expect(setup.visible).toBe(true)
  expect(setup.onboardingPhase).toBe('import')
  expect(setup.awaitingLogin).toBe(false)
  setup.dismiss()
  runtime.snapshot.stores[0]!.runtime.online = false
  runtime.snapshot.stores[0]!.runtime.online = true
  await nextTick()
  expect(setup.visible).toBe(false)
})
it('登录失败恢复引导，切工作区后的迟到结果不得呈现旧店铺', async () => {
  const { runtime, setup } = fixture()
  const run = vi.spyOn(runtime, 'run').mockRejectedValue(new Error('登录失败'))
  setup.open('shop-a')
  await setup.connect(async () => {})
  expect(setup.visible).toBe(true)
  expect(setup.error).toContain('登录失败')
  let complete!: () => void
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () => resolve({ status: 'ok', message: '', data: {} })
      }),
  )
  const job = setup.connect(async () => {})
  runtime.snapshot.workspaceId = 'workspace-b'
  await nextTick()
  complete()
  await job
  expect(runtime.platformStoreId).toBe('')
  expect(setup.visible).toBe(false)
})

it('商品知识进入真实配置页，AI训练打开知识库训练场且移除旧模型设置入口', async () => {
  const { setup, runtime } = fixture()
  runtime.snapshot.stores[0]!.runtime.online = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/shop/manage', '/settings'].map((path) => ({
      path,
      component: { template: '<div />' },
    })),
  })
  await router.push('/')
  setup.open('shop-a')
  const wrapper = mount(ShopSetupGuide, {
    global: {
      plugins: [ElementPlus, router],
      stubs: {
        ElDialog: { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
      },
    },
  })
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes('商品知识'))!
    .trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.panel).toBe('goods')
  expect(runtime.selectedStoreId).toBe('shop-a')
  expect(setup.returnAvailable).toBe(true)
  await wrapper.find('button.shop-setup-resume').trigger('click')
  await flushPromises()
  expect(setup.visible).toBe(true)
  setup.step = 0
  await nextTick()
  expect(wrapper.text()).not.toContain('模型连接设置')
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes('AI训练场'))!
    .trigger('click')
  await flushPromises()
  expect(knowledge.open).toHaveBeenCalledWith('shop-a', { tab: 'training' })
  expect(router.currentRoute.value.query.panel).not.toBe('training')
  setup.resume()
  setup.step = 5
  setup.saved = true
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '继续知识库配置')!
    .trigger('click')
  await flushPromises()
  expect(knowledge.open).toHaveBeenLastCalledWith('shop-a', { tab: 'products' })
  expect(setup.visible).toBe(false)
  expect(setup.saved).toBe(true)
  expect(runtime.snapshot.stores[0]?.aiEnabled).toBe(false)
  wrapper.unmount()
})

it('连接A期间切到B后迟到结果和在线事件不会抢回店铺', async () => {
  const { runtime, setup } = fixture()
  runtime.snapshot.stores.push({
    id: 'shop-b',
    storeName: '店铺B',
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: false, online: false },
  })
  let complete!: () => void
  vi.spyOn(runtime, 'run').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () => resolve({ status: 'ok', message: '', data: {} })
      }),
  )
  setup.open('shop-a')
  const navigate = vi.fn(async () => {})
  const job = setup.connect(navigate)
  runtime.selectedStoreId = 'shop-b'
  runtime.platformStoreId = 'shop-b'
  complete()
  await job
  runtime.snapshot.stores[0]!.runtime.online = true
  await nextTick()
  expect(navigate).not.toHaveBeenCalled()
  expect(runtime.platformStoreId).toBe('shop-b')
  expect(setup.visible).toBe(false)
  expect(setup.awaitingLogin).toBe(false)
  expect(setup.pending).toBe(false)
  expect(setup.storeId).toBe('')
})

it('整页向导进入配置页保留继续入口，用户退出后结束引导', async () => {
  const { runtime, setup } = fixture()
  runtime.snapshot.stores[0]!.runtime.online = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/shop/manage'].map((path) => ({ path, component: { template: '<div />' } })),
  })
  await router.push('/')
  setup.open('shop-a')
  const wrapper = mount(ShopSetupGuide, {
    attachTo: document.body,
    global: { plugins: [ElementPlus, router], stubs: { transition: false } },
  })
  await flushPromises()
  const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
    item.textContent?.includes('商品知识'),
  )
  expect(button).toBeDefined()
  button!.click()
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await flushPromises()
  expect(router.currentRoute.value.query.panel).toBe('goods')
  expect(setup.returnAvailable).toBe(true)
  expect(wrapper.find('.shop-setup-resume').exists()).toBe(true)
  await wrapper.find('.shop-setup-resume').trigger('click')
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 100))
  document.body.querySelector<HTMLButtonElement>('[data-dismiss]')!.click()
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await flushPromises()
  expect(setup.storeId).toBe('')
  expect(setup.returnAvailable).toBe(false)
  wrapper.unmount()
})
