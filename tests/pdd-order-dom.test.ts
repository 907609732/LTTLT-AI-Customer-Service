import { afterEach, describe, expect, it } from 'vitest'
import { readPddOrderDom } from '../electron/pdd-order-dom'
import { parsePddOrderPage } from '../electron/platform-order-parser'
const range = {
  from: '2026-11-01',
  to: '2026-11-14',
  timezone: 'Asia/Shanghai' as const,
  timeField: 'created' as const,
  status: 'all' as const,
}
afterEach(() => {
  document.body.innerHTML = ''
})
function fixture() {
  document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><label>订单状态<input readonly value="全部"></label><label>售后状态<input readonly value="全部"></label><label>订单下单时间<input readonly value="2026-11-01 00:00:00 ~ 2026-11-14 23:59:59"></label><p>共查询到 1 个订单</p><table><thead><tr><th></th><th>商品信息</th><th>订单/售后状态</th><th>数量</th><th>商品总价(元)</th><th>实收金额(元)</th><th>收货信息</th><th>买家</th><th>操作/备注</th></tr></thead></table><table><tbody><tr><td colspan="9">订单编号：261114-123456789012345 成交时间：2026-11-14 14:41</td></tr><tr><td></td><td>脱敏商品 规格A</td><td>已完成</td><td>2</td><td>14.90</td><td>14.90</td><td>不可输出地址</td><td>买*** 发起聊天</td><td>查看详情</td></tr></tbody></table><p>共有 1 条</p></main>`
}
describe('原生拼多多订单页面读取', () => {
  it('页码已切换但订单行仍是上一页时等待真实内容替换', () => {
    fixture()
    const root = document.querySelector('main')!
    root.insertAdjacentHTML('beforeend', '<span class="PGT_pagerItemActive_fixture">2</span>')
    const input = {
      range,
      platformStoreId: 'mall-1',
      url: 'https://mms.pinduoduo.com/orders/list',
      previousOrderIds: ['261114-123456789012345'],
    }
    expect(() => readPddOrderDom(input)).toThrow('订单行尚未切换')
    document.querySelector('tbody tr td')!.textContent =
      '订单编号：261114-123456789012346 成交时间：2026-11-14 14:41'
    expect(readPddOrderDom(input).page).toBe(2)
  })
  it('核对真实语义表头、筛选及总数，不输出收件地址或编造成交时间字段', () => {
    fixture()
    const raw = readPddOrderDom({
      range,
      platformStoreId: 'mall-1',
      url: 'https://mms.pinduoduo.com/orders/list',
    })
    const page = parsePddOrderPage(raw)
    expect(page.orders).toHaveLength(1)
    expect(page.orders[0]).toMatchObject({
      receivedCents: 1490,
      quantity: 2,
      createdAt: null,
      paidAt: null,
    })
    expect(JSON.stringify(raw)).not.toContain('不可输出地址')
  })
  it('识别实页合并商品列，并拒绝其他有值的买家/订单筛选', () => {
    fixture()
    const row = document.querySelectorAll('tbody tr')[1]
    row.children[0].remove()
    ;(row.children[0] as HTMLTableCellElement).colSpan = 2
    expect(
      parsePddOrderPage(
        readPddOrderDom({
          range,
          platformStoreId: 'mall-1',
          url: 'https://mms.pinduoduo.com/orders/list',
        }),
      ).orders[0].quantity,
    ).toBe(2)
    const filter = document.createElement('input')
    filter.value = 'specific-order'
    document.querySelector('main')!.append(filter)
    expect(() =>
      readPddOrderDom({
        range,
        platformStoreId: 'mall-1',
        url: 'https://mms.pinduoduo.com/orders/list',
      }),
    ).toThrow('额外筛选')
  })
  it('选择日期或状态不一致时拒绝发布全部订单', () => {
    fixture()
    document.querySelector('input')!.value = '待发货'
    expect(() =>
      readPddOrderDom({
        range,
        platformStoreId: 'mall-1',
        url: 'https://mms.pinduoduo.com/orders/list',
      }),
    ).toThrow('筛选')
    fixture()
    expect(() =>
      readPddOrderDom({
        range: { ...range, from: '2026-11-02' },
        platformStoreId: 'mall-1',
        url: 'https://mms.pinduoduo.com/orders/list',
      }),
    ).toThrow('日期')
  })
  it('分页总数冲突或下一页无法识别时拒绝完整性声明', () => {
    fixture()
    document.querySelector('p')!.textContent = '共查询到 2 个订单'
    expect(() =>
      readPddOrderDom({
        range,
        platformStoreId: 'mall-1',
        url: 'https://mms.pinduoduo.com/orders/list',
      }),
    ).toThrow('总数')
  })
})
