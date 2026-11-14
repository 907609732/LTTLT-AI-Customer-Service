import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPddLearningProvider,
  PlatformProductDetailBlockedError,
  type PddLearningWindow,
} from '../electron/pdd-learning-provider'
import type { NativeHistoryObserver } from '../electron/platform-learning-chat'

const live = {
  authenticated: true,
  mallId: 'mall-1',
  customerServiceId: 'cs-1',
  storeName: '夹具店',
}
const range = { maxPages: 5, maxRecords: 100, productStatus: 'all' as const }
const providers: ReturnType<typeof createPddLearningProvider>[] = []
afterEach(() => {
  for (const provider of providers.splice(0)) provider.dispose()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal('location', new URL('https://mms.pinduoduo.com/goods/goods_list'))
  document.body.innerHTML = `<main id="pdd-app-skeleton-main-content">
    <div role="tablist"><button role="tab" aria-selected="true">全部商品</button><button role="tab" aria-selected="false">出售中</button></div>
    <table><thead><tr><th>商品信息</th><th>价格</th><th>商品状态</th></tr></thead><tbody>
    <tr><td><a href="https://mobile.yangkeduo.com/goods.html?goods_id=12345678">纯棉上衣</a><span>商品ID：12345678</span></td><td>19.90</td><td>出售中</td></tr>
    </tbody></table><div>共有 1 条</div></main>`
})
function fixture() {
  const readProductDetail = vi.fn(
    async () =>
      undefined as
        | import('../src/shared/contracts/platform-product').PlatformProductDetail
        | undefined,
  )
  let mallId = 'mall-1',
    origin = 'https://mms.pinduoduo.com/chat-merchant/index.html'
  let active = true,
    destroyed = false
  const loaded: string[] = [],
    partitions: string[] = []
  const historyObserver: NativeHistoryObserver = {
    ready: async () => {},
    begin: () => {},
    dispose: () => {},
    waitUsers: async () => ({ mallId: 'mall-1', total: 1, uids: ['buyer-1'] }),
    waitMessages: async () => ({
      mallId: 'mall-1',
      uid: 'buyer-1',
      total: 2,
      pageNum: null,
      messages: [
        { id: 'q', at: Date.parse('2026-11-10T12:00:00+08:00'), type: 0, seller: false },
        { id: 'a', at: Date.parse('2026-11-10T12:01:00+08:00'), type: 0, seller: true },
      ],
    }),
  }
  const history = vi.fn(async (_uid: string, _options: { limit: number }) => ({
    ok: true,
    messages: [
      {
        msgId: 'q',
        from: 'buyer',
        type: 'text',
        content: '多久发货',
        ts: Date.parse('2026-11-10T12:00:00+08:00'),
      },
      {
        msgId: 'a',
        from: 'seller',
        type: 'text',
        content: '以承诺为准',
        ts: Date.parse('2026-11-10T12:01:00+08:00'),
      },
    ],
  }))
  const page = {
    getURL: () => origin,
    isDestroyed: () => destroyed,
    executeJavaScript: async (script: string) => Function(`return (${script})`)() as unknown,
    setWindowOpenHandler: () => {},
    on: () => {},
  }
  const win: PddLearningWindow = {
    webContents: page,
    loadURL: async (url: string) => {
      loaded.push(url)
      origin = url
      vi.stubGlobal('location', new URL(url))
    },
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true
    },
    show: () => {},
    setTitle: () => {},
  }
  const adapter = {
    readIdentity: async () => ({ ...live, mallId }),
    _wc: () => page,
    pendingSnapshot: async () => ({ ok: true, count: 1, uids: ['buyer-1'] }),
    conversationHistory: history,
  }
  const provider = createPddLearningProvider({
    namespace: 'local',
    getStore: (id) => ({ id, platform: 'pdd-web', mallId: 'mall-1' }),
    getAdapter: () => adapter,
    accountId: () => 'local',
    assertActive: () => {
      if (!active) throw Error('工作区已变化')
    },
    identityScript: () => JSON.stringify({ ...live }),
    createWindow: (partition) => {
      partitions.push(partition)
      return win
    },
    now: () => 1000,
    readProductDetail,
    timeoutMs: 100,
    createHistoryObserver: () => historyObserver,
    runQuery: async (
      _page: unknown,
      action: () => Promise<void>,
      ready: () => Promise<boolean>,
    ) => {
      await action()
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      if (!(await ready())) throw Error('尚未确认平台查询完成')
    },
  })
  providers.push(provider)
  return {
    provider,
    readProductDetail,
    loaded,
    partitions,
    adapter,
    history,
    historyObserver,
    win,
    mall: (value: string) => {
      mallId = value
    },
    origin: (value: string) => {
      origin = value
    },
    deactivate: () => {
      active = false
    },
    destroyed: () => destroyed,
  }
}

describe('PDD learning provider real-page boundary', () => {
  it('只跳过平台明确拒绝的禁售详情，保留列表且标明范围不完整', async () => {
    const f = fixture()
    f.readProductDetail.mockRejectedValue(
      new PlatformProductDetailBlockedError('商品禁售中，不可编辑'),
    )
    const result = await f.provider.collectProducts({
      identity: await f.provider.identity('shop'),
      range,
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.platformDetail).toBeUndefined()
    expect(result.rangeComplete).toBe(false)
    expect(result.scope).toContain('商品禁售中')
  })
  it('将已核对的原生商品详情与本页同编号商品合并', async () => {
    const f = fixture()
    const detail = {
      productId: '12345678',
      title: '纯棉上衣',
      merchantCode: 'PDD-001',
      description: '纯棉',
      attributes: [],
      images: [],
      skus: [
        {
          skuId: 'sku-red',
          specs: [{ name: '颜色', value: '红' }],
          merchantCode: 'RED',
          barcode: '690000000001',
          price: '19.90',
          stock: 0,
        },
      ],
      capturedAt: 1000,
      sourceUrl: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=12345678',
      detailStatus: 'partial' as const,
      detailNote: '',
    }
    f.readProductDetail.mockResolvedValue(detail)
    const result = await f.provider.collectProducts({
      identity: await f.provider.identity('shop'),
      range,
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(result.items[0]?.platformDetail).toEqual(detail)
    expect(f.readProductDetail).toHaveBeenCalledOnce()
  })
  it('reads a verified goods page using the store login partition and normalizes only visible facts', async () => {
    const f = fixture()
    const identity = await f.provider.identity('shop')
    const result = await f.provider.collectProducts({
      identity,
      range,
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(f.partitions).toEqual(['persist:lingtu-local-shop'])
    expect(f.loaded).toEqual(['https://mms.pinduoduo.com/goods/goods_list'])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: '12345678', title: '纯棉上衣', specifications: '' })
    expect(result.items[0]!.description).toContain('19.90')
    expect(result.scope).toContain('列表')
    expect(result.total).toBe(1)
  })
  it('refuses foreign origins, wrong malls, stale workspace, and changed platform accounts', async () => {
    const f = fixture()
    f.origin('https://example.com/goods/goods_list')
    await expect(f.provider.identity('shop')).rejects.toThrow('来源')
    f.origin('https://mms.pinduoduo.com/chat-merchant/index.html')
    f.mall('mall-other')
    await expect(f.provider.identity('shop')).rejects.toThrow('店铺')
    f.mall('mall-1')
    const identity = await f.provider.identity('shop')
    f.adapter.readIdentity = async () => ({ ...live, customerServiceId: 'cs-other' })
    await expect(
      f.provider.collectProducts({
        identity,
        range,
        cursor: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('身份')
    expect(f.loaded).toEqual([])
    f.deactivate()
    await expect(f.provider.identity('shop')).rejects.toThrow('工作区')
  })
  it('queries backend history and verifies native message totals without using the pending queue', async () => {
    const f = fixture()
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><label data-checked="true">按客服账号查询</label><input placeholder="请选择" value="全部"><input data-testid="beast-core-rangePicker-htmlInput" readonly value="2026-11-01 ~ 2026-11-14"><button>查询</button><div class="cs-message-table-header">消费者账号 聊天记录</div><div class="cs-list"><div class="user-item is-active"><span class="user-name">买***</span></div></div><div class="table-section-left-footer"><li class="PGT_simplePager_fixture" title="1/1"></li><li data-testid="beast-core-pagination-next" class="PGT_disabled_fixture"></li></div><div class="message-list"><div class="new-message-list"><div class="message-item-container" id="message-item-q"><div class="message-item"><span class="message-time">2026-11-10 12:00:00</span><div class="message-body"><p class="message-text">多久发货</p></div></div></div><div class="message-item-container" id="message-item-a"><div class="message-item"><span class="message-time">2026-11-10 12:01:00</span><div class="message-body"><p class="message-text">以承诺为准</p></div></div></div></div></div></main>`
    const identity = await f.provider.identity('shop')
    const result = await f.provider.collectChats({
      identity,
      range: { ...range, from: '2026-11-01', to: '2026-11-14' },
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(f.history).not.toHaveBeenCalled()
    expect(result.items).toEqual([
      {
        id: 'buyer-1',
        uid: 'buyer-1',
        messages: [
          {
            id: 'q',
            from: 'buyer',
            type: 'text',
            text: '多久发货',
            at: Date.parse('2026-11-10T12:00:00+08:00'),
          },
          {
            id: 'a',
            from: 'seller',
            type: 'text',
            text: '以承诺为准',
            at: Date.parse('2026-11-10T12:01:00+08:00'),
          },
        ],
      },
    ])
    expect(result.scope).toContain('后台聊天记录')
    expect(result.total).toBe(1)
    expect(result.rangeComplete).toBe(true)
  })
  it('collects and verifies every native message page instead of stopping at the first twenty', async () => {
    const f = fixture()
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><label data-checked="true">按客服账号查询</label><input placeholder="请选择" value="全部"><input data-testid="beast-core-rangePicker-htmlInput" readonly value="2026-11-01 ~ 2026-11-14"><button>查询</button><div class="cs-message-table-header">消费者账号 聊天记录</div><div class="cs-list"><div class="user-item is-active"><span class="user-name">买***</span></div></div><div class="table-section-left-footer"><li class="PGT_simplePager_fixture" title="1/1"></li><li data-testid="beast-core-pagination-next" class="PGT_disabled_fixture"></li></div><div class="message-list"><div class="new-message-list"></div></div><div class="table-section-right-footer"><li class="PGT_pagerItem_fixture PGT_pagerItemActive_fixture">1</li><li data-testid="beast-core-pagination-next"></li></div></main>`
    const render = (part: number) => {
      document.querySelector('.new-message-list')!.innerHTML =
        `<div class="message-item-container" id="message-item-q${part}"><div class="message-item"><span class="message-time">2026-11-10 12:0${part * 2}:00</span><div class="message-body"><p class="message-text">问题${part}</p></div></div></div><div class="message-item-container" id="message-item-a${part}"><div class="message-item"><span class="message-time">2026-11-10 12:0${part * 2 + 1}:00</span><div class="message-body"><p class="message-text">答案${part}</p></div></div></div>`
    }
    render(0)
    let part = 0
    f.historyObserver.waitMessages = async () => ({
      mallId: 'mall-1',
      uid: 'buyer-1',
      total: 4,
      pageNum: part + 1,
      messages: [
        {
          id: `q${part}`,
          at: Date.parse(`2026-11-10T12:0${part * 2}:00+08:00`),
          type: 0,
          seller: false,
        },
        {
          id: `a${part}`,
          at: Date.parse(`2026-11-10T12:0${part * 2 + 1}:00+08:00`),
          type: 0,
          seller: true,
        },
      ],
    })
    document
      .querySelector('.table-section-right-footer [data-testid="beast-core-pagination-next"]')!
      .addEventListener('click', () => {
        part = 1
        document.querySelector(
          '.table-section-right-footer [class*="PGT_pagerItemActive_"]',
        )!.textContent = '2'
        document
          .querySelector('.table-section-right-footer [data-testid="beast-core-pagination-next"]')!
          .classList.add('PGT_disabled_fixture')
        render(1)
      })
    const identity = await f.provider.identity('shop')
    const result = await f.provider.collectChats({
      identity,
      range: { ...range, from: '2026-11-01', to: '2026-11-14' },
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(result.items[0]!.messages.map((message) => message.id)).toEqual(['q0', 'a0', 'q1', 'a1'])
    expect(result.rangeComplete).toBe(true)
  })
  it('rejects ambiguous product structure and visible verification rather than reporting an empty successful page', async () => {
    const f = fixture()
    const identity = await f.provider.identity('shop')
    document.body.innerHTML = '<main id="pdd-app-skeleton-main-content">没有可验证的表格</main>'
    await expect(
      f.provider.collectProducts({
        identity,
        range,
        cursor: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('商品')
    document.body.innerHTML = '<div>请完成安全验证</div>'
    const element = document.querySelector('div')!
    element.getClientRects = () =>
      [
        { width: 100, height: 100, bottom: 100, right: 100, top: 0, left: 0 } as DOMRect,
      ] as unknown as DOMRectList
    await expect(f.provider.identity('shop')).rejects.toThrow('人工验证')
  })
  it('cancels pending operations and closes owned collection windows on dispose', async () => {
    const f = fixture()
    await f.provider.reveal('shop', 'products')
    expect(f.loaded).toEqual(['https://mms.pinduoduo.com/goods/goods_list'])
    f.provider.dispose()
    expect(f.destroyed()).toBe(true)
    await expect(f.provider.identity('shop')).rejects.toThrow('关闭')
  })
  it('uses the native goods-status filter before reading the explicitly selected range', async () => {
    const f = fixture()
    document.querySelectorAll('[role="tab"]')[1]!.addEventListener('click', () => {
      document
        .querySelectorAll('[role="tab"]')
        .forEach((tab, index) => tab.setAttribute('aria-selected', String(index === 1)))
    })
    const identity = await f.provider.identity('shop')
    const result = await f.provider.collectProducts({
      identity,
      range: { ...range, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(document.querySelectorAll('[role="tab"]')[1]!.getAttribute('aria-selected')).toBe('true')
    expect(result.scope).toContain('在售中')
  })
  it('advances only a verified native next-page control and resumes the validated cursor', async () => {
    const f = fixture()
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<span aria-current="page">1</span><button aria-label="下一页">下一页</button>',
      )
    document.querySelector('main')!.innerHTML = document
      .querySelector('main')!
      .innerHTML.replace('共有 1 条', '共有 2 条')
    document.querySelector('[aria-label="下一页"]')!.addEventListener('click', () => {
      document.querySelector('[aria-current="page"]')!.textContent = '2'
      document.querySelector('tbody')!.innerHTML =
        '<tr><td><a href="https://mobile.yangkeduo.com/goods.html?goods_id=23456789">麻衬衫</a>商品ID：23456789</td><td>29.90</td><td>出售中</td></tr>'
      document.querySelector('[aria-label="下一页"]')!.setAttribute('disabled', '')
    })
    const identity = await f.provider.identity('shop'),
      signal = new AbortController().signal
    const first = await f.provider.collectProducts({ identity, range, cursor: null, signal })
    expect(first.nextCursor).not.toBeNull()
    const second = await f.provider.collectProducts({
      identity,
      range,
      cursor: first.nextCursor,
      signal,
    })
    expect(second.items[0]!.id).toBe('23456789')
    expect(second.nextCursor).toBeNull()
  })
  it('destroys an owned window when cancellation interrupts its initial navigation', async () => {
    const f = fixture()
    const identity = await f.provider.identity('shop')
    let started = false
    f.win.loadURL = async () => {
      started = true
      return new Promise<void>(() => {})
    }
    const controller = new AbortController()
    const pending = f.provider.collectProducts({
      identity,
      range,
      cursor: null,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    await expect(pending).rejects.toThrow('取消')
    expect(f.destroyed()).toBe(true)
  })
  it('waits for the native filter query before using the new filter and price together', async () => {
    const f = fixture()
    document.querySelectorAll('[role="tab"]')[1]!.addEventListener('click', () => {
      document
        .querySelectorAll('[role="tab"]')
        .forEach((tab, index) => tab.setAttribute('aria-selected', String(index === 1)))
      setTimeout(() => {
        document.querySelectorAll('tbody td')[1]!.textContent = '29.90'
      }, 25)
    })
    const identity = await f.provider.identity('shop')
    const result = await f.provider.collectProducts({
      identity,
      range: { ...range, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(result.items[0]!.description).toContain('29.90')
  })
  it('reads the observed PDD goods-name fields and PGT pagination without inventing specifications', async () => {
    const f = fixture()
    document.body.innerHTML = `<main id="pdd-app-skeleton-main-content">
      <div class="TAB_tabItem_fixture TAB_active_fixture">全部</div><div class="TAB_tabItem_fixture">在售中(26)</div>
      <div class="TB_outerWrapper_fixture"><table><thead><tr><th></th><th>商品信息 批量修改标题</th><th>价格(元)批量修改</th><th>总库存批量修改</th><th>收藏</th><th>累计销量</th><th>30日销量</th><th>商品体检</th><th>创建时间</th><th>操作</th></tr></thead></table>
      <div class="TB_body_fixture"><table><tbody><tr class="TB_tr_fixture"><td></td><td class="goods-info"><div class="detail"><span class="goods-name goods-name_goodsName__fixture">纯棉上衣</span><span class="goods-id">ID: <span class="id0">12345678</span></span></div></td><td>19.90</td><td>12</td><td>0</td><td>3</td><td>1</td><td>正常</td><td>2026-11-01 销售中</td><td>编辑</td></tr></tbody></table></div></div>
      <div class="PGT_outerWrapper_fixture"><span class="PGT_totalText_fixture">共有26条</span><span class="PGT_pagerItem_fixture PGT_pagerItemActive_fixture">1</span><button class="PGT_prev_fixture PGT_disabled_fixture">上一页</button><button class="PGT_next_fixture">下一页</button></div>
      </main>`
    const identity = await f.provider.identity('shop')
    const result = await f.provider.collectProducts({
      identity,
      range,
      cursor: null,
      signal: new AbortController().signal,
    })
    expect(result.items[0]).toMatchObject({ id: '12345678', title: '纯棉上衣', specifications: '' })
    expect(result.items[0]!.description).toContain('销售中')
    expect(result.total).toBe(26)
    expect(result.nextCursor).not.toBeNull()
  })
})
