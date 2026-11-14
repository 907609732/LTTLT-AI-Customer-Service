import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import StoreSidebarCard from '../src/modules/shops/components/StoreSidebarCard.vue'
import type { LocalStore } from '../src/shared/contracts/backend'

const shop: LocalStore = {
  id: 'sidebar-shop',
  storeName: '测试店铺',
  platform: 'pdd-web',
  group: '',
  aiEnabled: false,
  runtime: { open: true, online: true, authenticated: true },
}
const wrappers: ReturnType<typeof mount>[] = []
function fixture() {
  const wrapper = mount(StoreSidebarCard, {
    props: { shop },
    attachTo: document.body,
    global: { stubs: { transition: false } },
  })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})
async function showMenu(wrapper: ReturnType<typeof fixture>) {
  await wrapper.get('.store-sidebar-card').trigger('contextmenu')
  await flushPromises()
  await vi.waitFor(() =>
    expect(document.querySelector('.el-dropdown__popper')?.getAttribute('aria-hidden')).toBe(
      'false',
    ),
  )
}

it('紧凑卡片展示真实平台和在线状态，点击行与 AI 开关相互独立', async () => {
  const wrapper = fixture()
  expect(wrapper.text()).toContain('测试店铺')
  expect(wrapper.text()).toContain('拼多多')
  expect(wrapper.text()).toContain('在线')
  await wrapper.get('[role="switch"]').trigger('click')
  expect(wrapper.emitted('toggleAi')).toHaveLength(1)
  expect(wrapper.emitted('open')).toBeUndefined()
  await wrapper.get('.store-sidebar-card').trigger('click')
  expect(wrapper.emitted('open')).toHaveLength(1)
  await wrapper.setProps({ shop: { ...shop, runtime: { open: false, online: false } } })
  expect(wrapper.text()).toContain('未打开')
  expect(wrapper.text()).not.toContain('在线')
})

it('右键只提供五个指定入口，不打开店铺；菜单逐项发出对应事件', async () => {
  const wrapper = fixture()
  const events = ['setup', 'importKnowledge', 'settings', 'backend', 'close'] as const
  for (let index = 0; index < events.length; index++) {
    await showMenu(wrapper)
    const items = document.querySelectorAll<HTMLElement>('.el-dropdown-menu__item')
    expect(
      Array.from(items, (item) => item.textContent?.replace(/^[☰↥⚙▦×]/u, '').trim()),
    ).toEqual(['基础设置', '导入知识', '店铺设置', '店铺后台', '关闭'])
    items[index]?.click()
    await flushPromises()
    expect(wrapper.emitted(events[index]!)).toHaveLength(1)
  }
  expect(wrapper.emitted('open')).toBeUndefined()
  expect(wrapper.emitted('toggleAi')).toBeUndefined()
})

it('菜单外点击与卸载清理浮层，错误仅显示短行和完整悬停提示', async () => {
  const wrapper = fixture()
  await wrapper.setProps({
    shop: { ...shop, runtime: { open: true, online: false, lastError: '连接失败，请重试登录' } },
  })
  expect(wrapper.text()).toContain('等待登录')
  expect(wrapper.get('.store-error').attributes('title')).toBe('连接失败，请重试登录')
  await showMenu(wrapper)
  await new Promise((resolve) => setTimeout(resolve, 60))
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await vi.waitFor(() =>
    expect(document.querySelector('.el-dropdown__popper')?.getAttribute('aria-hidden')).toBe(
      'true',
    ),
  )
  await showMenu(wrapper)
  wrapper.unmount()
  await flushPromises()
  expect(document.querySelector('.el-dropdown__popper')).toBeNull()
})

it('菜单项获得焦点后按 Enter 只执行基础设置，不同时打开店铺或切换 AI', async () => {
  const wrapper = fixture()
  await showMenu(wrapper)
  const setup = document.querySelector<HTMLElement>('[role="menuitem"]')
  expect(setup).not.toBeNull()
  setup?.focus()
  setup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  await flushPromises()
  expect(wrapper.emitted('setup')).toHaveLength(1)
  expect(wrapper.emitted('open')).toBeUndefined()
  expect(wrapper.emitted('toggleAi')).toBeUndefined()
})

it('支持键盘打开与 Escape 关闭，切换店铺关闭旧菜单，忙时禁用动作', async () => {
  const wrapper = fixture()
  const card = wrapper.get('.store-sidebar-card')
  await card.trigger('keydown', { key: 'F10', shiftKey: true })
  await flushPromises()
  await vi.waitFor(() =>
    expect(document.querySelector('.el-dropdown__popper')?.getAttribute('aria-hidden')).toBe(
      'false',
    ),
  )
  await card.trigger('keydown', { key: 'Escape' })
  await flushPromises()
  await vi.waitFor(() =>
    expect(document.querySelector('.el-dropdown__popper')?.getAttribute('aria-hidden')).toBe(
      'true',
    ),
  )
  await showMenu(wrapper)
  await wrapper.setProps({ shop: { ...shop, id: 'other' } })
  await flushPromises()
  await vi.waitFor(() =>
    expect(document.querySelector('.el-dropdown__popper')?.getAttribute('aria-hidden')).toBe(
      'true',
    ),
  )
  await wrapper.setProps({ busy: true })
  await card.trigger('click')
  await wrapper.get('[role="switch"]').trigger('click')
  await card.trigger('keydown', { key: 'ContextMenu' })
  expect(wrapper.emitted('open')).toBeUndefined()
  expect(wrapper.emitted('toggleAi')).toBeUndefined()
})
