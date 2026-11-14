import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { readPddAfterSaleDom } from '../electron/assist-platform-pdd'
import { EventEmitter } from 'node:events'
import {
  assistPartition,
  assistCollectionUrl,
  createAssistPlatformHost,
  isAllowedAssistUrl,
} from '../electron/assist-platform-host'

it('售后已选快捷筛选刷新后恢复待商家处理，不采用查询清掉筛选后的全部结果', async () => {
  vi.useFakeTimers()
  const events = new Map<string, (details: object) => void>()
  const checked = 'MmsUiQuickFilter___checked___fixture'
  document.body.innerHTML = `<main id="pdd-app-skeleton-main-content"><button>查询</button><div class="MmsUiQuickFilter___content___fixture ${checked}">待商家处理0</div><input value="近3个月内">${['订单信息', '金额', '发货状态', '售后类型', '售后状态', '售后协商', '售后原因', '操作'].map((label) => `<div class="after-sales-table_header_cell__fixture">${label}</div>`).join('')}<div class="after-sales-table_empty_display__fixture">暂无售后单</div><p>共有0条</p></main>`
  const filter = document.querySelector('main > div')!
  const query = document.querySelector('button')!
  vi.spyOn(query, 'getClientRects').mockReturnValue([
    new DOMRect(1, 1, 30, 20),
  ] as unknown as DOMRectList)
  let requests = 0
  const request = () => {
    const details = {
      id: ++requests,
      webContentsId: 77,
      resourceType: 'xhr',
      url: 'https://mms.pinduoduo.com/query',
      statusCode: 200,
    }
    events.get('onSendHeaders')?.(details)
    events.get('onCompleted')?.(details)
  }
  query.onclick = () => {
    filter.classList.remove(checked)
    request()
  }
  filter.addEventListener('click', () => {
    filter.classList.add(checked)
    request()
  })
  const webRequest = Object.fromEntries(
    ['onSendHeaders', 'onCompleted', 'onErrorOccurred'].map((name) => [
      name,
      (_filter: unknown, cb: (details: object) => void) => events.set(name, cb),
    ]),
  )
  const url = 'https://mms.pinduoduo.com/aftersales/aftersale_list'
  vi.stubGlobal('location', {
    origin: 'https://mms.pinduoduo.com',
    pathname: '/aftersales/aftersale_list',
  })
  const page = {
    id: 77,
    session: { webRequest },
    isDestroyed: () => false,
    getURL: () => url,
    setWindowOpenHandler() {},
    on() {},
    executeJavaScript: async (script: string): Promise<unknown> =>
      new Function(`return ${script}`)(),
  }
  const window = {
    webContents: page,
    isDestroyed: () => false,
    setTitle() {},
    once() {},
    on() {},
    destroy() {},
  } as unknown as BrowserWindow
  const host = createAssistPlatformHost({ namespace: 'yunduo-local', createWindow: () => window })
  try {
    const collection = await host.collectionPage(
      { id: 'store-a', platform: 'pdd-web' },
      'aftersale',
    )
    const pending = host.refreshQuery(collection, 'aftersale')
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(readPddAfterSaleDom()).toMatchObject({ recognized: true, total: 0 })
    expect(requests).toBe(2)
  } finally {
    host.dispose()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})

describe('平台后台来源与店铺隔离', () => {
  it('拼多多复用本项目当前店铺分区，抖店使用独立后台分区', () => {
    expect(assistPartition('yunduo-local', 'store-a', 'pdd-web')).toBe(
      'persist:lingtu-yunduo-local-store-a',
    )
    expect(assistPartition('yunduo-local', 'store-a', 'doudian-client')).toBe(
      'persist:lingtu-assist-yunduo-local-store-a',
    )
    expect(assistPartition('managed-abc', 'store-a', 'pdd-web')).not.toBe(
      assistPartition('yunduo-local', 'store-a', 'pdd-web'),
    )
  })
  it('拒绝相似域名、非https、凭据URL与跨平台导航', () => {
    expect(isAllowedAssistUrl('pdd-web', 'https://mms.pinduoduo.com/')).toBe(true)
    for (const url of [
      'http://mms.pinduoduo.com/',
      'https://mms.pinduoduo.com.evil.test/',
      'https://user:pass@mms.pinduoduo.com/',
      'javascript:alert(1)',
      'https://fxg.jinritemai.com/',
    ])
      expect(isAllowedAssistUrl('pdd-web', url)).toBe(false)
  })
  it('后台首次加载失败后可重试，不把空白窗口当打开成功', async () => {
    const loadURL = vi
      .fn()
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValue(undefined)
    const window = {
      isDestroyed: () => false,
      setTitle() {},
      show() {},
      focus() {},
      once() {},
      on() {},
      destroy() {},
      loadURL,
      webContents: { getURL: () => '', setWindowOpenHandler() {}, on() {} },
    } as unknown as BrowserWindow
    const host = createAssistPlatformHost({ namespace: 'yunduo-local', createWindow: () => window })
    const store = { id: 'store-a', platform: 'pdd-web' as const }
    await expect(host.open(store)).rejects.toThrow('load failed')
    await host.open(store)
    expect(loadURL).toHaveBeenCalledTimes(2)
    host.dispose()
  })
  it('工单和售后使用独立后台页，关闭采集保留页面直到工作区销毁', async () => {
    const windows: {
      loadURL: ReturnType<typeof vi.fn>
      show: ReturnType<typeof vi.fn>
      destroy: ReturnType<typeof vi.fn>
      hide: ReturnType<typeof vi.fn>
    }[] = []
    const host = createAssistPlatformHost({
      namespace: 'yunduo-local',
      createWindow: () => {
        const page = {
          loadURL: vi.fn().mockResolvedValue(undefined),
          show: vi.fn(),
          destroy: vi.fn(),
          hide: vi.fn(),
          isDestroyed: () => false,
          setTitle() {},
          once() {},
          on() {},
          webContents: { getURL: () => '', setWindowOpenHandler() {}, on() {} },
        }
        windows.push(page)
        return page as unknown as BrowserWindow
      },
    })
    const store = { id: 'store-a', platform: 'pdd-web' as const }
    await host.collectionPage(store, 'ticket')
    await host.collectionPage(store, 'aftersale')
    expect(windows).toHaveLength(2)
    expect(windows[0].loadURL).toHaveBeenCalledWith(
      'https://mms.pinduoduo.com/aftersales/work_order/list',
    )
    expect(windows[1].loadURL).toHaveBeenCalledWith(
      'https://mms.pinduoduo.com/aftersales/aftersale_list',
    )
    expect(windows.every((page) => page.show.mock.calls.length === 0)).toBe(true)
    expect(assistCollectionUrl('doudian-client', 'ticket')).toBeUndefined()
    host.stopCollecting()
    expect(windows.every((page) => page.destroy.mock.calls.length === 0)).toBe(true)
    expect(windows.every((page) => page.hide.mock.calls.length === 1)).toBe(true)
    host.dispose()
    expect(windows.every((page) => page.destroy.mock.calls.length === 1)).toBe(true)
  })
  it('打开后台复用实际采集页，手动查看时不后台切走，关闭后继续复用', async () => {
    let currentUrl = '',
      visible = false
    const events = new EventEmitter()
    const loadURL = vi.fn(async (url: string) => {
      currentUrl = url
    })
    const window = Object.assign(events, {
      isDestroyed: () => false,
      isVisible: () => visible,
      setTitle() {},
      show() {
        visible = true
      },
      hide() {
        visible = false
      },
      focus() {},
      destroy: vi.fn(),
      loadURL,
      webContents: { getURL: () => currentUrl, setWindowOpenHandler() {}, on() {} },
    }) as unknown as BrowserWindow
    const createWindow = vi.fn(() => window)
    const host = createAssistPlatformHost({ namespace: 'yunduo-local', createWindow })
    const store = { id: 'store-a', platform: 'pdd-web' as const }
    const original = await host.collectionPage(store, 'ticket')
    await host.open(store, assistCollectionUrl('pdd-web', 'ticket'), 'ticket')
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadURL).toHaveBeenCalledTimes(1)
    await expect(host.collectionPage(store, 'ticket')).rejects.toThrow('手动')
    const event = { preventDefault: vi.fn() }
    events.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(visible).toBe(false)
    host.stopCollecting()
    expect(await host.collectionPage(store, 'ticket')).toBe(original)
    expect(loadURL).toHaveBeenCalledTimes(1)
    host.dispose()
  })
  it('只把已核对的target blank列表链接转到受限后台，外站与未知路径仍被拒绝', async () => {
    let onOpen: (details: { url: string }) => { action: string } = () => ({ action: 'deny' })
    const loadURL = vi.fn().mockResolvedValue(undefined)
    const window = {
      isDestroyed: () => false,
      setTitle() {},
      show() {},
      focus() {},
      once() {},
      on() {},
      destroy() {},
      loadURL,
      webContents: {
        getURL: () => 'https://mms.pinduoduo.com/home/',
        setWindowOpenHandler(handler: typeof onOpen) {
          onOpen = handler
        },
        on() {},
      },
    } as unknown as BrowserWindow
    const host = createAssistPlatformHost({ namespace: 'yunduo-local', createWindow: () => window })
    await host.open({ id: 'store-a', platform: 'pdd-web' })
    expect(onOpen({ url: 'https://mms.pinduoduo.com/aftersales/work_order/list' })).toEqual({
      action: 'deny',
    })
    expect(loadURL).toHaveBeenLastCalledWith('https://mms.pinduoduo.com/aftersales/work_order/list')
    expect(loadURL).toHaveBeenCalledTimes(2)
    onOpen({ url: 'https://mms.pinduoduo.com/unknown' })
    onOpen({ url: 'https://evil.test/' })
    expect(loadURL).toHaveBeenCalledTimes(2)
    host.dispose()
  })
  it('主窗口关闭清理独立后台，避免仅剩后台窗口阻止软件退出', async () => {
    const parent = new EventEmitter()
    const destroy = vi.fn()
    const window = {
      isDestroyed: () => false,
      setTitle() {},
      show() {},
      once() {},
      on() {},
      destroy,
      loadURL: async () => {},
      webContents: { setWindowOpenHandler() {}, on() {} },
    } as unknown as BrowserWindow
    const host = createAssistPlatformHost({
      namespace: 'yunduo-local',
      createWindow: () => window,
      getParent: () => parent as unknown as BrowserWindow,
    })
    await host.open({ id: 'store-a', platform: 'pdd-web' })
    parent.emit('closed')
    expect(destroy).toHaveBeenCalledTimes(1)
    await expect(host.open({ id: 'store-a', platform: 'pdd-web' })).rejects.toThrow('关闭')
  })
  it('隐藏工单详情观测仅接受本行token，捕获真实URL后仍拒绝实际跳页', async () => {
    let onOpen: (details: { url: string; frameName?: string }) => { action: string } = () => ({
      action: 'deny',
    })
    const target = 'https://mms.pinduoduo.com/aftersales/work_order/tododetail?id=ticket-fixture-a'
    const loadURL = vi.fn().mockResolvedValue(undefined)
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('button.click()')) {
        const token = script.match(/lingtu-observe-[a-f0-9-]+/)?.[0]
        expect(token).toBeDefined()
        expect(onOpen({ url: target, frameName: 'old-row-token' })).toEqual({ action: 'deny' })
        expect(onOpen({ url: target, frameName: token })).toEqual({ action: 'deny' })
      }
    })
    const window = {
      isDestroyed: () => false,
      setTitle() {},
      once() {},
      on() {},
      destroy() {},
      loadURL,
      webContents: {
        getURL: () => 'https://mms.pinduoduo.com/aftersales/work_order/list',
        executeJavaScript,
        setWindowOpenHandler(handler: typeof onOpen) {
          onOpen = handler
        },
        on() {},
      },
    } as unknown as BrowserWindow
    const host = createAssistPlatformHost({ namespace: 'yunduo-local', createWindow: () => window })
    await host.collectionPage({ id: 'store-a', platform: 'pdd-web' }, 'ticket')
    expect(await host.observeTicketDetail('store-a', 0)).toBe(target)
    expect(loadURL).not.toHaveBeenCalled()
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
    host.dispose()
  })
})

it('售后仅观察本行查看详情，捕获售后ID和订单关联后不实际跳页', async () => {
  let onOpen: (details: { url: string; frameName?: string }) => { action: string } = () => ({
    action: 'deny',
  })
  const target =
    'https://mms.pinduoduo.com/aftersales-ssr/detail?id=sale-fixture-a&orderSn=261100-1234567890123'
  const loadURL = vi.fn().mockResolvedValue(undefined)
  const executeJavaScript = vi.fn(async (script: string) => {
    if (script.includes('button.click()')) {
      expect(script).toContain('查看详情')
      expect(script).not.toContain('同意退款')
      const token = script.match(/lingtu-observe-[a-f0-9-]+/)?.[0]
      expect(onOpen({ url: target, frameName: 'old-token' })).toEqual({ action: 'deny' })
      expect(onOpen({ url: target, frameName: token })).toEqual({ action: 'deny' })
    }
  })
  const window = {
    isDestroyed: () => false,
    setTitle() {},
    once() {},
    on() {},
    destroy() {},
    loadURL,
    webContents: {
      getURL: () => 'https://mms.pinduoduo.com/aftersales/aftersale_list',
      executeJavaScript,
      setWindowOpenHandler(handler: typeof onOpen) {
        onOpen = handler
      },
      on() {},
    },
  } as unknown as BrowserWindow
  const host = createAssistPlatformHost({ namespace: 'yunduo-local', createWindow: () => window })
  await host.collectionPage({ id: 'store-a', platform: 'pdd-web' }, 'aftersale')
  expect(await host.observeAfterSaleDetail('store-a', 0, undefined, '261100-1234567890123')).toBe(
    target,
  )
  expect(loadURL).not.toHaveBeenCalled()
  expect(executeJavaScript).toHaveBeenCalledTimes(2)
  host.dispose()
})
