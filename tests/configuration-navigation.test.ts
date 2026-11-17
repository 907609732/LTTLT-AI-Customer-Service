import { expect, it } from 'vitest'
import { navGroups, panelRegistry, resolvePanelKey } from '../src/app/navigation'
import { routes } from '../src/app/router'

it('配置中心只保留AI训练场，不再显示模拟客服台或模型定制', () => {
  const titles = navGroups.flatMap((group) => group.items.map((item) => item.title))
  expect(titles).toContain('AI训练场')
  expect(titles).not.toContain('模拟客服台')
  expect(titles).not.toContain('模型定制')
  for (const title of ['登录账号', '软件偏好', '团队管理', '我的订单', '算力消耗'])
    expect(titles).not.toContain(title)
  expect(Object.keys(panelRegistry)).not.toContain('aicustom')
  expect(Object.keys(panelRegistry)).not.toContain('sim')
})
it('旧模拟客服台地址进入训练场，旧模型定制地址回店铺基础设置入口', () => {
  expect(resolvePanelKey('sim')).toBe('training')
  expect(resolvePanelKey('aicustom')).toBe('shops')
  for (const key of ['team', 'general', 'account']) expect(resolvePanelKey(key)).toBe('shops')
})

it('旧接待页面不再注册，旧地址回到店铺入口', () => {
  for (const key of ['transfer', 'welcome']) {
    expect(Object.keys(panelRegistry)).not.toContain(key)
    expect(resolvePanelKey(key)).toBe('shops')
  }
})

it('删除跨店同步菜单和页面注册，旧查询回到店铺列表', () => {
  expect(
    navGroups.flatMap((group) => group.items).some((item) => item.key === ('sync' as string)),
  ).toBe(false)
  expect(Object.keys(panelRegistry)).not.toContain('sync')
  expect(resolvePanelKey('sync')).toBe('shops')
})

it('删除占位开发中面板，旧地址回到店铺列表', () => {
  for (const key of ['learn', 'supervise', 'drill']) {
    expect(Object.keys(panelRegistry)).not.toContain(key)
    expect(resolvePanelKey(key)).toBe('shops')
  }
  // 真实训练与学习入口仍保留自己的面板键。
  expect(resolvePanelKey('training')).toBe('training')
  expect(resolvePanelKey('intent-doc')).toBe('intent-doc')
})

it('旧店铺首页只保留兼容跳转到配置中心数据看板', () => {
  const legacy = routes.find((route) => route.path === '/shop/home')
  expect(legacy?.redirect).toBe('/shop/manage?panel=home')
  expect(legacy?.component).toBeUndefined()
  expect(Object.keys(panelRegistry)).toContain('home')
})
