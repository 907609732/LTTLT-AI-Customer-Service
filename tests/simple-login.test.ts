import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import SettingsView from '../src/modules/settings/components/SettingsView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

afterEach(() => {
  document.body.innerHTML = ''
})
it('间隔控件不再包含高级模型配置或账号入口', () => {
  setActivePinia(createPinia())
  const wrapper = mount(SettingsView, {
    global: { plugins: [ElementPlus], stubs: { ElTag: true } },
  })
  expect(wrapper.find('[aria-label="同一买家回复间隔（秒）"]').exists()).toBe(true)
  expect(wrapper.find('h3').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('载入已保存间隔')
  expect(wrapper.text()).not.toContain('间隔单独保存，保存不会开启 AI 或发送消息。')
  expect(wrapper.text()).not.toContain('托管 API 服务地址')
  expect(wrapper.find('details').exists()).toBe(false)
  wrapper.unmount()
})
import LoginDialog from '../src/modules/settings/components/LoginDialog.vue'
function loginFixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  const run = vi
    .spyOn(runtime, 'run')
    .mockResolvedValue({ status: 'ok', message: '完成', data: {} })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/shop/recharge', component: { template: '<div />' } },
    ],
  })
  const wrapper = mount(LoginDialog, {
    props: { modelValue: true },
    global: {
      plugins: [ElementPlus, router],
      stubs: { ElDialog: { template: '<div><slot /></div>' }, BillingDashboard: true },
    },
  })
  return { runtime, run, wrapper, router }
}
it('充值从服务端登录区域打开原充值页，不创建支付或切换账号', async () => {
  const { wrapper, router, run } = loginFixture()
  await wrapper.get('.service-option [data-account-recharge]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/shop/recharge')
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  expect(run).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('服务端账号展示真实总额度、剩余额度和额度到期时间，并提供订单与消耗入口', async () => {
  const { runtime, wrapper, run } = loginFixture()
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 'billing-user',
    displayName: '测试账号',
    trial: { limit: 100, used: 20, reserved: 3, remaining: 77, expiresAt: 1800000000 },
  }
  await flushPromises()
  expect(wrapper.text()).toContain('总额度')
  expect(wrapper.text()).toContain('100 次')
  expect(wrapper.text()).toContain('剩余额度')
  expect(wrapper.text()).toContain('77 次')
  expect(wrapper.text()).toContain('到期时间')
  expect(wrapper.text()).toContain(new Date(1800000000 * 1000).toLocaleString('zh-CN'))
  expect(wrapper.get('[data-account-billing="orders"]').text()).toBe('我的订单')
  expect(wrapper.get('[data-account-billing="usage"]').text()).toBe('算力消耗')
  expect(run).not.toHaveBeenCalled()
  await wrapper.get('[data-account-billing="orders"]').trigger('click')
  expect(wrapper.get('billing-dashboard-stub').attributes('section')).toBe('orders')
  runtime.snapshot = {
    ...runtime.snapshot,
    managed: { ...runtime.snapshot.managed, session: { ...runtime.snapshot.managed.session } },
  }
  await flushPromises()
  expect(wrapper.find('billing-dashboard-stub').exists()).toBe(true)
  await wrapper.get('[data-account-billing="usage"]').trigger('click')
  expect(wrapper.get('billing-dashboard-stub').attributes('section')).toBe('usage')
  runtime.snapshot.managed.session.account!.userId = 'another-user'
  await flushPromises()
  expect(wrapper.find('billing-dashboard-stub').exists()).toBe(false)
  runtime.snapshot.managed.session.account!.trial.expiresAt = 0
  await flushPromises()
  expect(wrapper.text()).toContain('未提供')
  wrapper.unmount()
})
it('Key连接失败保留输入，成功才关闭且必须验证连接', async () => {
  const { run, wrapper } = loginFixture()
  run.mockRejectedValueOnce(new Error('连接失败'))
  await wrapper.find('input[aria-label="登录 API Key"]').setValue('temporary-test-key')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('连接失败')
  expect((wrapper.find('input[aria-label="登录 API Key"]').element as HTMLInputElement).value).toBe(
    'temporary-test-key',
  )
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'save-model-settings',
    values: expect.objectContaining({ testConnection: true }),
  })
  expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  wrapper.unmount()
})
it('关闭清空Key但保留授权，授权完成切工作区后关闭', async () => {
  const { runtime, run, wrapper } = loginFixture()
  await wrapper.find('input[aria-label="登录 API Key"]').setValue('temporary-test-key')
  await wrapper
    .findAll('button')
    .find((b) => b.attributes('aria-label') === '浏览器登录')!
    .trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({ action: 'managed-login' })
  await wrapper.setProps({ modelValue: false })
  expect((wrapper.find('input[aria-label="登录 API Key"]').element as HTMLInputElement).value).toBe(
    '',
  )
  expect(run).not.toHaveBeenCalledWith({ action: 'managed-cancel-login' })
  run.mockImplementation(async (command) => {
    if (command.action === 'activate-model-source') runtime.snapshot.managed.active.mode = 'managed'
    return { status: 'ok', message: '完成', data: {} }
  })
  runtime.snapshot.managed.session.status = 'signed_in'
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'activate-model-source',
    values: { mode: 'managed' },
  })
  wrapper.unmount()
})
it('切换厂商清空Key，已有账号可重新进入工作区', async () => {
  const { runtime, wrapper } = loginFixture()
  await wrapper.find('input[aria-label="登录 API Key"]').setValue('temporary-test-key')
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'qwen')
  await flushPromises()
  expect((wrapper.find('input[aria-label="登录 API Key"]').element as HTMLInputElement).value).toBe(
    '',
  )
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 'test',
    displayName: '测试账号',
    trial: { limit: 10, used: 0, reserved: 0, remaining: 10, expiresAt: 0 },
  }
  await flushPromises()
  expect(wrapper.findAll('button').some((button) => button.text() === '进入账号')).toBe(true)
  wrapper.unmount()
})
it.each([false, true])(
  '托管账号Key验证失败恢复原工作区，恢复失败=%s时明确报错',
  async (restoreFails) => {
    const { runtime, run, wrapper } = loginFixture()
    runtime.snapshot.managed.active.mode = 'managed'
    run.mockImplementation(async (command) => {
      if (command.action === 'save-model-settings') throw new Error('Key验证失败')
      if (command.action === 'activate-model-source') {
        if (command.values?.mode === 'managed' && restoreFails) throw new Error('恢复失败')
        runtime.snapshot.managed.active.mode = command.values?.mode as 'local' | 'managed'
      }
      return { status: 'ok', message: '完成', data: {} }
    })
    await wrapper.find('input[aria-label="登录 API Key"]').setValue('invalid-test-key')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(run).toHaveBeenLastCalledWith({
      action: 'activate-model-source',
      values: { mode: 'managed' },
    })
    expect(wrapper.text()).toContain('Key验证失败')
    if (restoreFails) expect(wrapper.text()).toContain('恢复失败')
    else expect(runtime.snapshot.managed.active.mode).toBe('managed')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  },
)
it('间隔控件切工作区清空旧草稿', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  const wrapper = mount(SettingsView, { global: { plugins: [ElementPlus] } })
  const input = wrapper.findComponent({ name: 'ElInputNumber' })
  input.vm.$emit('update:modelValue', 120)
  input.vm.$emit('change', 120)
  await flushPromises()
  runtime.snapshot.config.reply.perUidMinIntervalMs = 30000
  runtime.snapshot.workspaceId = 'new-workspace'
  await flushPromises()
  expect(input.props('modelValue')).toBe(30)
  wrapper.unmount()
})

it('模型异常核对迁入登录入口，保留请求编号且必须明确勾选', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.modelIssue = {
    code: 'request_uncertain',
    message: '请求结果待核对',
    requiresReview: true,
    at: 123,
    context: { requestId: 'fixture-review-request' },
  }
  const run = vi
    .spyOn(runtime, 'run')
    .mockResolvedValue({ status: 'ok', message: '已核对', data: {} })
  const wrapper = mount(LoginDialog, {
    props: { modelValue: true },
    global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /></div>' } } },
  })
  expect(wrapper.find('.managed-issue').text()).toContain('fixture-review-request')
  const button = wrapper.find('.managed-issue').findComponent({ name: 'ElButton' })
  expect(button.props('disabled')).toBe(true)
  wrapper
    .find('.managed-issue')
    .findComponent({ name: 'ElCheckbox' })
    .vm.$emit('update:modelValue', true)
  await flushPromises()
  await button.trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'acknowledge-model-issue',
    values: { confirmed: true, code: 'request_uncertain', at: 123 },
  })
  wrapper.unmount()
})
