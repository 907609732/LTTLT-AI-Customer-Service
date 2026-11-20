import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SidebarFooter from '../src/app/components/SidebarFooter.vue'
import AppVersion from '../src/shared/ui/AppVersion.vue'
import type { SidebarBalance } from '../src/app/sidebar-footer'

const tutorial = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../src/app/sidebar-footer', () => ({ openOfficialTutorial: tutorial }))

const ready: SidebarBalance = {
  state: 'ready',
  balance: 12345,
  label: '12,345',
  detail: '账号当前可用次数',
  canRecharge: true,
}
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.clearAllMocks()
})
function render(account: SidebarBalance = ready) {
  const wrapper = mount(SidebarFooter, {
    props: { account, pendingCount: 3 },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(label))!
}

it('显示真实算力、待确认数、三个帮助入口和构建注入版本', () => {
  const wrapper = render()
  expect(wrapper.text()).toContain('剩余算力')
  expect(wrapper.text()).toContain('12,345')
  expect(wrapper.text()).toContain('3')
  expect(wrapper.text()).toContain('添加客服')
  expect(wrapper.text()).toContain('使用教程')
  expect(wrapper.text()).toContain('检查更新')
  expect(wrapper.text()).toMatch(/当前 v\d+\.\d+\.\d+/)
  expect(wrapper.text()).not.toContain('0.2.13')
  expect(wrapper.text()).not.toContain('6,436')
})

it('AppVersion 默认仍只显示 v版本，可选 prefix 不改变构建注入来源', () => {
  const plain = mount(AppVersion)
  const prefixed = mount(AppVersion, { props: { prefix: '当前 v' } })
  wrappers.push(plain, prefixed)
  expect(plain.text()).toMatch(/^v\d+\.\d+\.\d+$/)
  expect(prefixed.text()).toMatch(/^当前 v\d+\.\d+\.\d+$/)
  expect(plain.attributes('title')).toContain('当前软件版本 v')
})

it('快捷回复、回复监控、客服和充值只抛出父层动作', async () => {
  const wrapper = render()
  await button(wrapper, '快捷回复').trigger('click')
  await wrapper.get('[aria-label="回复监控"]').trigger('click')
  await button(wrapper, '添加客服').trigger('click')
  await button(wrapper, '充值').trigger('click')
  expect(wrapper.emitted('quick-reply')).toHaveLength(1)
  expect(wrapper.emitted('reply-monitor')).toHaveLength(1)
  expect(wrapper.emitted('contact')).toHaveLength(1)
  expect(wrapper.emitted('recharge')).toHaveLength(1)
  expect(wrapper.emitted('login')).toBeUndefined()
})

it('未托管登录时充值复用父层登录入口，不自行认证', async () => {
  const wrapper = render({
    ...ready,
    state: 'login',
    balance: null,
    label: '需登录',
    canRecharge: false,
  })
  expect(wrapper.text()).toContain('需登录')
  await button(wrapper, '充值').trigger('click')
  expect(wrapper.emitted('login')).toHaveLength(1)
  expect(wrapper.emitted('recharge')).toBeUndefined()
})

it('教程走固定应用服务；失败显示本组件的真实反馈', async () => {
  const wrapper = render()
  await button(wrapper, '使用教程').trigger('click')
  await flushPromises()
  expect(tutorial).toHaveBeenCalledTimes(1)
  tutorial.mockRejectedValueOnce(Error('无法打开使用教程'))
  await button(wrapper, '使用教程').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('无法打开使用教程')
})

it('保留配置中心的监控忙碌与错误，不隐藏待确认入口', async () => {
  const wrapper = mount(SidebarFooter, {
    props: {
      account: ready,
      pendingCount: 2,
      monitorBusy: true,
      monitorError: '监控打开失败',
    },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  expect(wrapper.get('[aria-label="回复监控"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('监控打开失败')
  expect(wrapper.text()).toContain('2')
})
