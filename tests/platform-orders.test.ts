import { describe, expect, it } from 'vitest'
import { parsePlatformMoney, parsePddOrderPage } from '../electron/platform-order-parser'
import { orderRangeSchema, summarizeOrders } from '../src/shared/contracts/platform-orders'

describe('平台订单真实口径', () => {
  it('金额以整数分解析，未知值不能冒充零', () => {
    expect(parsePlatformMoney('¥1,234.50')).toBe(123450)
    expect(parsePlatformMoney('0.01')).toBe(1)
    expect(parsePlatformMoney('—')).toBeNull()
    expect(() => parsePlatformMoney('12.345')).toThrow()
    expect(() => parsePlatformMoney('-1.00')).toThrow()
  })
  it('只接受实际日历、顺序和90日内的订单查询范围', () => {
    expect(orderRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false)
    expect(orderRangeSchema.safeParse({ from: '2026-03-02', to: '2026-03-01' }).success).toBe(false)
    expect(orderRangeSchema.safeParse({ from: '2026-01-01', to: '2026-11-14' }).success).toBe(false)
    expect(orderRangeSchema.parse({ from: '2026-11-14', to: '2026-11-14' }).timezone).toBe(
      'Asia/Shanghai',
    )
  })
  it('核对原平台筛选、表头、页码和总数；解析真实业务字段', () => {
    const result = parsePddOrderPage(fixture())
    expect(result.orders[0]).toMatchObject({
      id: '261114-123456789012345',
      receivedCents: 1234,
      goodsAmountCents: 1500,
      refundedCents: null,
      status: 'unshipped',
    })
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.orders[0]).not.toHaveProperty('shippingAddress')
    expect(() => parsePddOrderPage({ ...fixture(), orderStatus: '待发货' })).toThrow(/筛选/)
    expect(() => parsePddOrderPage({ ...fixture(), captcha: true })).toThrow(/验证码/)
    expect(() =>
      parsePddOrderPage({ ...fixture(), url: 'https://example.com/orders/list' }),
    ).toThrow()
    const invalidTime = fixture()
    invalidTime.blocks[0].created = '2026-11-14 24:00:00'
    expect(() => parsePddOrderPage(invalidTime)).toThrow('时间')
  })
  it('明确空结果才返回零，未知退款与实收不合并为零或净营收', () => {
    expect(() =>
      parsePddOrderPage({ ...fixture(), blocks: [], total: 0, emptyConfirmed: false }),
    ).toThrow()
    expect(
      parsePddOrderPage({ ...fixture(), blocks: [], total: 0, emptyConfirmed: true }).orders,
    ).toEqual([])
    const rows = parsePddOrderPage(fixture()).orders
    expect(summarizeOrders(rows)).toMatchObject({
      orders: 1,
      receivedCents: 1234,
      refundedCents: null,
      unknownRefunds: 1,
    })
    expect(summarizeOrders([{ ...rows[0], receivedCents: null }]).receivedCents).toBeNull()
  })
})

export function fixture() {
  return {
    url: 'https://mms.pinduoduo.com/orders/list?msfrom=mms_sidenav',
    platformStoreId: 'mall-fixture',
    orderStatus: '全部',
    aftersaleStatus: '全部',
    range: { from: '2026-11-14', to: '2026-11-14' },
    page: 1,
    total: 1,
    hasNext: false,
    emptyConfirmed: false,
    captcha: false,
    headers: ['商品信息', '订单/售后状态', '数量', '商品总价(元)', '实收金额(元)', '买家'],
    blocks: [
      {
        id: '261114-123456789012345',
        created: '2026-11-14 10:00:00',
        paid: '2026-11-14 10:01:00',
        cells: ['合成测试商品', '待发货\n无售后', '1', '15.00', '12.34', '买家已脱敏'],
      },
    ],
  }
}
