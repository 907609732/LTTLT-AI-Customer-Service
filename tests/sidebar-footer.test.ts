import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SidebarFooter from '../src/app/components/SidebarFooter.vue'
import AppVersion from '../src/shared/ui/AppVersion.vue'

const tutorial = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../src/app/sidebar-footer', () => ({ openOfficialTutorial: tutorial }))

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.clearAllMocks()
})
function render() {
  const wrapper = mount(SidebarFooter, {
    props: { pendingCount: 3 },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(label))!
}

it('移除算力充值卡，保留待确认数、帮助入口和构建注入版本', () => {
  const wrapper = render()
  expect(wrapper.text()).not.toContain('剩余算力')
  expect(wrapper.text()).not.toContain('充值')
  expect(wrapper.get('.footer-version .app-update-check').text()).toContain('检查更新')
  expect(wrapper.find('.footer-actions .app-update-check').exists()).toBe(false)
  expect(wrapper.find('.quota-card').exists()).toBe(false)
  expect(wrapper.text()).toContain('3')
  expect(wrapper.text()).toContain('添加客服')
  expect(wrapper.text()).toContain('使用教程')
  expect(wrapper.text()).toContain('检查更新')
  expect(wrapper.text()).toMatch(/当前版本 v\d+\.\d+\.\d+/)
  expect(wrapper.text()).not.toContain('0.2.13')
  expect(wrapper.text()).not.toContain('6,436')
})

it('AppVersion 默认仍只显示 v版本，可选 prefix 不改变构建注入来源', () => {
  const plain = mount(AppVersion)
  const prefixed = mount(AppVersion, { props: { prefix: '当前版本 v' } })
  wrappers.push(plain, prefixed)
  expect(plain.text()).toMatch(/^v\d+\.\d+\.\d+$/)
  expect(prefixed.text()).toMatch(/^当前版本 v\d+\.\d+\.\d+$/)
  expect(plain.attributes('title')).toContain('当前软件版本 v')
})

it('快捷回复、回复监控和客服只抛出父层动作', async () => {
  const wrapper = render()
  await button(wrapper, '快捷回复').trigger('click')
  await wrapper.get('[aria-label="回复监控"]').trigger('click')
  await button(wrapper, '添加客服').trigger('click')
  expect(wrapper.emitted('quick-reply')).toHaveLength(1)
  expect(wrapper.emitted('reply-monitor')).toHaveLength(1)
  expect(wrapper.emitted('contact')).toHaveLength(1)
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

it('保留首页的监控忙碌与错误，不隐藏待确认入口', async () => {
  const wrapper = mount(SidebarFooter, {
    props: {
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
