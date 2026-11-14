import { describe, it, expect, vi, afterEach } from 'vitest'
import type { WebContents } from 'electron'
import { createAssistPlatformReader } from '../electron/assist-platform-reader'
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const store = { id: 'store-a', platform: 'pdd-web', storeName: '测试店', identityId: 'mall-a' }
function fixture(pages: string[][], initial = 1) {
  let current = initial
  let changedTotal = false,
    wrongIdentity = false,
    blocked = false,
    loggedOut = false,
    stuck = false
  const total = new Set(pages.flat()).size
  const render = () => {
    const rows = pages[current - 1]
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><input value="待处理"><input value="近60天内"><header>${['订单信息', '处理进度', '处理时间', '操作'].map((x) => `<div class="listTable_headerCell__fixture">${x}</div>`).join('')}</header><p>共查询到${total + (changedTotal ? 1 : 0)}个工单</p>${rows.map((_, i) => `<div class="listItem_workOrderItem__fixture">订单号：123456789${i}<div class="listItem_itemCell__fixture">订单问题：测试问题</div><div class="listItem_itemCell__fixture"><div class="tableItemStatus_statusText__fixture">待处理</div></div><div class="listItem_itemCell__fixture">剩1时</div><div class="listItem_itemCell__fixture"><div class="listTable_operateBtn__fixture">立即处理</div></div></div>`).join('')}<ul class="PGT_outerWrapper_fixture"><li class="PGT_totalText_fixture">共有${total + (changedTotal ? 1 : 0)}条</li><li class="PGT_prev_fixture ${current === 1 ? 'PGT_disabled_fixture' : ''}"></li><li class="PGT_pagerItem_fixture ${current === 1 ? 'PGT_pagerItemActive_fixture' : ''}">1</li>${current !== 1 ? `<li class="PGT_pagerItem_fixture PGT_pagerItemActive_fixture">${current}</li>` : ''}<li class="PGT_next_fixture ${current === pages.length ? 'PGT_disabled_fixture' : ''}"></li></ul></main>`
  }
  vi.stubGlobal('location', {
    origin: 'https://mms.pinduoduo.com',
    pathname: '/aftersales/work_order/list',
  })
  render()
  const page = {
    getURL: () => 'https://mms.pinduoduo.com/aftersales/work_order/list',
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes('hasVisiblePddCaptcha')) return blocked
      return new Function(`return ${script}`)()
    }),
  } as unknown as Pick<WebContents, 'getURL' | 'executeJavaScript'>
  const turnPage = vi.fn(async (_page: unknown, _kind: unknown, direction: string) => {
    if (!stuck) current = direction === 'first' ? 1 : current + 1
    render()
  })
  const observeTicketDetail = vi.fn(
    async (_id: string, index: number) =>
      `https://mms.pinduoduo.com/aftersales/work_order/tododetail?id=${pages[current - 1][index]}`,
  )
  const rememberDetail = vi.fn()
  const read = createAssistPlatformReader({
    page: () => page,
    collectionPage: async () => page,
    refreshQuery: async () => {},
    turnPage,
    identityScript: () =>
      `({authenticated:${!loggedOut},mallId:${JSON.stringify(wrongIdentity ? 'other' : 'mall-a')},storeName:'测试店'})`,
    observeTicketDetail,
    rememberDetail,
  })
  return {
    read,
    turnPage,
    observeTicketDetail,
    rememberDetail,
    setTotal: () => {
      changedTotal = true
      render()
    },
    setIdentity: () => {
      wrongIdentity = true
    },
    setLoggedOut: () => {
      loggedOut = true
    },
    setBlocked: () => {
      blocked = true
    },
    setStuck: () => {
      stuck = true
    },
  }
}
describe('跨页完整性与账号隔离', () => {
  it('从首/中页开始都读完各页，按真实工单ID去重', async () => {
    const f = fixture(
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      2,
    )
    const result = await f.read(store, 'ticket')
    expect(result).toMatchObject({ recognized: true, total: 3, complete: true })
    expect(result.items.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(f.turnPage.mock.calls.map((x) => x[2])).toEqual(['first', 'next'])
  })
  it('翻页无效不循环，不返回假的完整成功', async () => {
    const f = fixture([['a'], ['b']])
    f.setStuck()
    await expect(f.read(store, 'ticket')).rejects.toThrow('页码')
    expect(f.turnPage).toHaveBeenCalledTimes(1)
  })
  it('途中总数变化拒绝混合快照', async () => {
    const f = fixture([['a'], ['b']])
    const original = f.turnPage.getMockImplementation()!
    f.turnPage.mockImplementation(async (...args) => {
      await original(...args)
      f.setTotal()
    })
    await expect(f.read(store, 'ticket')).rejects.toThrow('总数')
  })
  it('途中账号切换禁止第二页详情观测', async () => {
    const f = fixture([['a'], ['b']])
    const original = f.turnPage.getMockImplementation()!
    f.turnPage.mockImplementation(async (...args) => {
      await original(...args)
      f.setIdentity()
    })
    await expect(f.read(store, 'ticket')).rejects.toThrow('身份')
    expect(f.observeTicketDetail).toHaveBeenCalledTimes(1)
  })
  it('下一页出现验证码立即停止，不再翻页', async () => {
    const f = fixture([['a'], ['b'], ['c']])
    const original = f.turnPage.getMockImplementation()!
    f.turnPage.mockImplementation(async (...args) => {
      await original(...args)
      f.setBlocked()
    })
    expect(await f.read(store, 'ticket')).toMatchObject({
      blocked: 'verification',
      recognized: false,
    })
    expect(f.turnPage).toHaveBeenCalledTimes(1)
  })
})

it('详情读取期间取消不缓存晚到编号', async () => {
  const f = fixture([['a']])
  const controller = new AbortController()
  const original = f.observeTicketDetail.getMockImplementation()!
  f.observeTicketDetail.mockImplementation(async (...args) => {
    const url = await original(...args)
    controller.abort()
    return url
  })
  await expect(f.read(store, 'ticket', controller.signal)).rejects.toThrow()
  expect(f.rememberDetail).not.toHaveBeenCalled()
})

it('详情读取期间账号变化不缓存编号或继续下一行', async () => {
  const f = fixture([['a', 'b']])
  const original = f.observeTicketDetail.getMockImplementation()!
  f.observeTicketDetail.mockImplementation(async (...args) => {
    const url = await original(...args)
    f.setIdentity()
    return url
  })
  await expect(f.read(store, 'ticket')).rejects.toThrow('身份')
  expect(f.rememberDetail).not.toHaveBeenCalled()
  expect(f.observeTicketDetail).toHaveBeenCalledTimes(1)
})

it('翻页中登录失效明确暂停，不伪装验证码', async () => {
  const f = fixture([['a'], ['b']])
  const original = f.turnPage.getMockImplementation()!
  f.turnPage.mockImplementation(async (...args) => {
    await original(...args)
    f.setLoggedOut()
  })
  expect(await f.read(store, 'ticket')).toMatchObject({ blocked: 'login', authenticated: false })
})
it('整页重复业务ID停止，避免下一页循环', async () => {
  const f = fixture([['a'], ['a'], ['b']])
  await expect(f.read(store, 'ticket')).rejects.toThrow('重复页')
  expect(f.turnPage).toHaveBeenCalledTimes(1)
})

it('达到翻页上限不提交部分结果，保留旧快照由collector处理', async () => {
  const f = fixture(Array.from({ length: 51 }, (_, i) => ['id-' + i]))
  await expect(f.read(store, 'ticket')).rejects.toThrow('上限')
  expect(f.turnPage).toHaveBeenCalledTimes(49)
})
