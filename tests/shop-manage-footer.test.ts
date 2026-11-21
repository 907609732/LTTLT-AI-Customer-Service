import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ShopManageView from '../src/app/layouts/ShopManageView.vue'
import SidebarFooter from '../src/app/components/SidebarFooter.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import type { ReplyReview } from '../src/shared/contracts/review'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

const reply = (id: string, status: ReplyReview['status']): ReplyReview => ({
  id,
  at: 0,
  storeId: 'shop-a',
  storeName: '合成店铺',
  uid: 'buyer',
  buyerName: '买家',
  text: '',
  traceId: '',
  status,
  reason: '',
})

async function fixture() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'config-workspace'
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shop/manage', component: ShopManageView }],
  })
  await router.push('/shop/manage?panel=shops')
  const wrapper = mount(ShopManageView, {
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { ShopsListPanel: true },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, runtime, run }
}

it('配置中心不再挂载新 footer，只保留旧回复监控与构建注入版本', async () => {
  const { wrapper, runtime } = await fixture()
  runtime.snapshot.review.replies = [
    reply('r1', 'pending'),
    reply('r2', 'pending'),
    reply('r3', 'sent'),
  ]
  await flushPromises()

  expect(wrapper.findComponent(SidebarFooter).exists()).toBe(false)
  expect(wrapper.find('footer.sidebar-footer').exists()).toBe(false)
  for (const text of ['剩余算力', '充值', '添加客服', '使用教程', '检查更新', '快捷回复'])
    expect(wrapper.text()).not.toContain(text)

  const monitor = wrapper.get('.sider__monitor [aria-label="回复监控"]')
  expect(monitor.text()).toContain('回复监控')
  expect(monitor.text()).toContain('2 待确认')
  expect(wrapper.get('.app-version').text()).toMatch(/^v\d+\.\d+\.\d+$/)
})

it('旧回复监控保留忙碌禁用和真实失败提示', async () => {
  const busy = await fixture()
  busy.run.mockImplementationOnce(() => new Promise(() => {}))
  await busy.wrapper.get('.sider__monitor [aria-label="回复监控"]').trigger('click')
  await flushPromises()
  expect(
    busy.wrapper.get('.sider__monitor [aria-label="回复监控"]').attributes('disabled'),
  ).toBeDefined()
  expect(busy.run).toHaveBeenLastCalledWith({ action: 'open-reply-monitor' })

  const failed = await fixture()
  failed.run.mockRejectedValueOnce(Error('监控打开失败'))
  await failed.wrapper.get('.sider__monitor [aria-label="回复监控"]').trigger('click')
  await flushPromises()
  expect(failed.wrapper.get('.sider__monitor-error').text()).toContain('监控打开失败')
})
