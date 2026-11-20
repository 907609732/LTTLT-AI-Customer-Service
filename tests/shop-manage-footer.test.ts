import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ShopManageView from '../src/app/layouts/ShopManageView.vue'
import SidebarFooter from '../src/app/components/SidebarFooter.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

it('配置中心复用同一个 footer，认证/支付/客服/快捷回复交由工作台父层', async () => {
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
  const footer = wrapper.findComponent(SidebarFooter)
  expect(footer.exists()).toBe(true)
  footer.vm.$emit('login')
  footer.vm.$emit('recharge')
  footer.vm.$emit('contact')
  footer.vm.$emit('quick-reply')
  expect(wrapper.emitted('login')).toHaveLength(1)
  expect(wrapper.emitted('recharge')).toHaveLength(1)
  expect(wrapper.emitted('contact')).toHaveLength(1)
  expect(wrapper.emitted('quick-reply')).toHaveLength(1)

  run.mockRejectedValueOnce(Error('监控打开失败'))
  footer.vm.$emit('reply-monitor')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({ action: 'open-reply-monitor' })
  expect(wrapper.text()).toContain('监控打开失败')
})
