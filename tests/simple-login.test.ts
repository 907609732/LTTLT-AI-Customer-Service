import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import SettingsView from '../src/modules/settings/components/SettingsView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

afterEach(() => {
  document.body.innerHTML = ''
})
it('设置默认只展示回复间隔，高级模型配置收起且不再重复账号入口', () => {
  setActivePinia(createPinia())
  const wrapper = mount(SettingsView, {
    global: { plugins: [ElementPlus], stubs: { ElTag: true } },
  })
  expect(wrapper.text()).toContain('AI 回复间隔')
  expect(wrapper.text()).not.toContain('托管 API 服务地址')
  expect(wrapper.find('details').exists()).toBe(true)
  expect(wrapper.find('details').attributes('open')).toBeUndefined()
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
  const wrapper = mount(LoginDialog, {
    props: { modelValue: true },
    global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /></div>' } } },
  })
  return { runtime, run, wrapper }
}
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
it('设置工作区改变清除旧账号模型和回复间隔草稿', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  const wrapper = mount(SettingsView, {
    global: { plugins: [ElementPlus], stubs: { ElTag: true } },
  })
  await wrapper.find('input[aria-label="模型接口地址"]').setValue('https://old.invalid')
  await wrapper.find('input[aria-label="模型 API Key"]').setValue('old-test-key')
  wrapper.findComponent({ name: 'ElInputNumber' }).vm.$emit('update:modelValue', 120)
  wrapper.findComponent({ name: 'ElInputNumber' }).vm.$emit('change', 120)
  await flushPromises()
  runtime.snapshot.config.reply.perUidMinIntervalMs = 30000
  runtime.snapshot.config.ai.baseUrl = 'https://new.invalid'
  runtime.snapshot.workspaceId = 'new-workspace'
  await flushPromises()
  expect((wrapper.find('input[aria-label="模型接口地址"]').element as HTMLInputElement).value).toBe(
    'https://new.invalid',
  )
  expect((wrapper.find('input[aria-label="模型 API Key"]').element as HTMLInputElement).value).toBe(
    '',
  )
  expect(wrapper.findComponent({ name: 'ElInputNumber' }).props('modelValue')).toBe(30)
  wrapper.unmount()
})
