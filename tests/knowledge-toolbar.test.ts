import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import KnowledgeToolbar from '../src/modules/knowledge/components/KnowledgeToolbar.vue'
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})
function fixture() {
  const wrapper = mount(KnowledgeToolbar, {
    attachTo: document.body,
    props: {
      busy: false,
      storeId: 'a',
      tab: 'products',
      contextKey: 'w:a:products:library',
      readOnly: false,
      capabilities: { catalog: true, import: true, learn: true },
    },
    global: { stubs: { transition: false } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function visibleMenus() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).filter((node) =>
    node.closest('[aria-hidden="false"]'),
  )
}
async function open(wrapper: ReturnType<typeof fixture>, label: string) {
  await wrapper
    .findAll('button')
    .find((b) => b.text().startsWith(label))!
    .trigger('click')
  await flushPromises()
  await vi.waitFor(() => {
    expect(visibleMenus()).toHaveLength(1)
    expect(visibleMenus()[0]!.textContent).toContain(
      label === '导出' ? '导出JSON' : label === '备份' ? '全库备份' : '导入平台商品',
    )
  })
  return visibleMenus()[0]!
}
it('shows exactly four entries and opens import only on click with all four original actions', async () => {
  const wrapper = fixture()
  expect(wrapper.findAll('button').map((b) => b.text().replace('⌄', '').trim())).toEqual([
    '导入商品',
    '＋ 自己写一件',
    '导出',
    '备份',
  ])
  expect(visibleMenus()).toHaveLength(0)
  await wrapper.findAll('button')[0]!.trigger('mouseenter')
  await flushPromises()
  expect(visibleMenus()).toHaveLength(0)
  const menu = await open(wrapper, '导入商品')
  expect(
    Array.from(menu.querySelectorAll('[role="menuitem"]'), (n) => n.textContent?.trim()),
  ).toEqual(['导入平台商品', '导入本机归档聊天', '学习本店通用资料', '导入商品CSV / 通用资料'])
  const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
  items[0]!.click()
  await flushPromises()
  expect(wrapper.emitted('catalog')).toHaveLength(1)
  await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
})
it('routes grouped export and backup commands, and keeps manual write independent', async () => {
  const wrapper = fixture()
  for (const [label, index, event] of [
    ['导出', 0, 'exportJson'],
    ['导出', 1, 'exportCsv'],
    ['备份', 0, 'backup'],
    ['备份', 1, 'restore'],
  ] as const) {
    const menu = await open(wrapper, label)
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]')[index]!.click()
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.emitted(event)).toHaveLength(1))
    await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
  }
  await wrapper.get('[data-testid="write-one"]').trigger('click')
  expect(wrapper.emitted('write')).toHaveLength(1)
})
it('disables only original unavailable import operations and manual write restrictions', async () => {
  const wrapper = fixture()
  await wrapper.setProps({
    capabilities: { catalog: false, import: false, learn: false },
    readOnly: true,
  })
  const menu = await open(wrapper, '导入商品')
  for (const item of menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
    expect(item.getAttribute('aria-disabled')).toBe('true')
    item.click()
  }
  await flushPromises()
  expect(wrapper.emitted('catalog')).toBeUndefined()
  expect(wrapper.emitted('archive')).toBeUndefined()
  expect(wrapper.emitted('learn')).toBeUndefined()
  expect(wrapper.emitted('sources')).toBeUndefined()
  expect(wrapper.get('[data-testid="write-one"]').attributes('disabled')).toBeDefined()
  await wrapper.setProps({ busy: true, readOnly: false })
  expect(wrapper.get('[data-testid="write-one"]').attributes('disabled')).toBeDefined()
  // Export/backup historically remain available while busy: preserve their original gating.
  expect(
    (await open(wrapper, '导出')).querySelector('[role="menuitem"]')?.getAttribute('aria-disabled'),
  ).not.toBe('true')
})
it('menus are exclusive and close for context change, Escape and outside click', async () => {
  const wrapper = fixture()
  await open(wrapper, '导入商品')
  const exportMenu = await open(wrapper, '导出')
  expect(exportMenu.textContent).toContain('导出JSON')
  expect(visibleMenus()).toHaveLength(1)
  await wrapper.setProps({ contextKey: 'w:b:products:library' })
  await flushPromises()
  await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
  const backupMenu = await open(wrapper, '备份')
  backupMenu.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
  )
  await flushPromises()
  await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
  await open(wrapper, '导入商品')
  // Tooltip installs the outside-click listener after its entrance transition.
  await new Promise((resolve) => setTimeout(resolve, 60))
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
  await wrapper.setProps({ tab: 'general', contextKey: 'other' })
  expect(wrapper.findAll('button')[0]!.text()).toContain('导入资料')
})

it('all import items route to their distinct original operations and general tab keeps contextual label', async () => {
  const wrapper = fixture()
  for (const [index, event] of [
    [0, 'catalog'],
    [1, 'archive'],
    [2, 'learn'],
    [3, 'sources'],
  ] as const) {
    const menu = await open(wrapper, '导入商品')
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]')[index]!.click()
    await vi.waitFor(() => expect(wrapper.emitted(event)).toHaveLength(1))
    await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
  }
  await wrapper.setProps({ tab: 'general', contextKey: 'w:a:general:library' })
  expect((await open(wrapper, '导入资料')).textContent).toContain('导入本店通用资料')
})
it('keyboard ArrowDown opens the dropdown and Escape dismisses its focused menu', async () => {
  const wrapper = fixture(),
    trigger = wrapper.findAll('button')[0]!
  await trigger.trigger('keydown', { key: 'ArrowDown', code: 'ArrowDown' })
  await vi.waitFor(() => expect(visibleMenus()).toHaveLength(1))
  visibleMenus()[0]!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
  )
  await vi.waitFor(() => expect(visibleMenus()).toHaveLength(0))
})
