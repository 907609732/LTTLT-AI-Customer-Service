import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import SettingsView from '../src/modules/settings/components/SettingsView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { listCustomModels } from '../electron/list-custom-models'
import { defaultVisionModelSnapshot } from '../src/shared/contracts/vision'

afterEach(() => {
  document.body.innerHTML = ''
})
it('间隔控件不再包含高级模型配置或账号入口', () => {
  setActivePinia(createPinia())
  const wrapper = mount(SettingsView, {
    global: { plugins: [ElementPlus], stubs: { ElTag: true } },
  })
  expect(wrapper.find('[aria-label="回复间隔模式"]').exists()).toBe(true)
  expect(wrapper.find('label[for="reply-pacing-mode"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="随机间隔下限（秒）"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('1～3 秒随机')
  expect(wrapper.text()).toContain('当前：')
  expect(wrapper.text()).toContain('模型生成和审核耗时另计')
  expect(wrapper.text()).not.toContain('未保存')
  expect(wrapper.find('h3').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('载入已保存间隔')
  expect(wrapper.text()).not.toContain('间隔单独保存，保存不会开启 AI 或发送消息。')
  expect(wrapper.text()).not.toContain('托管 API 服务地址')
  expect(wrapper.find('details').exists()).toBe(false)
  wrapper.unmount()
})
import LoginDialog from '../src/modules/settings/components/LoginDialog.vue'
function loginFixture(mode: 'local' | 'managed' = 'local') {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.managed.active.mode = mode
  const run = vi.spyOn(runtime, 'run').mockImplementation(async (command) => {
    if (command.action === 'get-vision-model-settings')
      return {
        status: 'ok' as const,
        message: '',
        data: { snapshot: defaultVisionModelSnapshot(), revision: 0 },
      }
    return { status: 'ok' as const, message: '完成', data: {} }
  })
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
      stubs: { ElDialog: { template: '<div><slot /></div>' } },
    },
  })
  return { runtime, run, wrapper, router }
}
async function openLocalApi(wrapper: ReturnType<typeof loginFixture>['wrapper']) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '自有 API 设置')!
    .trigger('click')
}
it('充值从服务端登录区域打开原充值页，不创建支付或切换账号', async () => {
  const { wrapper, router, run } = loginFixture()
  await wrapper.get('.service-option [data-account-recharge]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/shop/recharge')
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  expect(run.mock.calls.every(([command]) => command.action === 'get-vision-model-settings')).toBe(
    true,
  )
  wrapper.unmount()
})
it('服务端账号保留额度和充值，隐藏本地图片配置与多余操作', async () => {
  const { runtime, wrapper, run } = loginFixture('managed')
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
  for (const label of ['我的订单', '算力消耗', '切换账号', '刷新额度', '图片识别模型'])
    expect(wrapper.text()).not.toContain(label)
  expect(wrapper.get('[data-account-recharge]').text()).toBe('充值')
  expect(wrapper.find('.key-option').exists()).toBe(false)
  expect(wrapper.text()).toContain('退出登录')
  expect(run).not.toHaveBeenCalled()
  runtime.snapshot.managed.session.account!.trial.expiresAt = 0
  await flushPromises()
  expect(wrapper.text()).toContain('未提供')
  run.mockImplementationOnce(async () => {
    runtime.snapshot.managed.session.status = 'signed_out'
    runtime.snapshot.managed.session.account = null
    return { status: 'ok', message: '', data: {} }
  })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '退出登录')!
    .trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({ action: 'managed-logout' })
  expect(wrapper.text()).toContain('官方登录')
  expect(wrapper.find('.key-option').exists()).toBe(false)
  await openLocalApi(wrapper)
  expect(wrapper.get('.key-option').text()).toContain('使用自己的 Key')
  wrapper.unmount()
})
it('只在本地 Key 模式载入图片识别配置，切回托管时移除', async () => {
  const { runtime, run, wrapper } = loginFixture()
  await flushPromises()
  expect(wrapper.find('[aria-label="图片识别模型"]').exists()).toBe(false)
  await openLocalApi(wrapper)
  await flushPromises()
  expect(wrapper.find('[aria-label="图片识别模型"]').exists()).toBe(true)
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'get-vision-model-settings' }))
  runtime.snapshot.managed.active.mode = 'managed'
  await flushPromises()
  expect(wrapper.find('[aria-label="图片识别模型"]').exists()).toBe(false)
  wrapper.unmount()
})
it('Key连接失败保留输入，成功才关闭且必须验证连接', async () => {
  const { run, wrapper } = loginFixture()
  await openLocalApi(wrapper)
  await flushPromises()
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
it('自定义 API 收集地址与模型名并用保存命令验证连接', async () => {
  const { run, wrapper } = loginFixture()
  await openLocalApi(wrapper)
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'custom')
  await flushPromises()
  await wrapper.get('[aria-label="自定义 API 地址"]').setValue('https://llm.example.com/v1/')
  wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', 'support-model')
  await wrapper.get('[aria-label="登录 API Key"]').setValue('temporary-test-key')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'save-model-settings',
    values: {
      baseUrl: 'https://llm.example.com/v1',
      model: 'support-model',
      apiKey: 'temporary-test-key',
      testConnection: true,
    },
  })
  expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  wrapper.unmount()
})
it('自定义 API 地址无效时不保存配置', async () => {
  const { run, wrapper } = loginFixture()
  await openLocalApi(wrapper)
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'custom')
  await flushPromises()
  await wrapper.get('[aria-label="自定义 API 地址"]').setValue('not-a-url')
  wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', 'support-model')
  await wrapper.get('[aria-label="登录 API Key"]').setValue('temporary-test-key')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('API 地址格式无效')
  expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'save-model-settings' }))
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  wrapper.unmount()
})
it('获取模型图标加载可用模型并可选择', async () => {
  const { run, wrapper } = loginFixture()
  run.mockResolvedValueOnce({
    status: 'ok',
    message: '模型列表已获取',
    data: { models: ['model-a', 'model-b'] },
  })
  await openLocalApi(wrapper)
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'custom')
  await flushPromises()
  await wrapper.get('[aria-label="自定义 API 地址"]').setValue('https://llm.example.com/v1')
  await wrapper.get('[aria-label="登录 API Key"]').setValue('temporary-test-key')
  await wrapper.get('[aria-label="获取模型列表"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'list-custom-models',
    values: { baseUrl: 'https://llm.example.com/v1', apiKey: 'temporary-test-key' },
  })
  wrapper.findAllComponents({ name: 'ElSelect' })[1]!.vm.$emit('update:modelValue', 'model-a')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'save-model-settings',
    values: {
      baseUrl: 'https://llm.example.com/v1',
      model: 'model-a',
      apiKey: 'temporary-test-key',
      testConnection: true,
    },
  })
  wrapper.unmount()
})
it('模型列表查询从主进程发起并去重响应中的模型 ID', async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }, { id: 'alpha' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  await expect(
    listCustomModels({ baseUrl: 'https://llm.example.com/v1/', apiKey: 'secret' }, request),
  ).resolves.toEqual(['alpha', 'beta'])
  expect(request).toHaveBeenCalledWith(
    new URL('https://llm.example.com/v1/models'),
    expect.objectContaining({
      headers: { Authorization: 'Bearer secret', Accept: 'application/json' },
      redirect: 'error',
    }),
  )
})
it('返回官方登录清空 Key，关闭弹窗保留授权', async () => {
  const { runtime, run, wrapper } = loginFixture()
  await openLocalApi(wrapper)
  await wrapper.find('input[aria-label="登录 API Key"]').setValue('temporary-test-key')
  const back = () => wrapper.findAll('button').find((button) => button.text() === '返回官方登录')!
  await back().trigger('click')
  await openLocalApi(wrapper)
  expect(wrapper.get<HTMLInputElement>('input[aria-label="登录 API Key"]').element.value).toBe('')
  await back().trigger('click')
  await wrapper
    .findAll('button')
    .find((b) => b.attributes('aria-label') === '浏览器登录')!
    .trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({ action: 'managed-login' })
  await wrapper.setProps({ modelValue: false })
  expect(wrapper.find('.key-option').exists()).toBe(false)
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
  await openLocalApi(wrapper)
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
    await openLocalApi(wrapper)
    await wrapper.find('input[aria-label="登录 API Key"]').setValue('invalid-test-key')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(run).toHaveBeenCalledWith({
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
it('普通快照刷新不丢未保存草稿', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  const wrapper = mount(SettingsView, { global: { plugins: [ElementPlus] } })
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'custom')
  await flushPromises()
  const input = wrapper.findComponent({ name: 'ElInputNumber' })
  input.vm.$emit('update:modelValue', 7)
  input.vm.$emit('change', 7)
  await flushPromises()
  expect(wrapper.text()).toContain('未保存')
  runtime.snapshot.config.reply.pacing = {
    mode: 'fixed-1',
    customMinSeconds: 1,
    customMaxSeconds: 3,
  }
  await flushPromises()
  expect(input.props('modelValue')).toBe(7)
  expect(wrapper.text()).toContain('当前：固定 1 秒')
  wrapper.unmount()
})

it('CAS 冲突保留草稿并可显式重新载入已保存设置', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.config.reply.pacing = {
    mode: 'custom',
    customMinSeconds: 4,
    customMaxSeconds: 9,
  }
  vi.spyOn(runtime, 'run').mockRejectedValue(
    new Error('回复间隔配置已更新，请载入已保存设置后再修改'),
  )
  const wrapper = mount(SettingsView, { global: { plugins: [ElementPlus] } })
  const select = wrapper.findComponent({ name: 'ElSelect' })
  select.vm.$emit('update:modelValue', 'random-2-3')
  await flushPromises()
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').text()).toContain('已更新')
  expect(wrapper.find('[aria-label="重新载入已保存设置"]').exists()).toBe(true)
  expect(select.props('modelValue')).toBe('random-2-3')
  await wrapper.find('[aria-label="重新载入已保存设置"]').trigger('click')
  await flushPromises()
  expect(select.props('modelValue')).toBe('custom')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  wrapper.unmount()
})

it('间隔控件切工作区清空旧草稿', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  const wrapper = mount(SettingsView, { global: { plugins: [ElementPlus] } })
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'custom')
  await flushPromises()
  const input = wrapper.findComponent({ name: 'ElInputNumber' })
  input.vm.$emit('update:modelValue', 120)
  input.vm.$emit('change', 120)
  await flushPromises()
  runtime.snapshot.config.reply.pacing = {
    mode: 'custom',
    customMinSeconds: 30,
    customMaxSeconds: 60,
  }
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
