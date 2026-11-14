import type { BrowserWindow, WebContents } from 'electron'
import type { PlatformItemKind } from '../src/shared/contracts/platform-items'
import { randomUUID } from 'node:crypto'
import { createAssistQueryMonitor } from './assist-platform-query'
import {
  clickPddQuery,
  clickPddPage,
  pddDetailId,
  hasVisiblePddCaptcha,
} from './assist-platform-pdd'

export type AssistPlatform = 'pdd-web' | 'doudian-client'
const roots: Record<AssistPlatform, string> = {
  'pdd-web': 'https://mms.pinduoduo.com/',
  'doudian-client': 'https://fxg.jinritemai.com/',
}
/** 路径由本项目已登录后台导航实页核对，不依据主页摘要或猜测的私有接口。 */
export function assistCollectionUrl(
  platform: AssistPlatform,
  kind: PlatformItemKind,
): string | undefined {
  if (platform !== 'pdd-web') return undefined
  return kind === 'ticket'
    ? 'https://mms.pinduoduo.com/aftersales/work_order/list'
    : 'https://mms.pinduoduo.com/aftersales/aftersale_list'
}
export function assistPartition(namespace: string, storeId: string, platform: AssistPlatform) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(namespace) || !/^[a-zA-Z0-9-]{1,64}$/.test(storeId))
    throw new Error('店铺隔离分区无效')
  return `persist:lingtu-${platform === 'pdd-web' ? '' : 'assist-'}${namespace}-${storeId}`
}
export function isAllowedAssistUrl(platform: AssistPlatform, input: string): boolean {
  try {
    const url = new URL(input)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.origin === new URL(roots[platform]).origin
    )
  } catch {
    return false
  }
}

/** 独立后台窗口，不改变客服会话页面；不读取/导出 Cookie，不执行提交按钮。 */
export function createAssistPlatformHost(options: {
  namespace: string
  createWindow(partition: string): BrowserWindow
  getParent?(): BrowserWindow | undefined
}) {
  const pages = new Map<
    string,
    { window: BrowserWindow; platform: AssistPlatform; manual: boolean }
  >()
  const queries = createAssistQueryMonitor()
  let closed = false
  let parent: BrowserWindow | undefined
  const observations = new Map<
    string,
    {
      token: string
      kind: PlatformItemKind
      resolve(url: string): void
      reject(error: Error): void
    }
  >()
  function dispose() {
    if (closed) return
    closed = true
    queries.dispose()
    parent?.removeListener('closed', dispose)
    parent = undefined
    for (const page of pages.values()) if (!page.window.isDestroyed()) page.window.destroy()
    pages.clear()
  }
  const get = (storeId: string) => {
    const page = pages.get(storeId)
    return page && !page.window.isDestroyed() ? page : undefined
  }
  const createPage = (key: string, store: { id: string; platform: AssistPlatform }) => {
    if (!parent) {
      parent = options.getParent?.()
      parent?.once('closed', dispose)
    }
    const win = options.createWindow(assistPartition(options.namespace, store.id, store.platform))
    const page = { window: win, platform: store.platform, manual: false }
    pages.set(key, page)
    win.setTitle('平台后台 · 请核对店铺身份')
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
      if (key.includes(':') && !page.manual) {
        const observation = observations.get(key)
        if (
          observation &&
          frameName === observation.token &&
          isAllowedAssistUrl(store.platform, url)
        ) {
          const source = new URL(win.webContents.getURL())
          if (
            source.pathname ===
              new URL(assistCollectionUrl('pdd-web', observation.kind)!).pathname &&
            Boolean(pddDetailId(observation.kind, url))
          )
            observation.resolve(url)
          else observation.reject(new Error('工单详情导航尚未识别'))
        }
        return { action: 'deny' }
      }
      const verified = (['ticket', 'aftersale'] as const).some(
        (kind) => assistCollectionUrl(store.platform, kind) === url,
      )
      let observedDetail = false
      if (store.platform === 'pdd-web' && isAllowedAssistUrl(store.platform, url)) {
        const from = new URL(win.webContents.getURL())
        const destination = new URL(url)
        // 只在已核对工单列表发起的原生导航中观测详情，不猜详情路由或接收渲染层URL。
        observedDetail =
          from.origin === 'https://mms.pinduoduo.com' &&
          ((from.pathname === '/aftersales/work_order/list' &&
            Boolean(pddDetailId('ticket', destination.href))) ||
            (from.pathname === '/aftersales/aftersale_list' &&
              Boolean(pddDetailId('aftersale', destination.href))))
      }
      if ((verified || observedDetail) && !closed && !win.isDestroyed()) {
        // 已核对的后台导航原本 target=_blank；留在受限后台页，不开放任意弹窗。
        void win.loadURL(url).catch(() => {})
      }
      return { action: 'deny' }
    })
    const guard = (navigation: { preventDefault(): void }, url: string) => {
      if (!isAllowedAssistUrl(store.platform, url)) navigation.preventDefault()
    }
    win.webContents.on('will-navigate', guard)
    win.webContents.on('will-redirect', guard)
    win.on('close', (event) => {
      if (!closed && key.includes(':')) {
        event.preventDefault()
        page.manual = false
        win.hide()
      }
    })
    win.once('closed', () => pages.delete(key))
    return page
  }
  async function observeDetail(
    storeId: string,
    kind: PlatformItemKind,
    rowIndex: number,
    signal?: AbortSignal,
    orderNo?: string,
  ): Promise<string> {
    signal?.throwIfAborted()
    const key = `${storeId}:${kind}`
    const page = get(key)
    if (
      !page ||
      observations.has(key) ||
      !Number.isSafeInteger(rowIndex) ||
      rowIndex < 0 ||
      rowIndex > 49
    )
      throw new Error('工单详情观测状态无效')
    const source = new URL(page.window.webContents.getURL())
    if (
      source.origin !== 'https://mms.pinduoduo.com' ||
      source.pathname !== new URL(assistCollectionUrl('pdd-web', kind)!).pathname
    )
      throw new Error('工单列表来源已改变')
    const token = `lingtu-observe-${randomUUID()}`
    let timeout: ReturnType<typeof setTimeout> | undefined
    let abort = () => {}
    try {
      return await new Promise<string>((resolve, reject) => {
        observations.set(key, { token, kind, resolve, reject })
        abort = () => {
          if (!page.window.isDestroyed()) page.window.destroy()
          reject(new Error('工单详情读取已取消'))
        }
        signal?.addEventListener('abort', abort, { once: true })
        timeout = setTimeout(() => {
          abort()
          reject(new Error('工单详情读取超时'))
        }, 2500)
        void page.window.webContents
          .executeJavaScript(
            `(() => {
            if ((${hasVisiblePddCaptcha.toString()})()) throw Error('platform_verification_required')
            const rows = document.querySelectorAll(${JSON.stringify(kind === 'ticket' ? '#pdd-app-skeleton-main-content [class*="listItem_workOrderItem__"]' : '#pdd-app-skeleton-main-content [class*="after-sales-table_order_item__"]')})
            const row = rows[${rowIndex}]
            const button = ${kind === 'ticket' ? `row?.querySelector('[class*="listTable_operateBtn__"]')` : `Array.from(row?.querySelectorAll('[class*="after-sales-table_item_cell__"]')?.[7]?.querySelectorAll('a') ?? []).find(element=>element.textContent.trim()==='查看详情')`}
            if (!button || button.textContent.trim() !== ${JSON.stringify(kind === 'ticket' ? '立即处理' : '查看详情')}) throw Error('平台详情入口已改变')
            if (${JSON.stringify(orderNo ?? '')} && !row.textContent.includes(${JSON.stringify(orderNo ?? '')})) throw Error('平台记录已改变')
            const original = window.open
            window.__lingtuDetailObservation = { token: ${JSON.stringify(token)}, original }
            window.open = (url, _target, features) => original.call(window, url, ${JSON.stringify(token)}, features)
            button.click()
          })()`,
          )
          .catch((error) =>
            reject(error instanceof Error ? error : new Error('工单详情入口读取失败')),
          )
      })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      observations.delete(key)
      if (!page.window.isDestroyed())
        await page.window.webContents
          .executeJavaScript(
            `(() => {
          const observation = window.__lingtuDetailObservation
          if (observation?.token === ${JSON.stringify(token)}) { window.open = observation.original; delete window.__lingtuDetailObservation }
        })()`,
          )
          .catch(() => {})
    }
  }

  return {
    async open(
      store: { id: string; platform: AssistPlatform },
      detailUrl?: string,
      verificationKind?: PlatformItemKind,
    ): Promise<void> {
      if (closed) throw new Error('后台采集已关闭')
      const target = detailUrl ?? roots[store.platform]
      if (!isAllowedAssistUrl(store.platform, target)) throw new Error('后台页面来源无效')
      // Only a paused login/verification flow shares the collection page. Normal manual
      // processing keeps its own window so polling never takes a refund/detail form away.
      const key = verificationKind ? `${store.id}:${verificationKind}` : store.id
      let page = get(key)
      if (!page) {
        page = createPage(key, store)
        page.manual = true
        // 首页入口已经核对；工单/售后路径只能在真实页面取证后加入适配器。
        page.window.show()
        await page.window.loadURL(target)
      } else {
        page.manual = true
        page.window.show()
        page.window.focus()
        if (
          !isAllowedAssistUrl(store.platform, page.window.webContents.getURL()) ||
          (detailUrl && page.window.webContents.getURL() !== target)
        )
          await page.window.loadURL(target)
      }
    },
    page(storeId: string) {
      return get(storeId)?.window.webContents
    },
    collectionContents(storeId: string, kind: PlatformItemKind) {
      return get(`${storeId}:${kind}`)?.window.webContents
    },
    async collectionPage(
      store: { id: string; platform: AssistPlatform },
      kind: PlatformItemKind,
      signal?: AbortSignal,
    ) {
      if (closed) throw new Error('后台采集已关闭')
      signal?.throwIfAborted()
      const url = assistCollectionUrl(store.platform, kind)
      if (!url) throw new Error('此平台列表页面尚未完成核对')
      const key = `${store.id}:${kind}`
      const page = get(key) ?? createPage(key, store)
      if (page.manual && page.window.isVisible())
        throw new Error('平台验证窗口正在手动查看，请关闭该窗口后刷新同步')
      signal?.addEventListener(
        'abort',
        () => {
          if (!page.window.isDestroyed()) page.window.destroy()
          if (pages.get(key) === page) pages.delete(key)
        },
        { once: true },
      )
      // 工单与售后各用独立后台页，不能解析用户当前任意页或切换客服聊天。
      const currentUrl = page.window.webContents.getURL()
      if (
        !isAllowedAssistUrl(store.platform, currentUrl) ||
        new URL(currentUrl).pathname !== new URL(url).pathname
      )
        await page.window.loadURL(url)
      signal?.throwIfAborted()
      return page.window.webContents
    },
    async refreshQuery(
      page: Pick<WebContents, 'getURL' | 'executeJavaScript'>,
      kind: PlatformItemKind,
      signal?: AbortSignal,
    ) {
      const entry = [...pages.values()].find(
        (entry) => entry.window.webContents === page && !entry.window.isDestroyed(),
      )
      if (!entry || closed || !isAllowedAssistUrl(entry.platform, page.getURL()))
        throw Error('平台查询页面来源无效')
      const runQuery = () =>
        queries.run(
          entry.window.webContents,
          async () => {
            await page.executeJavaScript(
              `(${clickPddQuery.toString()})(${JSON.stringify(kind)}, ${hasVisiblePddCaptcha.toString()})`,
            )
          },
          async () =>
            page.executeJavaScript(`(() => {
          if ((${hasVisiblePddCaptcha.toString()})()) throw Error('platform_verification_required')
          return !document.querySelector('#pdd-app-skeleton-main-content [aria-busy="true"]')
        })()`),
          signal,
        )
      await runQuery()
      if (kind === 'aftersale') {
        signal?.throwIfAborted()
        // 平台高级查询会清掉快捷筛选；等本轮请求完成后再选回待商家处理。
        const selected: unknown = await page.executeJavaScript(`(() => {
          return Array.from(document.querySelectorAll('#pdd-app-skeleton-main-content [class*="MmsUiQuickFilter___checked___"]'))
            .some(element => /^待商家处理\\s*\\d*$/.test(element.textContent.trim()))
        })()`)
        if (selected !== true) await runQuery()
      }
    },
    async turnPage(
      page: Pick<WebContents, 'getURL' | 'executeJavaScript'>,
      kind: PlatformItemKind,
      direction: 'first' | 'next',
      expected: number,
      signal?: AbortSignal,
    ) {
      const entry = [...pages.values()].find(
        (entry) => entry.window.webContents === page && !entry.window.isDestroyed(),
      )
      if (
        !entry ||
        closed ||
        !isAllowedAssistUrl(entry.platform, page.getURL()) ||
        new URL(page.getURL()).pathname !==
          new URL(assistCollectionUrl(entry.platform, kind)!).pathname
      )
        throw Error('平台翻页页面来源无效')
      if (!Number.isSafeInteger(expected) || expected < 1 || expected > 10000)
        throw Error('平台页码无效')
      const target = direction === 'first' ? 1 : expected + 1
      await queries.run(
        entry.window.webContents,
        async () => {
          await page.executeJavaScript(
            `(${clickPddPage.toString()})(${JSON.stringify(direction)},${expected},${hasVisiblePddCaptcha.toString()})`,
          )
        },
        async () =>
          page.executeJavaScript(`(() => {
          if((${hasVisiblePddCaptcha.toString()})()) throw Error('platform_verification_required')
          const active=document.querySelector('#pdd-app-skeleton-main-content [class*="PGT_pagerItemActive_"]')
          return Number(active?.textContent?.trim())===${target} && !document.querySelector('#pdd-app-skeleton-main-content [aria-busy="true"]')
        })()`),
        signal,
      )
    },
    stopCollecting() {
      for (const [key, page] of pages) {
        if (key.includes(':')) {
          if (!page.window.isDestroyed() && !page.manual) page.window.hide()
        }
      }
    },
    observeTicketDetail: (
      storeId: string,
      rowIndex: number,
      signal?: AbortSignal,
      orderNo?: string,
    ) => observeDetail(storeId, 'ticket', rowIndex, signal, orderNo),
    observeAfterSaleDetail: (
      storeId: string,
      rowIndex: number,
      signal?: AbortSignal,
      orderNo?: string,
    ) => observeDetail(storeId, 'aftersale', rowIndex, signal, orderNo),
    dispose,
  }
}
