import { expect, it } from 'vitest'
import { navGroups, panelRegistry, resolvePanelKey } from '../src/app/navigation'

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
