import { afterEach, describe, expect, it, vi } from 'vitest'
import { performPddChatAction, readPddChatDom } from '../electron/platform-learning-chat'
afterEach(() => vi.unstubAllGlobals())
describe('observed native chat range controls', () => {
  it('selects the matching month with native pointer events while refusing disabled older dates', () => {
    vi.stubGlobal('location', new URL('https://mms.pinduoduo.com/mms-chat/search'))
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"></main><div data-testid="beast-core-rangePicker-dropdown-contentRoot"><section class="RPR_panelHeader_fixture"><input value="2026年"><span class="RPR_dateText_fixture">11月</span></section><table><tbody><tr><td role="date-cell" class="RPR_disabled_fixture">1</td><td role="date-cell">10</td></tr></tbody></table></div>`
    const events: string[] = [],
      date = document.querySelectorAll('td')[1]!
    for (const type of ['mousedown', 'mouseup', 'click'])
      date.addEventListener(type, () => events.push(type))
    performPddChatAction({ action: 'date', date: '2026-11-10' })
    expect(events).toEqual(['mousedown', 'mouseup', 'click'])
    expect(() => performPddChatAction({ action: 'date', date: '2026-11-01' })).toThrow('开放范围')
    expect(events).toHaveLength(3)
  })
  it('refuses a mismatched source or date range without submitting the query', () => {
    vi.stubGlobal('location', new URL('https://mms.pinduoduo.com/mms-chat/search'))
    document.body.innerHTML =
      '<main id="pdd-app-skeleton-main-content"><label data-checked="true">按客服账号查询</label><input placeholder="请选择" value="全部"><input data-testid="beast-core-rangePicker-htmlInput" value="2026-11-10 ~ 2026-11-14"><button>查询</button></main>'
    let queries = 0
    document.querySelector('button')!.addEventListener('click', () => queries++)
    expect(() =>
      performPddChatAction({ action: 'query', from: '2026-11-01', to: '2026-11-14' }),
    ).toThrow('日期范围')
    expect(queries).toBe(0)
    vi.stubGlobal('location', new URL('https://example.com/mms-chat/search'))
    expect(readPddChatDom().recognized).toBe(false)
    expect(() =>
      performPddChatAction({ action: 'query', from: '2026-11-10', to: '2026-11-14' }),
    ).toThrow('来源')
  })
  it('uses the message footer rather than the independent consumer pagination', () => {
    vi.stubGlobal('location', new URL('https://mms.pinduoduo.com/mms-chat/search'))
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><label data-checked="true">按客服账号查询</label><input placeholder="请选择" value="全部"><input data-testid="beast-core-rangePicker-htmlInput" value="2026-11-08 ~ 2026-11-14"><div class="cs-message-table-header">消费者账号 聊天记录</div><div class="cs-list"><div class="user-item is-active"><span class="user-name">买***</span></div></div><div class="table-section-left-footer"><li class="PGT_simplePager_fixture" title="4/4"></li><li data-testid="beast-core-pagination-next" class="PGT_disabled_fixture"></li></div><div class="table-section-right-footer"><li class="PGT_pagerItem_fixture PGT_pagerItemActive_fixture">1</li><li data-testid="beast-core-pagination-next"></li></div></main>`
    let left = 0,
      right = 0
    document
      .querySelector('.table-section-left-footer [data-testid="beast-core-pagination-next"]')!
      .addEventListener('click', () => left++)
    document
      .querySelector('.table-section-right-footer [data-testid="beast-core-pagination-next"]')!
      .addEventListener('click', () => right++)
    const dom = readPddChatDom()
    expect(dom.messagePage).toBe(1)
    expect(dom.messageHasNext).toBe(true)
    performPddChatAction({ action: 'message-next', page: 1 })
    expect(right).toBe(1)
    expect(left).toBe(0)
  })
})
