import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurePddOrderDate } from '../electron/pdd-order-date'
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
describe('订单原生日期口径', () => {
  it('新隐藏窗口的原生进入动画opacity为0时仍能设置已挂载时间控件', async () => {
    document.body.innerHTML = `<input data-testid="beast-core-rangePicker-htmlInput" readonly value="2026-11-13 10:00:00 ~ 2026-11-14 10:00:00"><div data-testid="beast-core-rangePicker-dropdown-contentRoot"><div class="RPR_headerWrapper_x"><section class="RPR_panelHeader_x"><input value="2026年"><span class="RPR_dateText_x">11月</span></section><section class="RPR_panelHeader_x"><input value="2026年"><span class="RPR_dateText_x">11月</span></section></div><table data-testid="beast-core-rangePicker-table"><tr><td><div class="RPR_cell_x" title="13">13</div></td><td><div class="RPR_cell_x" title="14">14</div></td></tr></table><table data-testid="beast-core-rangePicker-table"></table><a>归零</a><input data-testid="beast-core-rangePicker-timePicker-htmlInput-begin" value="10:00:00"><input data-testid="beast-core-rangePicker-timePicker-htmlInput-end" value="10:00:00"><button>确认</button></div><div class="PT_portalEnterActive_x" style="opacity:0"><ul data-testid="beast-core-timePicker-list-hh"><li>23</li></ul><ul data-testid="beast-core-timePicker-list-mm"><li>59</li></ul><ul data-testid="beast-core-timePicker-list-ss"><li>59</li></ul></div>`
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      {} as DOMRect,
    ] as unknown as DOMRectList)
    const begin = document.querySelector<HTMLInputElement>('[data-testid$="htmlInput-begin"]')!,
      end = document.querySelector<HTMLInputElement>('[data-testid$="htmlInput-end"]')!
    document.querySelector('a')!.addEventListener('click', () => {
      begin.value = end.value = '00:00:00'
    })
    const parts = ['00', '00', '00']
    for (const [index, option] of Array.from(document.querySelectorAll('li')).entries())
      option.addEventListener('click', () => {
        parts[index] = option.textContent!
        end.value = parts.join(':')
      })
    document.querySelector('button')!.addEventListener('click', () => {
      document.querySelector<HTMLInputElement>(
        '[data-testid="beast-core-rangePicker-htmlInput"]',
      )!.value = `2026-11-13 ${begin.value} ~ 2026-11-14 ${end.value}`
    })
    await expect(
      configurePddOrderDate({ from: '2026-11-13', to: '2026-11-14' }),
    ).resolves.toBeUndefined()
    expect(end.value).toBe('23:59:59')
  })
  it('已有准确整日范围时不触碰原生选择器', async () => {
    document.body.innerHTML =
      '<input data-testid="beast-core-rangePicker-htmlInput" value="2026-11-14 00:00:00 ~ 2026-11-14 23:59:59">'
    await expect(
      configurePddOrderDate({ from: '2026-11-14', to: '2026-11-14' }),
    ).resolves.toBeUndefined()
  })
  it('真实日期控件缺失时停止，不能直接改readonly值冒充已应用筛选', async () => {
    document.body.innerHTML = '<input readonly value="近90日">'
    await expect(configurePddOrderDate({ from: '2026-11-14', to: '2026-11-14' })).rejects.toThrow(
      '日期',
    )
    expect(document.querySelector('input')!.value).toBe('近90日')
  })
})
