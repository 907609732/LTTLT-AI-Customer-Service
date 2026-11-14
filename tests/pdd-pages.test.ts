import { createAssistPlatformReader } from '../electron/assist-platform-reader'
import type { WebContents } from 'electron'
import { pddAfterSaleDetailId } from '../electron/assist-platform-pdd'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  readPddPagination,
  clickPddPage,
  readPddAfterSaleDom,
} from '../electron/assist-platform-pdd'
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function pager(current = 1, nextDisabled = false) {
  document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><ul class="PGT_outerWrapper_5-163-0"><li class="PGT_totalText_5-163-0">共有57条</li><li class="PGT_prev_5-163-0 ${current === 1 ? 'PGT_disabled_5-163-0' : ''}"></li>${[1, 2, 3, 4, 5, 6].map((n) => `<li class="PGT_pagerItem_5-163-0 ${n === current ? 'PGT_pagerItemActive_5-163-0' : ''}">${n}</li>`).join('')}<li class="PGT_next_5-163-0 ${nextDisabled ? 'PGT_disabled_5-163-0' : ''}"></li></ul></main>`
}
describe('拼多多真实分页控件及非空售后', () => {
  it('识别首/中/尾页，拒绝总数矛盾和重复活动页', () => {
    pager()
    expect(readPddPagination(57, 10)).toEqual({ current: 1, hasNext: true, hasPrevious: false })
    pager(2)
    expect(readPddPagination(57, 10)).toEqual({ current: 2, hasNext: true, hasPrevious: true })
    pager(6, true)
    expect(readPddPagination(57, 7)).toEqual({ current: 6, hasNext: false, hasPrevious: true })
    expect(readPddPagination(58, 7)).toBeNull()
    document
      .querySelector('ul')!
      .insertAdjacentHTML('beforeend', '<li class="PGT_pagerItemActive_5-163-0">2</li>')
    expect(readPddPagination(57, 7)).toBeNull()
  })
  it('只点击页码控件，页码不匹配/末页/验证码时不点击', () => {
    pager(2)
    const next = vi.fn(),
      first = vi.fn()
    document.querySelector('[class*="PGT_next_"]')!.addEventListener('click', next)
    document.querySelector('[class*="PGT_pagerItem_"]')!.addEventListener('click', first)
    clickPddPage('next', 2)
    expect(next).toHaveBeenCalledTimes(1)
    clickPddPage('first', 2)
    expect(first).toHaveBeenCalledTimes(1)
    expect(() => clickPddPage('next', 1)).toThrow()
    expect(() => clickPddPage('next', 2, () => true)).toThrow('verification')
    pager(6, true)
    expect(() => clickPddPage('next', 6)).toThrow()
  })
  it('真实单页空态有总数才能认定完成', () => {
    document.body.innerHTML =
      '<main id="pdd-app-skeleton-main-content"><ul class="PGT_outerWrapper_5-163-0"><li class="PGT_totalText_5-163-0">共有0条</li></ul></main>'
    expect(readPddPagination(0, 0)).toEqual({ current: 1, hasNext: false, hasPrevious: false })
    expect(readPddPagination(1, 0)).toBeNull()
  })
  it('非空售后读取退款额、真实状态、订单号、原因和消费者时限，订单号不当售后ID', async () => {
    vi.stubGlobal('location', {
      origin: 'https://mms.pinduoduo.com',
      pathname: '/aftersales/aftersale_list',
    })
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><div class="MmsUiQuickFilter___checked___fixture">待商家处理1</div><input value="近3个月内"><header>${['订单信息', '金额', '发货状态', '售后类型', '售后状态', '售后协商', '售后原因', '操作'].map((t) => `<div class="after-sales-table_header_cell__1Wwyg">${t}</div>`).join('')}</header><div class="after-sales-table_order_item__3QqLW"><div class="after-sales-table_item_header__iKpvC"><span class="table-item-header_sn__2gbGk">261100-1234567890123</span><div class="table-item-header_expiration__25BND">商家剩1天2时未处理，系统自动处理</div></div><div class="after-sales-table_item_content__3T6FE">${['测试商品', '<div class="table-item-amount_received__3qOsJ">实收：￥31.00</div><div class="table-item-amount_refund__1Htud">退款：￥29.00</div>', '已发货', '退货退款', '退货退款，待商家处理', '-', '其他原因', '<a>同意退款</a><a>查看详情</a>'].map((t) => `<div class="after-sales-table_item_cell__2Sn1_">${t}</div>`).join('')}</div></div><p>共有1条</p></main>`
    expect(readPddAfterSaleDom()).toMatchObject({
      recognized: true,
      total: 1,
      rows: [
        {
          rowIndex: 0,
          title: '退货退款 · 其他原因',
          status: '退货退款，待商家处理',
          orderNo: '261100-1234567890123',
          amount: '￥29.00',
          deadline: '商家剩1天2时未处理，系统自动处理',
        },
      ],
    })
    expect(readPddAfterSaleDom().rows[0]).not.toHaveProperty('id')
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<ul class="PGT_outerWrapper_fixture"><li class="PGT_totalText_fixture">共有1条</li></ul>',
      )
    const page = {
      getURL: () => 'https://mms.pinduoduo.com/aftersales/aftersale_list',
      executeJavaScript: async (script: string) => new Function(`return ${script}`)(),
    } as unknown as Pick<WebContents, 'getURL' | 'executeJavaScript'>
    let detail =
      'https://mms.pinduoduo.com/aftersales-ssr/detail?id=aftersale-fixture-a&orderSn=261100-1234567890123'
    const rememberDetail = vi.fn()
    const read = createAssistPlatformReader({
      page: () => page,
      collectionPage: async () => page,
      refreshQuery: async () => {},
      turnPage: async () => {},
      identityScript: () => `({authenticated:true,mallId:'mall-a'})`,
      observeAfterSaleDetail: async () => detail,
      rememberDetail,
    })
    const store = { id: 'store-a', platform: 'pdd-web', storeName: '测试店', identityId: 'mall-a' }
    expect(await read(store, 'aftersale')).toMatchObject({
      recognized: true,
      complete: true,
      total: 1,
      items: [{ id: 'aftersale-fixture-a', amount: '￥29.00', orderNo: '261100-1234567890123' }],
    })
    expect(rememberDetail).toHaveBeenCalledWith(
      'store-a',
      'aftersale',
      'aftersale-fixture-a',
      detail,
    )
    detail =
      'https://mms.pinduoduo.com/aftersales-ssr/detail?id=aftersale-fixture-a&orderSn=261100-9999999999999'
    await expect(read(store, 'aftersale')).rejects.toThrow('订单关联')

    document.querySelector('[class*="MmsUiQuickFilter___checked___"]')!.textContent = '待买家处理1'
    expect(readPddAfterSaleDom().recognized).toBe(false)
    document.querySelector('[class*="MmsUiQuickFilter___checked___"]')!.textContent = '待商家处理1'
    document.querySelector('p')!.textContent = '共有0条'
    expect(readPddAfterSaleDom().recognized).toBe(false)
  })
})

describe('售后详情来源', () => {
  it('仅接受核对的路由、独立售后编号和订单关联，拒绝外站和重复参数', () => {
    const url =
      'https://mms.pinduoduo.com/aftersales-ssr/detail?id=sale-a&orderSn=261100-1234567890123'
    expect(pddAfterSaleDetailId(url)).toBe('sale-a')
    for (const invalid of [
      url.replace('mms.pinduoduo.com', 'evil.test'),
      url.replace('aftersales-ssr/detail', 'aftersales/unknown'),
      url + '&id=sale-b',
      url.replace('&orderSn=261100-1234567890123', ''),
    ])
      expect(pddAfterSaleDetailId(invalid)).toBeUndefined()
  })
})
