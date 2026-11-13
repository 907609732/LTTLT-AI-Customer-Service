import { describe, expect, it } from 'vitest'
import { isExternalUrl, isScreenPoint } from '../electron/policy'
import { createDemoServices } from '../src/app/services'

describe('桌面输入边界', () => {
  it('接受有限坐标并拒绝非法输入', () => {
    expect(isScreenPoint({ screenX: -100, screenY: 0 })).toBe(true)
    for (const input of [
      null,
      {},
      { screenX: NaN, screenY: 0 },
      { screenX: Infinity, screenY: 0 },
      { screenX: '10', screenY: 0 },
    ])
      expect(isScreenPoint(input)).toBe(false)
  })
  it('只接受无凭证的 HTTP(S) 地址', () => {
    expect(isExternalUrl('https://example.com/docs')).toBe(true)
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/secret',
      'https://user:password@example.com',
      'broken',
      123,
    ])
      expect(isExternalUrl(url)).toBe(false)
  })
})

describe('演示服务', () => {
  it('不伪造真实授权、店铺或业务能力', () => {
    const services = createDemoServices()
    expect(services.account.getSummary().authenticated).toBe(false)
    expect(services.shops.list()).toEqual({ rows: [], total: 0, page: 1, pageSize: 20 })
    expect(services.account.login.status).toBe('unavailable')
    expect(services.billing.pay.status).toBe('unavailable')
    expect(services.auxiliary.reply.status).toBe('unavailable')
  })
  it('不同服务实例和查询结果没有可变数据串扰', () => {
    const first = createDemoServices(),
      second = createDemoServices()
    first.account.login.status = 'demo'
    first.shops.list().rows.push({ id: 'demo', name: 'demo', platform: 'demo' })
    expect(second.account.login.status).toBe('unavailable')
    expect(first.shops.list().rows).toEqual([])
  })
})
