import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pddTicketDetailId,
  readPddTicketDom,
  clickPddQuery,
  readPddAfterSaleDom,
  hasVisiblePddCaptcha,
} from '../electron/assist-platform-pdd'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function fixture() {
  vi.stubGlobal('location', {
    origin: 'https://mms.pinduoduo.com',
    pathname: '/aftersales/work_order/list',
  })
  document.body.innerHTML = `<main id="pdd-app-skeleton-main-content">
    <div class="IPT_mirror_5-163-0" style="visibility:hidden">待处理</div><input value="待处理"><input value="近60天内">
    <header class="listTable_cols__3G9oT">${['订单信息', '处理进度', '处理时间', '操作'].map((label) => `<div class="listTable_headerCell__2pfob">${label}</div>`).join('')}</header>
    <p>共查询到1个工单</p><section><div class="listItem_workOrderItem__1Spmf false"><div class="listItem_itemContent__1LMk6">
      <div class="listItem_itemCell__1Ues_">订单号：1234567890123456789\n创建时间：2026-11-14 10:00:00\n订单问题：物流进度咨询\n测试商品</div>
      <div class="listItem_itemCell__1Ues_"><div class="tableItemStatus_statusText__3Fsdj"><span>待处理</span></div><div>请您反馈当前的核实进度</div></div>
      <div class="listItem_itemCell__1Ues_">剩6时55分46秒</div>
      <div class="listItem_itemCell__1Ues_"><div class="listTable_operateBtn__1pefN">立即处理</div></div>
    </div></div></section><p>共有1条</p></main>`
}
describe('拼多多实页结构的脱敏夹具', () => {
  it('读取真实表头/待处理范围、订单信息和剩余时间，但不把订单号当工单ID', () => {
    fixture()
    const result = readPddTicketDom()
    expect(result).toMatchObject({
      recognized: true,
      total: 1,
      complete: true,
      rows: [
        {
          rowIndex: 0,
          title: '物流进度咨询',
          status: '待处理',
          orderNo: '1234567890123456789',
          deadline: '剩6时55分46秒',
        },
      ],
    })
    expect(result.rows[0]).not.toHaveProperty('id')
    expect(result.message).toContain('近60天')
  })
  it('筛选范围/表头变化、矛盾计数都拒绝，不用页面别处0推断空列表', () => {
    fixture()
    document.querySelector('input')!.value = '全部'
    expect(readPddTicketDom().recognized).toBe(false)
    fixture()
    document.querySelector('[class*="listTable_headerCell__"]')!.textContent = '新表头'
    expect(readPddTicketDom().recognized).toBe(false)
    fixture()
    document.querySelector('p')!.textContent = '共查询到0个工单'
    expect(readPddTicketDom().recognized).toBe(false)
  })
  it('只采用实页详情路由中的业务ID，拒绝未知路由/无ID/外站', () => {
    expect(
      pddTicketDetailId(
        'https://mms.pinduoduo.com/aftersales/work_order/tododetail?id=ticket-fixture-a',
      ),
    ).toBe('ticket-fixture-a')
    for (const url of [
      'https://mms.pinduoduo.com/aftersales/work_order/tododetail',
      'https://mms.pinduoduo.com/aftersales/work_order/unknown?id=x',
      'https://evil.test/aftersales/work_order/tododetail?id=x',
    ])
      expect(pddTicketDetailId(url)).toBeUndefined()
  })
  it('点击查询但不替换平台保存或正在使用的网络函数', () => {
    fixture()
    const query = document.createElement('button')
    query.textContent = '查询'
    document.querySelector('main')!.append(query)
    vi.spyOn(query, 'getClientRects').mockReturnValue([
      new DOMRect(10, 10, 60, 30),
    ] as unknown as DOMRectList)
    const click = vi.fn()
    query.addEventListener('click', click)
    const fetch = window.fetch,
      send = XMLHttpRequest.prototype.send
    clickPddQuery()
    expect(click).toHaveBeenCalledTimes(1)
    expect(window.fetch).toBe(fetch)
    expect(XMLHttpRequest.prototype.send).toBe(send)
  })
  it('售后仅在已选待商家处理、近3个月范围和真实空态都识别时报告0', () => {
    vi.stubGlobal('location', {
      origin: 'https://mms.pinduoduo.com',
      pathname: '/aftersales/aftersale_list',
    })
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><div class="MmsUiQuickFilter___content___2dnQe2-133-0 MmsUiQuickFilter___checked___3cUiW2-133-0"><span>投诉预警</span><span>0</span></div><div class="MmsUiQuickFilter___content___2dnQe2-133-0"><span>待商家处理</span><span>0</span></div><input value="近3个月内"><div>${['订单信息', '金额', '发货状态', '售后类型', '售后状态', '售后协商', '售后原因', '操作'].map((label) => `<div class="after-sales-table_header_cell__1Wwyg">${label}</div>`).join('')}</div><div class="after-sales-table_empty_display__1rI7A">暂无售后单</div><p>共有0条</p></main>`
    expect(readPddAfterSaleDom().recognized).toBe(false)
    const filters = document.querySelectorAll('[class*="MmsUiQuickFilter___content___"]')
    filters[0].classList.remove('MmsUiQuickFilter___checked___3cUiW2-133-0')
    filters[1].classList.add('MmsUiQuickFilter___checked___3cUiW2-133-0')
    expect(readPddAfterSaleDom()).toMatchObject({ recognized: true, total: 0, complete: true })
    const header = document.createElement('div')
    header.className = 'after-sales-table_header_cell__1Wwyg'
    header.innerHTML = '<input type="checkbox">'
    document.querySelector('[class*="after-sales-table_header_cell__"]')!.before(header)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 12))
    document
      .querySelector('input:not([type="checkbox"])')!
      .setAttribute('value', '2026-08-14 00:00:00 ~ 2026-11-14 23:59:59')
    expect(readPddAfterSaleDom()).toMatchObject({ recognized: true, total: 0, complete: true })
    document
      .querySelector('input:not([type="checkbox"])')!
      .setAttribute('value', '2026-08-01 00:00:00 ~ 2026-11-14 23:59:59')
    expect(readPddAfterSaleDom().recognized).toBe(false)
    document.querySelector('input:not([type="checkbox"])')!.setAttribute('value', '近3个月内')

    document.querySelector('[class*="after-sales-table_empty_display__"]')!.remove()
    expect(readPddAfterSaleDom().recognized).toBe(false)
  })
  it('未绘制页面仍识别可见验证码且阻止查询，隐藏残留不阻止', () => {
    fixture()
    const captcha = document.createElement('div')
    captcha.textContent = '请向右滑块完成拼图'
    document.body.append(captcha)
    vi.spyOn(captcha, 'getClientRects').mockReturnValue([
      new DOMRect(10, 10, 200, 40),
    ] as unknown as DOMRectList)
    expect(hasVisiblePddCaptcha()).toBe(true)
    expect(() => clickPddQuery('ticket', hasVisiblePddCaptcha)).toThrow(
      'platform_verification_required',
    )
    captcha.style.display = 'none'
    expect(hasVisiblePddCaptcha()).toBe(false)
  })
})
