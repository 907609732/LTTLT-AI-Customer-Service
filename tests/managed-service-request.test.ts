import { describe, expect, it } from 'vitest'
import { validateManagedServiceRequest } from '../electron/managed-service-request'

describe('托管业务请求边界', () => {
  it('允许当前账号查单和关闭订单，拒绝相邻、转义与摘要端点', () => {
    expect(() => validateManagedServiceRequest('/billing/orders/order_1')).not.toThrow()
    expect(() =>
      validateManagedServiceRequest('/billing/orders/order_1/close', { method: 'POST' }),
    ).not.toThrow()
    for (const path of [
      '/billing/orders/order_1/close',
      '/billing/orders/%2f',
      '/billing/orders/a/admin',
      '/billing/orders/',
      '/billing/orders/order_1/close?x=1',
    ])
      expect(() => validateManagedServiceRequest(path)).toThrow()
    // 摘要走主进程专用协议，不能经业务代理调用。
    expect(() => validateManagedServiceRequest('/chat/summaries', { method: 'POST' })).toThrow()
  })
  it('仅接受团队和计费的已实现路由及相应读写方法', () => {
    expect(() =>
      validateManagedServiceRequest('/teams/1/actions', {
        method: 'POST',
        body: { action: 'note' },
      }),
    ).not.toThrow()
    expect(() =>
      validateManagedServiceRequest('/billing/orders', {
        method: 'POST',
        body: { plan_id: 'p', request_id: 'r' },
      }),
    ).not.toThrow()
    for (const [endpoint, method] of [
      ['/billing/admin', 'POST'],
      ['/teams/1/actions', 'GET'],
      ['/teams/1', 'DELETE'],
      ['/billing', 'POST'],
      ['/teams/01', 'GET'],
      ['/teams/1/accept', 'GET'],
    ])
      expect(() => validateManagedServiceRequest(endpoint!, { method })).toThrow()
  })
  it('拒绝路径绕过、GET正文以及过大写入', () => {
    for (const endpoint of [
      '/teams/../billing',
      '/teams/%31',
      'https://evil.test/teams',
      '/teams?token=x',
    ])
      expect(() => validateManagedServiceRequest(endpoint)).toThrow()
    expect(() => validateManagedServiceRequest('/teams', { body: {} })).toThrow()
    expect(() =>
      validateManagedServiceRequest('/teams', {
        method: 'POST',
        body: { name: 'x'.repeat(140000) },
      }),
    ).toThrow()
  })
})
