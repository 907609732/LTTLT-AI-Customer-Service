import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginView from '../src/modules/account/components/LoginView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

afterEach(() => {
  document.body.innerHTML = ''
})

function loginFixture(available = true) {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = available
  const run = vi
    .spyOn(runtime, 'run')
    .mockResolvedValue({ status: 'ok', message: '完成', data: {} })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  })
  const wrapper = mount(LoginView, {
    global: { plugins: [ElementPlus, router] },
  })
  return { runtime, run, router, wrapper }
}

it('不再显示无后端的手机号密码与自动登录表单，明确说明加密持久化', () => {
  const { wrapper } = loginFixture()
  expect(wrapper.text()).toContain('托管账号登录')
  expect(wrapper.text()).toContain('系统安全存储加密保存在本机')
  expect(wrapper.text()).toContain('下次启动时自动恢复')
  expect(wrapper.text()).not.toContain('手机号登录')
  expect(wrapper.text()).not.toContain('密码登录')
  expect(wrapper.text()).not.toContain('自动登录')
  wrapper.unmount()
})

it('登录请求失败时显示主进程返回的安全错误，不显示远端原始响应', async () => {
  const { run, wrapper } = loginFixture()
  run.mockRejectedValueOnce(new Error('托管服务暂时不可用。'))

  await wrapper.get('[data-testid="managed-login"]').trigger('click')
  await flushPromises()

  expect(wrapper.text()).toContain('托管服务暂时不可用。')
  wrapper.unmount()
})

it('浏览器预览说明桌面版限制并禁用授权', () => {
  const { wrapper } = loginFixture(false)

  expect(wrapper.text()).toContain('浏览器预览仅供查看界面')
  expect(wrapper.get('[data-testid="managed-login"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('设备授权后切换到托管账号并进入工作台', async () => {
  const { runtime, run, router, wrapper } = loginFixture()
  run.mockImplementation(async (command) => {
    if (command.action === 'managed-login') {
      runtime.snapshot.managed.session.status = 'authorizing'
      runtime.snapshot.managed.session.login = {
        userCode: 'ABCD-EFGH',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      }
    }
    if (command.action === 'activate-model-source') {
      runtime.snapshot.managed.active.mode = 'managed'
      runtime.snapshot.managed.configured.mode = 'managed'
      runtime.snapshot.managed.restartRequired = false
    }
    return { status: 'ok', message: '完成', data: {} }
  })

  await wrapper.get('[data-testid="managed-login"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({ action: 'managed-login' })
  expect(wrapper.text()).toContain('ABCD-EFGH')

  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 'authorized-user',
    displayName: '已授权账号',
    trial: { limit: 20, used: 2, reserved: 0, remaining: 18, expiresAt: 1800000000 },
  }
  await flushPromises()

  expect(run).toHaveBeenCalledWith({ action: 'activate-model-source', values: { mode: 'managed' } })
  expect(router.currentRoute.value.path).toBe('/')
  expect(wrapper.text()).toContain('已登录：已授权账号')
  wrapper.unmount()
})

it('启动时已有加密会话则展示已恢复状态并提供退出入口', async () => {
  const { runtime, wrapper } = loginFixture()
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 42,
    displayName: '恢复账号',
    trial: { limit: 20, used: 3, reserved: 0, remaining: 17, expiresAt: 1800000000 },
  }
  await flushPromises()

  expect(wrapper.text()).toContain('已登录：恢复账号')
  expect(wrapper.text()).toContain('会话凭据已由系统安全存储加密保存')
  expect(wrapper.findAll('button').some((button) => button.text() === '退出登录')).toBe(true)
  wrapper.unmount()
})
