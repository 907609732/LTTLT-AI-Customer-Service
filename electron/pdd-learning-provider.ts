import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Session } from 'electron'
import {
  platformLearningIdentitySchema,
  platformLearningRangeSchema,
  type PlatformLearningCollectInput,
  type PlatformLearningIdentity,
  type PlatformLearningPage,
  type PlatformLearningProduct,
  type PlatformLearningChat,
} from '../src/shared/contracts/platform-learning'
import { assistPartition, isAllowedAssistUrl } from './assist-platform-host'
import {
  hasVisiblePddCaptcha,
  readPddPagination,
  clickPddPage,
  type PddPagination,
} from './assist-platform-pdd'
import { createAssistQueryMonitor } from './assist-platform-query'
import {
  createPddHistoryObserver,
  pddHistoryPaths,
  pddChatDomSchema,
  readPddChatDom,
  performPddChatAction,
  type NativeHistoryObserver,
  type NativeHistoryDebugger,
  type PddChatAction,
  type NativeHistoryMessages,
} from './platform-learning-chat'

const urls = {
  products: 'https://mms.pinduoduo.com/goods/goods_list',
  chats: 'https://mms.pinduoduo.com/mms-chat/search',
} as const
interface LearningPage {
  id?: number
  session?: Session
  debugger?: NativeHistoryDebugger
  getURL(): string
  isDestroyed(): boolean
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: string, listener: (event: { preventDefault(): void }, url: string) => void): unknown
}
export interface PddLearningWindow {
  webContents: LearningPage
  loadURL(url: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
  show(): void
  setTitle(title: string): void
}
export interface PddLearningProviderOptions {
  namespace: string
  getStore(id: string): { id: string; platform: string; mallId?: string } | undefined
  getAdapter(id: string): unknown
  accountId(): string
  assertActive(): void
  identityScript(): string
  createWindow?(partition: string): PddLearningWindow
  now?(): number
  timeoutMs?: number
  createHistoryObserver?(page: LearningPage): NativeHistoryObserver
  /** Native query seam for isolated page tests; production uses the shared Session monitor. */
  runQuery?(
    page: LearningPage,
    action: () => Promise<void>,
    ready: () => Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<void>
}
interface Adapter {
  readIdentity(options: { refresh: true }): Promise<unknown>
  _wc(): Pick<LearningPage, 'getURL' | 'isDestroyed' | 'executeJavaScript'>
}
const liveSchema = z.object({
  authenticated: z.literal(true),
  mallId: z.string().trim().min(1).max(100),
  customerServiceId: z.string().trim().min(1).max(100),
})
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['products', 'chats']),
    offset: z.number().int().min(1).max(1000),
    identity: z.string(),
    range: z.string(),
    collection: z.string().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict()
const productDomSchema = z.object({
  recognized: z.boolean(),
  error: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      specifications: z.string(),
      sourceUrl: z.string(),
    }),
  ),
  total: z.number().int().nonnegative().nullable(),
  page: z.number().int().positive().nullable(),
  hasNext: z.boolean().nullable(),
  scope: z.string(),
})
type ProductDom = z.infer<typeof productDomSchema>

/** Semantic DOM only. Unknown headers/filter/pagination must remain a visible limitation. */
export function readPddLearningProductDom(
  status: 'all' | 'on-sale' | 'off-sale',
  pagination?: (total: number, rowCount: number) => PddPagination | null,
): ProductDom {
  const failed = (error: string): ProductDom => ({
    recognized: false,
    error,
    items: [],
    total: null,
    page: null,
    hasNext: null,
    scope: '',
  })
  if (location.origin !== 'https://mms.pinduoduo.com' || location.pathname !== '/goods/goods_list')
    return failed('商品页面来源尚未核对')
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  if (!root) return failed('商品列表容器尚未加载')
  const text = (node: Element | null | undefined) =>
    ((node as HTMLElement | null)?.innerText ?? node?.textContent ?? '').trim()
  const names =
    status === 'all'
      ? ['全部商品', '全部']
      : status === 'on-sale'
        ? ['在售中', '出售中', '在售', '售卖中']
        : ['已下架', '下架']
  // TAB and goods-name/PGT structures were observed on the live goods list, 2026-11-14.
  const selected = Array.from(
    root.querySelectorAll(
      '[class*="TAB_tabItem_"][class*="TAB_active_"],[role="tab"][aria-selected="true"],input[type="radio"]:checked',
    ),
  ).find((node) =>
    names.some((name) =>
      new RegExp(`^${name}(?:\\s*[（(]?\\d+[）)]?)?$`).test(text(node.closest('label') ?? node)),
    ),
  )
  if (!selected) return failed('商品状态筛选尚未核对，请在采集窗口选择对应状态')
  const tables = Array.from(root.querySelectorAll('table,[role="table"]')).filter((table) =>
    Array.from(table.querySelectorAll('th,[role="columnheader"]')).some((header) =>
      /商品信息|商品名称/.test(text(header)),
    ),
  )
  if (tables.length !== 1) return failed('商品表格结构尚未识别')
  const table = tables[0]!,
    headers = Array.from(table.querySelectorAll('th,[role="columnheader"]')).map(text)
  const itemIndex = headers.findIndex((header) => /商品信息|商品名称/.test(header))
  const tableScope = table.closest('[class*="TB_outerWrapper_"]') ?? table
  const rows = Array.from(
    tableScope.querySelectorAll('tbody tr,[role="rowgroup"] [role="row"]'),
  ).filter((row) => row.querySelector('td,[role="cell"]'))
  const items: ProductDom['items'] = []
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td,[role="cell"]'))
    const cell = cells[itemIndex]
    if (!cell || cells.length !== headers.length) return failed('商品字段数量已改变')
    const links = Array.from(cell.querySelectorAll('a[href]'))
    const titleLink = links.find(
      (link) => text(link) && !/^(?:编辑|复制|推广|详情|查看|更多)$/.test(text(link)),
    )
    let productId = text(cell).match(/(?:商品\s*ID|ID)\s*[：:]\s*(\d{6,25})/i)?.[1] ?? ''
    const href = titleLink?.getAttribute('href')
    if (href) {
      try {
        const linkedId = new URL(href, location.href).searchParams.get('goods_id')
        if (linkedId && /^\d{6,25}$/.test(linkedId)) {
          if (productId && productId !== linkedId) return failed('商品编号与详情链接不一致')
          productId = linkedId
        }
      } catch {
        return failed('商品详情链接格式异常')
      }
    }
    const title =
      text(cell.querySelector('.goods-name')) ||
      text(titleLink) ||
      text(cell)
        .split(/\r?\n/)
        .find((line) => line.trim() && !/商品\s*ID|^ID\s*[：:]/i.test(line))
        ?.trim() ||
      ''
    if (!productId || !title || title.length > 500) return failed('商品名称或编号尚未识别')
    const facts = headers.flatMap((header, index) =>
      /价格|库存|商品状态/.test(header) && text(cells[index])
        ? [`${header.replace(/批量修改(?:标题)?/g, '').trim()}：${text(cells[index])}`]
        : [],
    )
    const stateIndex = headers.findIndex((header) => /创建时间/.test(header))
    const nativeStatus =
      stateIndex >= 0
        ? text(cells[stateIndex]).match(/销售中|已下架|已售罄|发布中|草稿/)?.[0]
        : undefined
    if (nativeStatus && !headers.some((header) => /商品状态/.test(header)))
      facts.push(`商品状态：${nativeStatus}`)
    const description = facts.join('\n')
    items.push({ id: productId, title, description, specifications: '', sourceUrl: location.href })
  }
  const summary = text(root).match(/共(?:有|计)?\s*(\d+)\s*(?:条|件|个商品)/)
  const total = summary ? Number(summary[1]) : null
  if (!items.length && (total !== 0 || !/暂无商品|没有商品|暂无数据/.test(text(root))))
    return failed('商品列表尚未加载或空态未确认')
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    (total !== null && total < items.length)
  )
    return failed('商品列表编号或数量矛盾')
  const nativePagination = total !== null && pagination ? pagination(total, items.length) : null
  const active = root.querySelector('[aria-current="page"]')
  const next = root.querySelector(
    'a[rel="next"],button[aria-label="下一页"],[role="button"][aria-label="下一页"],li[title="下一页"]',
  )
  const current =
    nativePagination?.current ?? (active ? Number(text(active)) : total === items.length ? 1 : null)
  const page = current !== null && Number.isSafeInteger(current) && current > 0 ? current : null
  const disabled = (node: Element) =>
    node.getAttribute('aria-disabled') === 'true' ||
    node.hasAttribute('disabled') ||
    /(?:^|[-_\s])disabled(?:$|[-_\s])/.test(node.className)
  const hasNext =
    nativePagination?.hasNext ??
    (next && page !== null ? !disabled(next) : total === items.length ? false : null)
  return {
    recognized: true,
    error: '',
    items,
    total,
    page,
    hasNext,
    scope: `平台商品列表；${names[0]}；${page === null ? '当前页（页码尚未验证）' : `第 ${page} 页`}；仅列表可见名称、价格、库存和状态，未读取商品详情或规格`,
  }
}
const productScript = (status: PlatformLearningCollectInput['range']['productStatus']) =>
  `(${readPddLearningProductDom.toString()})(${JSON.stringify(status)},(${readPddPagination.toString()}))`

/** Owns only independent collection windows; chat reads reuse the fixed vendor platform-history call. */
export function createPddLearningProvider(options: PddLearningProviderOptions) {
  const windows = new Map<string, PddLearningWindow>()
  const historyObservers = new Map<LearningPage, NativeHistoryObserver>()
  const shutdown = new AbortController()
  const queries = createAssistQueryMonitor()
  const now = options.now ?? Date.now
  const timeoutMs = Math.max(50, Math.min(options.timeoutMs ?? 15000, 60000))
  let closed = false
  let queue: Promise<unknown> = Promise.resolve()
  function check(signal?: AbortSignal) {
    if (closed) throw Error('平台学习采集端已关闭')
    options.assertActive()
    signal?.throwIfAborted()
  }
  function storeFor(id: string) {
    check()
    const store = options.getStore(id)
    if (!store || store.id !== id) throw Error('店铺已移除或不属于当前工作区')
    if (store.platform !== 'pdd-web') throw Error('此平台的主动学习采集尚未接入')
    return store
  }
  function adapterFor(id: string): Adapter {
    storeFor(id)
    const raw = options.getAdapter(id)
    if (
      !raw ||
      typeof raw !== 'object' ||
      !['readIdentity', '_wc'].every((name) => typeof Reflect.get(raw, name) === 'function')
    )
      throw Error('拼多多平台读取接口未就绪，请先打开并登录店铺')
    return raw as Adapter
  }
  async function bounded<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    check(signal)
    const signals = signal ? [signal, shutdown.signal] : [shutdown.signal]
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort = () => {}
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(Error('平台读取已取消'))
          for (const source of signals) source.addEventListener('abort', abort, { once: true })
          timer = setTimeout(() => reject(Error('平台读取超时，请检查采集窗口后重试')), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
      for (const source of signals) source.removeEventListener('abort', abort)
    }
  }
  function assertPage(page: Pick<LearningPage, 'getURL' | 'isDestroyed'>) {
    if (page.isDestroyed() || !isAllowedAssistUrl('pdd-web', page.getURL()))
      throw Error('拼多多页面来源无效')
    if (/\/(?:login|signin|passport)(?:\/|$)/i.test(new URL(page.getURL()).pathname))
      throw Error('拼多多登录已失效，请先登录')
  }
  async function captcha(page: Pick<LearningPage, 'executeJavaScript'>, signal?: AbortSignal) {
    if (
      (await bounded(page.executeJavaScript(`(${hasVisiblePddCaptcha.toString()})()`), signal)) ===
      true
    )
      throw Error('平台需要人工验证，请在平台窗口完成后手动重试')
    check(signal)
  }
  function normalizeIdentity(id: string, raw: unknown) {
    const live = liveSchema.safeParse(raw)
    if (!live.success) throw Error('平台登录或账号身份尚未核实，请登录并刷新店铺后重试')
    const store = storeFor(id)
    if (store.mallId && store.mallId !== live.data.mallId)
      throw Error('平台店铺身份不一致，未读取资料')
    const account = options.accountId().trim()
    if (!account) throw Error('当前工作区账号身份未就绪')
    return platformLearningIdentitySchema.parse({
      storeId: id,
      platform: 'pdd-web',
      accountId: fingerprint([account, live.data.customerServiceId]),
      platformStoreId: live.data.mallId,
    })
  }
  async function identity(id: string): Promise<PlatformLearningIdentity> {
    check()
    const adapter = adapterFor(id),
      page = adapter._wc()
    assertPage(page)
    await captcha(page)
    const raw = await bounded(adapter.readIdentity({ refresh: true }))
    assertPage(page)
    check()
    return normalizeIdentity(id, raw)
  }
  async function verify(
    expected: PlatformLearningIdentity,
    signal: AbortSignal,
    page?: LearningPage,
  ) {
    check(signal)
    if (fingerprint(await identity(expected.storeId)) !== fingerprint(expected))
      throw Error('平台账号或店铺身份已变化，采集未继续')
    check(signal)
    if (page) {
      assertPage(page)
      await captcha(page, signal)
      const actual = normalizeIdentity(
        expected.storeId,
        await bounded(page.executeJavaScript(options.identityScript()), signal),
      )
      if (fingerprint(actual) !== fingerprint(expected)) throw Error('采集窗口账号或店铺身份不一致')
      assertPage(page)
    }
  }
  async function windowFor(
    id: string,
    source: keyof typeof urls,
    signal?: AbortSignal,
    navigate = true,
  ) {
    storeFor(id)
    const key = `${id}:${source}`
    let win = windows.get(key)
    if (!win || win.isDestroyed()) {
      const partition = assistPartition(options.namespace, id, 'pdd-web')
      if (options.createWindow) win = options.createWindow(partition)
      else {
        const { BrowserWindow } = await import('electron')
        win = new BrowserWindow({
          width: 1240,
          height: 900,
          show: false,
          autoHideMenuBar: true,
          webPreferences: {
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        })
      }
      check(signal)
      windows.set(key, win)
      win.setTitle(source === 'products' ? '灵兔 AI · 平台商品采集' : '灵兔 AI · 平台聊天记录')
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guard = (event: { preventDefault(): void }, url: string) => {
        if (!isAllowedAssistUrl('pdd-web', url)) event.preventDefault()
      }
      win.webContents.on('will-navigate', guard)
      win.webContents.on('will-redirect', guard)
    }
    if (navigate && win.webContents.getURL() !== urls[source]) {
      try {
        await bounded(win.loadURL(urls[source]), signal)
      } catch (cause) {
        if (signal?.aborted && !win.isDestroyed()) win.destroy()
        throw cause
      }
    }
    check(signal)
    if (navigate) assertPage(win.webContents)
    return win
  }
  function cursor(input: PlatformLearningCollectInput, kind: 'products' | 'chats') {
    platformLearningRangeSchema.parse(input.range)
    platformLearningIdentitySchema.parse(input.identity)
    if (!input.cursor) return null
    let value: z.infer<typeof cursorSchema>
    try {
      value = cursorSchema.parse(JSON.parse(input.cursor))
    } catch {
      throw Error('平台学习游标无效，请新建任务')
    }
    if (
      value.kind !== kind ||
      value.identity !== fingerprint(input.identity) ||
      value.range !== fingerprint(input.range)
    )
      throw Error('平台学习游标的身份或范围不一致')
    return value
  }
  async function readProducts(
    page: LearningPage,
    status: PlatformLearningCollectInput['range']['productStatus'],
    signal: AbortSignal,
  ) {
    const until = Date.now() + timeoutMs
    let lastError = '商品列表尚未加载'
    do {
      check(signal)
      assertPage(page)
      await captcha(page, signal)
      const result = productDomSchema.parse(
        await bounded(page.executeJavaScript(productScript(status)), signal),
      )
      if (result.recognized) return result
      lastError = result.error
      await bounded(new Promise<void>((resolve) => setTimeout(resolve, 50)), signal)
    } while (Date.now() < until)
    throw Error(lastError)
  }
  async function runQuery(
    page: LearningPage,
    action: () => Promise<void>,
    ready: () => Promise<boolean>,
    signal: AbortSignal,
    requestPaths: readonly string[] = ['/vodka/v2/mms/query/display/mall/goodsList'],
  ) {
    check(signal)
    if (options.runQuery) return options.runQuery(page, action, ready, signal)
    if (page.id === undefined || !page.session) throw Error('原生平台查询观察尚未就绪')
    return queries.run(
      { id: page.id, session: page.session, isDestroyed: () => page.isDestroyed() },
      action,
      ready,
      signal,
      requestPaths,
    )
  }
  async function selectProductStatus(
    page: LearningPage,
    status: PlatformLearningCollectInput['range']['productStatus'],
    signal: AbortSignal,
  ) {
    const script = `(() => {
        const root=document.querySelector('#pdd-app-skeleton-main-content');
        const names=${JSON.stringify(status === 'all' ? ['全部商品', '全部'] : status === 'on-sale' ? ['在售中', '出售中', '在售', '售卖中'] : ['已下架', '下架'])};
        const target=Array.from(root?.querySelectorAll('[class*="TAB_tabItem_"],[role="tab"]')??[]).find(node=>names.some(name=>new RegExp('^'+name+'(?:\\\\s*[（(]?\\\\d+[）)]?)?$').test(node.textContent.trim())));
        return target?(target.hasAttribute('aria-selected')?target.getAttribute('aria-selected'):String(target.className.includes('TAB_active_'))):'unknown';
      })()`
    if ((await bounded(page.executeJavaScript(script), signal)) !== 'false') return
    await runQuery(
      page,
      async () => {
        assertPage(page)
        await captcha(page, signal)
        await bounded(
          page.executeJavaScript(
            script.replace(
              "return target?(target.hasAttribute('aria-selected')?target.getAttribute('aria-selected'):String(target.className.includes('TAB_active_'))):'unknown';",
              "if(!target||target.hasAttribute('disabled')||target.getAttribute('aria-selected')==='true'||target.className.includes('TAB_active_'))throw Error('商品筛选入口已变化');target.click();",
            ),
          ),
          signal,
        )
      },
      async () =>
        productDomSchema.parse(await bounded(page.executeJavaScript(productScript(status)), signal))
          .recognized,
      signal,
    )
  }
  function exclusive<T>(job: () => Promise<T>) {
    const pending = queue.then(job)
    queue = pending.catch(() => undefined)
    return pending
  }
  async function collectProducts(
    input: PlatformLearningCollectInput,
  ): Promise<PlatformLearningPage<PlatformLearningProduct>> {
    return exclusive(async () => {
      const saved = cursor(input, 'products')
      await verify(input.identity, input.signal)
      const win = await windowFor(input.identity.storeId, 'products', input.signal, false),
        page = win.webContents
      const abort = () => {
        if (!win.isDestroyed()) win.destroy()
      }
      input.signal.addEventListener('abort', abort, { once: true })
      try {
        if (!saved || page.getURL() !== urls.products) {
          await runQuery(
            page,
            () => bounded(win.loadURL(urls.products), input.signal),
            async () => {
              assertPage(page)
              await captcha(page, input.signal)
              return (
                (await bounded(
                  page.executeJavaScript(
                    `Boolean(document.querySelector('#pdd-app-skeleton-main-content table,#pdd-app-skeleton-main-content [role="table"]'))`,
                  ),
                  input.signal,
                )) === true
              )
            },
            input.signal,
          )
        }
        await verify(input.identity, input.signal, page)
        await selectProductStatus(page, input.range.productStatus, input.signal)
        let dom = await readProducts(page, input.range.productStatus, input.signal)
        const target = saved?.offset ?? 1
        if (dom.page !== null && dom.page > target) {
          await runQuery(
            page,
            () => bounded(win.loadURL(urls.products), input.signal),
            async () => {
              const first = productDomSchema.parse(
                await bounded(
                  page.executeJavaScript(productScript(input.range.productStatus)),
                  input.signal,
                ),
              )
              return first.recognized && first.page === 1
            },
            input.signal,
          )
          await selectProductStatus(page, input.range.productStatus, input.signal)
          dom = await readProducts(page, input.range.productStatus, input.signal)
        }
        while (dom.page !== null && dom.page < target) {
          if (dom.hasNext !== true) throw Error('平台商品分页入口尚未验证，未跳过页面')
          const previous = dom.page
          await runQuery(
            page,
            async () => {
              await captcha(page, input.signal)
              await bounded(
                page.executeJavaScript(
                  `(() => { if(document.querySelector('#pdd-app-skeleton-main-content [class*="PGT_outerWrapper_"]'))return (${clickPddPage.toString()})('next',${previous},(${hasVisiblePddCaptcha.toString()})); const root=document.querySelector('#pdd-app-skeleton-main-content');const active=root?.querySelector('[aria-current="page"]');const next=root?.querySelector('a[rel="next"],button[aria-label="下一页"],[role="button"][aria-label="下一页"],li[title="下一页"]');if(Number(active?.textContent?.trim())!==${previous}||!next||next.getAttribute('aria-disabled')==='true'||next.hasAttribute('disabled'))throw Error('商品页码或翻页入口已改变');next.click(); })()`,
                ),
                input.signal,
              )
            },
            async () => {
              const next = productDomSchema.parse(
                await bounded(
                  page.executeJavaScript(productScript(input.range.productStatus)),
                  input.signal,
                ),
              )
              return next.recognized && next.page === previous + 1
            },
            input.signal,
          )
          const until = Date.now() + timeoutMs
          do {
            dom = await readProducts(page, input.range.productStatus, input.signal)
            if (dom.page === previous + 1) break
            await bounded(new Promise<void>((resolve) => setTimeout(resolve, 50)), input.signal)
          } while (Date.now() < until)
          if (dom.page !== previous + 1) throw Error('商品翻页未确认，已保留上次成功页')
          await verify(input.identity, input.signal, page)
        }
        if (target > 1 && dom.page !== target) throw Error('商品页码尚未验证，无法恢复此游标')
        if (saved?.total !== undefined && dom.total !== saved.total)
          throw Error('平台商品总数已变化，请重新建立采集范围')
        await verify(input.identity, input.signal, page)
        const next =
          dom.hasNext === true && dom.page !== null
            ? JSON.stringify({
                version: 1,
                kind: 'products',
                offset: dom.page + 1,
                identity: fingerprint(input.identity),
                range: fingerprint(input.range),
                ...(dom.total !== null ? { total: dom.total } : {}),
              })
            : null
        return {
          identity: input.identity,
          items: dom.items,
          nextCursor: next,
          exhausted: next === null,
          ...(dom.total !== null ? { total: dom.total } : {}),
          scope: dom.scope,
          capturedAt: now(),
          rangeComplete: dom.hasNext !== null && dom.page !== null,
        }
      } catch (cause) {
        if (!input.signal.aborted && !win.isDestroyed()) win.show()
        throw Error(`商品采集未完成：${cause instanceof Error ? cause.message : '平台读取失败'}`, {
          cause,
        })
      } finally {
        input.signal.removeEventListener('abort', abort)
      }
    })
  }
  async function collectChats(
    input: PlatformLearningCollectInput,
  ): Promise<PlatformLearningPage<PlatformLearningChat>> {
    return exclusive(async () => {
      const saved = cursor(input, 'chats')
      if (!input.range.from || !input.range.to) throw Error('平台聊天采集必须明确起止日期')
      if (saved && !saved.collection?.startsWith('native-history:'))
        throw Error('旧任务不是后台历史查询，请新建任务以核对范围')
      await verify(input.identity, input.signal)
      const win = await windowFor(input.identity.storeId, 'chats', input.signal),
        page = win.webContents
      const abort = () => {
        if (!win.isDestroyed()) win.destroy()
      }
      input.signal.addEventListener('abort', abort, { once: true })
      try {
        let observer = historyObservers.get(page)
        if (!observer) {
          if (!options.createHistoryObserver && !page.debugger)
            throw Error('平台历史响应观察接口未就绪')
          observer = options.createHistoryObserver
            ? options.createHistoryObserver(page)
            : createPddHistoryObserver(page.debugger!)
          historyObservers.set(page, observer)
        }
        await bounded(observer.ready(), input.signal)
        const read = async () => {
          check(input.signal)
          assertPage(page)
          await captcha(page, input.signal)
          const dom = pddChatDomSchema.parse(
            await bounded(page.executeJavaScript(`(${readPddChatDom.toString()})()`), input.signal),
          )
          if (!dom.recognized) throw Error(dom.error)
          return dom
        }
        const act = async (action: PddChatAction) => {
          check(input.signal)
          assertPage(page)
          await captcha(page, input.signal)
          await bounded(
            page.executeJavaScript(
              `(${performPddChatAction.toString()})(${JSON.stringify(action)})`,
            ),
            input.signal,
          )
        }
        let dom = await read()
        if (dom.from !== input.range.from || dom.to !== input.range.to) {
          await act({ action: 'open-range' })
          await act({ action: 'date', date: input.range.from })
          await act({ action: 'date', date: input.range.to })
          await act({ action: 'confirm-range' })
          dom = await read()
        }
        if (!dom.allStaff || dom.from !== input.range.from || dom.to !== input.range.to)
          throw Error('平台聊天实际客服或日期范围不一致')
        observer.begin()
        await runQuery(
          page,
          () => act({ action: 'query', from: input.range.from, to: input.range.to }),
          async () => (await read()).queried,
          input.signal,
          pddHistoryPaths,
        )
        let users = await bounded(observer.waitUsers(input.signal), input.signal)
        let first = users.uids.length
          ? await bounded(observer.waitMessages(input.signal), input.signal)
          : undefined
        dom = await read()
        const target = saved?.offset ?? 1
        while (dom.page < target) {
          if (!dom.hasNext) throw Error('平台聊天消费者页码范围已变化')
          const previous = dom.page
          observer.begin()
          await runQuery(
            page,
            () => act({ action: 'next', page: previous }),
            async () => {
              const next = await read()
              return next.queried && next.page === previous + 1
            },
            input.signal,
            pddHistoryPaths,
          )
          users = await bounded(observer.waitUsers(input.signal), input.signal)
          first = users.uids.length
            ? await bounded(observer.waitMessages(input.signal), input.signal)
            : undefined
          dom = await read()
          await verify(input.identity, input.signal, page)
        }
        if (
          dom.page !== target ||
          users.mallId !== input.identity.platformStoreId ||
          users.uids.length !== dom.consumers.length
        )
          throw Error('聊天消费者原生响应与当前店铺/页码/列表不一致')
        if (saved?.total !== undefined && users.total !== saved.total)
          throw Error('聊天消费者总数已变化，请新建任务重新核对范围')
        if (dom.empty && users.total !== 0) throw Error('平台聊天空态与原生总数矛盾')
        const listFingerprint = fingerprint(dom.consumers.map((row) => row.label))
        const previousFingerprint = saved?.collection?.slice('native-history:'.length)
        if (saved && previousFingerprint === fingerprint(users.uids))
          throw Error('平台聊天分页返回重复消费者，未推进本页')
        const items: PlatformLearningChat[] = []
        let checkedMessages = 0,
          declaredMessages = 0,
          complete = true
        for (const row of dom.consumers) {
          check(input.signal)
          let current = await read(),
            metadata: NativeHistoryMessages
          if (row.index === 0 && row.active && first) metadata = first
          else {
            observer.begin()
            await runQuery(
              page,
              () => act({ action: 'consumer', index: row.index, label: row.label }),
              async () => (await read()).consumers[row.index]?.active === true,
              input.signal,
              [pddHistoryPaths[1]],
            )
            metadata = await bounded(observer.waitMessages(input.signal), input.signal)
          }
          if (
            metadata.mallId !== input.identity.platformStoreId ||
            metadata.uid !== users.uids[row.index]
          )
            throw Error('聊天消息响应的店铺或消费者不一致，未保存本页')
          const allMetadata = new Map(metadata.messages.map((message) => [message.id, message]))
          const allDom = new Map<string, (typeof current.messages)[number]>()
          const capture = async () => {
            current = await read()
            if (
              current.page !== target ||
              current.from !== input.range.from ||
              current.to !== input.range.to ||
              !current.allStaff ||
              !current.consumers[row.index]?.active ||
              fingerprint(current.consumers.map((entry) => entry.label)) !== listFingerprint
            )
              throw Error('聊天列表、消费者或查询范围在读取期间变化')
            for (const message of current.messages) {
              const native = allMetadata.get(message.id)
              if (!native || Math.floor(native.at / 1000) !== Math.floor(message.at / 1000))
                throw Error('页面聊天消息标识或时间与原生响应不符')
              allDom.set(message.id, message)
            }
          }
          await capture()
          for (
            let part = 0;
            (allMetadata.size < metadata.total || current.messageHasNext) && part < 50;
            part++
          ) {
            const before = allMetadata.size
            observer.begin()
            try {
              let more: NativeHistoryMessages
              if (current.messageHasNext) {
                const previous = current.messagePage
                await runQuery(
                  page,
                  () => act({ action: 'message-next', page: previous }),
                  async () => (await read()).messagePage === previous + 1,
                  input.signal,
                  [pddHistoryPaths[1]],
                )
                more = await bounded(observer.waitMessages(input.signal), input.signal)
              } else {
                await act({ action: 'scroll', edge: part % 2 === 0 ? 'end' : 'start' })
                more = await observer.waitMessages(input.signal, 700)
              }
              if (
                more.uid !== metadata.uid ||
                more.mallId !== metadata.mallId ||
                more.total !== metadata.total
              )
                throw Error('聊天消息分页的目标或总数已变化')
              for (const message of more.messages) allMetadata.set(message.id, message)
              await capture()
            } catch (cause) {
              if (
                input.signal.aborted ||
                !(cause instanceof Error) ||
                !cause.message.includes('尚未确认平台聊天原生响应')
              )
                throw cause
              break
            }
            if (allMetadata.size === before) break
          }
          const verifiedCount = [...allMetadata.keys()].filter((id) => allDom.has(id)).length
          checkedMessages += verifiedCount
          declaredMessages += metadata.total
          complete &&= verifiedCount === metadata.total && !current.messageHasNext
          const messages: PlatformLearningChat['messages'] = []
          for (const [id, native] of allMetadata) {
            const rendered = allDom.get(id)
            if (!rendered || rendered.system) continue
            messages.push({
              id,
              from: native.seller ? 'seller' : 'buyer',
              at: native.at,
              type:
                native.type === 0 && rendered.type === 'text'
                  ? 'text'
                  : rendered.type === 'text'
                    ? 'other'
                    : rendered.type,
              text: rendered.text,
            })
          }
          messages.sort((a, b) => a.at - b.at)
          items.push({ id: metadata.uid, uid: metadata.uid, messages })
          await verify(input.identity, input.signal, page)
        }
        const nextCursor = dom.hasNext
          ? JSON.stringify({
              version: 1,
              kind: 'chats',
              offset: dom.page + 1,
              identity: fingerprint(input.identity),
              range: fingerprint(input.range),
              total: users.total,
              collection: `native-history:${fingerprint(users.uids)}`,
            })
          : null
        return {
          identity: input.identity,
          items,
          nextCursor,
          exhausted: nextCursor === null,
          total: users.total,
          rangeComplete: complete,
          capturedAt: now(),
          scope: `平台后台聊天记录；全部客服；${input.range.from}至${input.range.to}（北京时间）；消费者第${dom.page}/${dom.pages}页、本页${items.length}个，平台总数${users.total}；实际消息已核对${checkedMessages}/${declaredMessages}条（含系统/媒体）；${complete ? '本页每会话均与平台消息总数一致' : '部分会话的后续消息未能由平台原页确认，保留部分范围'}`,
        }
      } catch (cause) {
        if (!input.signal.aborted && !win.isDestroyed()) win.show()
        throw Error(`聊天采集未完成：${cause instanceof Error ? cause.message : '平台读取失败'}`, {
          cause,
        })
      } finally {
        input.signal.removeEventListener('abort', abort)
      }
    })
  }
  async function reveal(storeId: string, source: keyof typeof urls = 'products') {
    if (source !== 'products' && source !== 'chats') throw Error('平台学习页面类型无效')
    await identity(storeId)
    const win = await windowFor(storeId, source)
    win.show()
  }
  function dispose() {
    if (closed) return
    closed = true
    shutdown.abort()
    queries.dispose()
    for (const observer of historyObservers.values()) observer.dispose()
    historyObservers.clear()
    for (const win of windows.values()) if (!win.isDestroyed()) win.destroy()
    windows.clear()
  }
  return { identity, collectProducts, collectChats, reveal, dispose }
}
