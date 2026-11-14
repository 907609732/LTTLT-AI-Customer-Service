import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AddShopDialog from '../src/modules/shops/components/AddShopDialog.vue'
import { useShopSetupStore } from '../src/modules/shops/setup-store'
import { useRuntimeStore } from '../src/shared/state/runtime'

afterEach(() => {
  document.body.innerHTML = ''
})
async function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.workspaceId = 'test-workspace'
  runtime.snapshot.capabilities.platforms.push({ id: 'sim-local', label: '本机模拟店铺' })
  function added(id = 'new-shop') {
    runtime.snapshot.stores.push({
      id,
      storeName: '新店铺',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    })
    return { status: 'ok' as const, message: '', data: { id } }
  }
  const run = vi
    .spyOn(runtime, 'run')
    .mockImplementation(async (command) =>
      command.action === 'add-store' ? added() : { status: 'ok', message: '', data: {} },
    )
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  const wrapper = mount(AddShopDialog, {
    props: { modelValue: true },
    global: {
      plugins: [ElementPlus, router],
      stubs: {
        ElDialog: { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
      },
    },
  })
  return { runtime, run, wrapper, added }
}
it('真实平台按实际能力展示状态，默认未选且未接入不可添加', async () => {
  const { wrapper, run } = await fixture()
  expect(wrapper.findAll('[data-platform]')).toHaveLength(11)
  expect(wrapper.find('[data-platform="qianniu"]').text()).toContain('开发中')
  expect(wrapper.find('[data-platform="doudian-web"]').text()).toContain('未开通')
  expect(wrapper.find('[data-platform="doudian-web"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('input[aria-label="店铺名称"]').exists()).toBe(false)
  await wrapper.find('form').trigger('submit')
  expect(run).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('添加后直接打开登录，失败重试只打开已建记录', async () => {
  const { wrapper, run, runtime, added } = await fixture()
  run.mockImplementationOnce(async () => added()).mockRejectedValueOnce(new Error('客户端未启动'))
  await wrapper.find('[data-platform="doudian-client"]').trigger('click')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run.mock.calls.map(([c]) => c.action)).toEqual(['add-store', 'open-store'])
  expect(wrapper.text()).toContain('店铺已添加，登录界面打开失败')
  expect(wrapper.find('[data-platform="pdd-web"]').attributes('disabled')).toBeDefined()
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run.mock.calls.map(([c]) => c.action)).toEqual(['add-store', 'open-store', 'open-store'])
  expect(runtime.platformStoreId).toBe('new-shop')
  expect(useShopSetupStore().visible).toBe(true)
  expect(useShopSetupStore().storeId).toBe('new-shop')
  expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  wrapper.unmount()
})
it('等待期间不可重复提交或取消', async () => {
  const { wrapper, run } = await fixture()
  let finish!: (value: { status: 'ok'; message: string; data: { id: string } }) => void
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await wrapper.find('[data-platform="pdd-web"]').trigger('click')
  await wrapper.find('form').trigger('submit')
  await wrapper.find('form').trigger('submit')
  expect(run).toHaveBeenCalledTimes(1)
  expect(wrapper.find('[aria-label="取消添加店铺"]').attributes('disabled')).toBeDefined()
  finish({ status: 'ok', message: '', data: { id: 'new-shop' } })
  await flushPromises()
  wrapper.unmount()
})
it('本机模拟保留独立入口、名称校验且不打开真实平台', async () => {
  const { wrapper, run } = await fixture()
  await wrapper.find('[aria-label="本机模拟店铺入口"]').trigger('click')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('需要一个名字')
  await wrapper.find('input[aria-label="店铺名称"]').setValue('演练店')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith({
    action: 'add-store',
    values: { platform: 'sim-local', storeName: '演练店' },
  })
  wrapper.unmount()
})
it('创建过程中切工作区不打开旧工作区店铺', async () => {
  const { wrapper, run, runtime } = await fixture()
  let finish!: (value: { status: 'ok'; message: string; data: { id: string } }) => void
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await wrapper.find('[data-platform="pdd-web"]').trigger('click')
  await wrapper.find('form').trigger('submit')
  runtime.snapshot.workspaceId = 'another-workspace'
  await flushPromises()
  finish({ status: 'ok', message: '', data: { id: 'old-workspace-shop' } })
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect(runtime.platformStoreId).toBe('')
  wrapper.unmount()
})
it('关闭重开清空本次重试编号', async () => {
  const { wrapper, run } = await fixture()
  run
    .mockResolvedValueOnce({ status: 'ok', message: '', data: { id: 'first-shop' } })
    .mockRejectedValueOnce(new Error('打开失败'))
  await wrapper.find('[data-platform="pdd-web"]').trigger('click')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  await wrapper.setProps({ modelValue: false })
  await wrapper.setProps({ modelValue: true })
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  await wrapper.find('[data-platform="pdd-web"]').trigger('click')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run.mock.calls.filter(([c]) => c.action === 'add-store')).toHaveLength(2)
  wrapper.unmount()
})
