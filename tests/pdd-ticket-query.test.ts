import { afterEach, describe, expect, it, vi } from 'vitest'
import { preparePddTicketQuery } from '../electron/assist-platform-pdd'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function fixture(entering = false) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T12:00:00+08:00'))
  vi.stubGlobal('location', {
    origin: 'https://mms.pinduoduo.com',
    pathname: '/aftersales/work_order/list',
  })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 120, 30),
  ] as unknown as DOMRectList)
  document.body.innerHTML = `<main id="pdd-app-skeleton-main-content">
    <label>订单编号<input value="specific-order" placeholder="请输入订单编号"></label>
    <label>工单状态<input readonly data-testid="beast-core-select-htmlInput" value="全部"></label>
    <label>问题类型<input readonly data-testid="beast-core-select-htmlInput" value="物流问题"></label>
    <label>创建时间<input readonly data-testid="beast-core-select-htmlInput" value="近7天内"><input readonly data-testid="beast-core-rangePicker-htmlInput" value="2026-11-08 ~ 2026-11-14"></label>
    <button>查询</button><button>同意退款</button></main>`
  const nativeButtons = vi.fn()
  document
    .querySelectorAll('button')
    .forEach((button) => button.addEventListener('click', nativeButtons))
  for (const [index, value] of ['待处理', '全部', '近60天内'].entries()) {
    const input = document.querySelectorAll<HTMLInputElement>('input[readonly]')[index]
    input.addEventListener('click', () => {
      const menu = document.createElement('ul')
      if (entering) {
        menu.className = 'PT_portalEnterActive_fixture'
        menu.style.opacity = '0'
      }
      menu.innerHTML = `<li class="ST_itemRendererLabel_fixture">${value}</li>`
      menu.firstElementChild!.addEventListener('click', () => {
        input.value = value
        if (index === 2)
          document.querySelector<HTMLInputElement>(
            '[data-testid="beast-core-rangePicker-htmlInput"]',
          )!.value = '2026-09-15 ~ 2026-11-14'
        menu.remove()
      })
      document.body.append(menu)
    })
  }
  return { nativeButtons }
}

describe('工单原生查询准备', () => {
  it('首次默认全部和额外限制时选择待处理、全部问题、近60天，清除订单编号', async () => {
    const f = fixture()
    await preparePddTicketQuery()
    expect(Array.from(document.querySelectorAll('input')).map((input) => input.value)).toEqual([
      '',
      '待处理',
      '全部',
      '近60天内',
      '2026-09-15 ~ 2026-11-14',
    ])
    expect(f.nativeButtons).not.toHaveBeenCalled()
  })
  it('验证码存在时不改变筛选，不触发任何查询或业务动作', async () => {
    const f = fixture()
    await expect(preparePddTicketQuery(() => true)).rejects.toThrow('verification')
    expect(document.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe('全部')
    expect(f.nativeButtons).not.toHaveBeenCalled()
  })
  it('同名可见选项不唯一时停止，不猜测其中一个', async () => {
    fixture()
    document.body.insertAdjacentHTML(
      'beforeend',
      '<li class="ST_itemRendererLabel_fixture">待处理</li>',
    )
    await expect(preparePddTicketQuery()).rejects.toThrow('唯一')
  })
  it('预设标签正确但实际日期仍是其他范围时拒绝查询准备成功', async () => {
    fixture()
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid="beast-core-select-htmlInput"]',
    )[2].value = '近60天内'
    await expect(preparePddTicketQuery()).rejects.toThrow('实际日期')
  })
  it('未知额外限制不能被当作完整待处理范围', async () => {
    fixture()
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<input value="extra-filter">')
    await expect(preparePddTicketQuery()).rejects.toThrow('额外筛选')
  })
  it('忽略淡出的旧菜单，同名残留不能误拦当前选项', async () => {
    fixture()
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div style="opacity:0"><li class="ST_itemRendererLabel_fixture">待处理</li></div>',
    )
    await preparePddTicketQuery()
    expect(document.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe('待处理')
  })
  it('隐藏窗口进入动画opacity0时可以操作已挂载原生菜单', async () => {
    fixture(true)
    await preparePddTicketQuery()
    expect(document.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe('待处理')
  })
})
