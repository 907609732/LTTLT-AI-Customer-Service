import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ShopManageView from '../src/app/layouts/ShopManageView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

vi.mock('../src/app/navigation', () => ({
  panelRegistry: { shops: { title: '店铺', component: { template: '<div />' } } },
  navGroups: [],
  resolvePanelKey: () => 'shops',
}))

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
it('配置中心左下回复监控入口只打开监控，不修改店铺或发送', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = '00000000-0000-4000-8000-000000000003'
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shop/manage', component: ShopManageView }],
  })
  await router.push('/shop/manage')
  const wrapper = mount(ShopManageView, {
    global: {
      plugins: [pinia, router],
      stubs: {
        BrandMark: true,
        AppVersion: { props: ['prefix'], template: '<span />' },
      },
    },
  })
  wrappers.push(wrapper)
  expect(wrapper.find('header').exists()).toBe(false)
  expect(wrapper.text()).not.toMatch(/返回工作台|商品自动学习|官网/)
  expect(wrapper.find('.sider__monitor [aria-label="回复监控"]').exists()).toBe(true)
  await wrapper.get('.sider__monitor [aria-label="回复监控"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({ action: 'open-reply-monitor' })
})
