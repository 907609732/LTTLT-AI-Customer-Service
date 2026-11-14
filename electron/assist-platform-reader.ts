import type { WebContents } from 'electron'
import type { AssistPageResult, AssistStore } from './assist-platform-collector'
import type { PlatformItem, PlatformItemKind } from '../src/shared/contracts/platform-items'
import {
  assistCollectionUrl,
  isAllowedAssistUrl,
  type AssistPlatform,
} from './assist-platform-host'
import {
  pddDetailId,
  pddTicketDomSchema,
  readPddTicketDom,
  readPddAfterSaleDom,
  hasVisiblePddCaptcha,
  readPddPagination,
  pddPaginationSchema,
} from './assist-platform-pdd'

type Page = Pick<WebContents, 'getURL' | 'executeJavaScript'>
const unknownPage = (message: string): AssistPageResult => ({
  authenticated: null,
  identityId: '',
  identityName: '',
  recognized: false,
  items: [],
  total: null,
  complete: false,
  message,
})

/** 列表适配只采用实页核对的结构；身份读取复用固定上游实现。 */
export function createAssistPlatformReader(options: {
  page(storeId: string): Page | undefined
  collectionPage(
    store: { id: string; platform: AssistPlatform },
    kind: PlatformItemKind,
    signal?: AbortSignal,
  ): Promise<Page>
  refreshQuery(page: Page, kind: PlatformItemKind, signal?: AbortSignal): Promise<void>
  turnPage(
    page: Page,
    kind: PlatformItemKind,
    direction: 'first' | 'next',
    expected: number,
    signal?: AbortSignal,
  ): Promise<void>
  observeAfterSaleDetail?(
    storeId: string,
    rowIndex: number,
    signal?: AbortSignal,
    orderNo?: string,
  ): Promise<string>
  identityScript(): string
  observeTicketDetail?(
    storeId: string,
    rowIndex: number,
    signal?: AbortSignal,
    orderNo?: string,
  ): Promise<string>
  rememberDetail?(storeId: string, kind: PlatformItemKind, id: string, url: string): void
}) {
  return async (
    store: AssistStore,
    kind: PlatformItemKind,
    signal?: AbortSignal,
  ): Promise<AssistPageResult> => {
    signal?.throwIfAborted()
    if (store.platform !== 'pdd-web') return unknownPage('抖店平台工单与售后尚未接入')
    const platform = store.platform as AssistPlatform
    const page = assistCollectionUrl(platform, kind)
      ? await options.collectionPage({ id: store.id, platform }, kind, signal)
      : options.page(store.id)
    if (!page) return unknownPage('请先打开平台后台，登录后同步')
    if (!isAllowedAssistUrl(platform, page.getURL()))
      return unknownPage('后台页面来源无效，请重新打开平台后台')
    // 真实拼多多页面已出现此滑块提示；返回布尔值，不回传整页内容或尝试处理验证。
    const verificationScript = `(${hasVisiblePddCaptcha.toString()})()`
    const needsVerification: unknown = await page.executeJavaScript(verificationScript)
    if (needsVerification === true)
      return {
        ...unknownPage('平台需要人工验证，请打开平台后台完成验证后手动刷新'),
        blocked: 'verification',
      }
    signal?.throwIfAborted()
    const url = new URL(page.getURL())
    const login = /(?:^|\/)(?:login|signin|passport)(?:[/._-]|$)/i.test(url.pathname)
    const result = unknownPage('平台页面尚未识别，请进入工单或售后列表后同步')
    if (login) return { ...result, authenticated: false }
    if (platform === 'pdd-web') {
      const identity: unknown = await page.executeJavaScript(options.identityScript())
      signal?.throwIfAborted()
      if (identity && typeof identity === 'object') {
        const authenticated: unknown = Reflect.get(identity, 'authenticated')
        const mallId: unknown = Reflect.get(identity, 'mallId')
        const storeName: unknown = Reflect.get(identity, 'storeName')
        result.authenticated = typeof authenticated === 'boolean' ? authenticated : null
        result.identityId = typeof mallId === 'string' ? mallId.slice(0, 100) : ''
        result.identityName = typeof storeName === 'string' ? storeName.slice(0, 60) : ''
      }
    }
    if (result.authenticated !== true) return result
    if (
      store.identityId
        ? result.identityId !== store.identityId
        : !store.storeName || result.identityName !== store.storeName
    )
      return { ...result, message: '后台店铺身份与当前店铺不一致，未读取列表' }
    const refreshQuery = async () => {
      try {
        await options.refreshQuery(page, kind, signal)
        return true
      } catch (error) {
        if (!signal?.aborted && (await page.executeJavaScript(verificationScript)) === true)
          return false
        throw error
      }
    }
    let blockedKind: 'verification' | 'login' = 'verification'
    const blocked = () => ({
      ...unknownPage(
        blockedKind === 'login' ? '平台登录已失效，已暂停采集' : '平台需要人工验证，已暂停采集',
      ),
      blocked: blockedKind,
      ...(blockedKind === 'login' ? { authenticated: false } : {}),
    })
    const verify = async () => {
      signal?.throwIfAborted()
      if ((await page.executeJavaScript(verificationScript)) === true) return false
      if (!isAllowedAssistUrl(platform, page.getURL())) throw Error('平台页面来源已改变')
      if (/(?:^|\/)(?:login|signin|passport)(?:[/._-]|$)/i.test(new URL(page.getURL()).pathname)) {
        blockedKind = 'login'
        return false
      }
      const identity: unknown = await page.executeJavaScript(options.identityScript())
      signal?.throwIfAborted()
      if (
        identity &&
        typeof identity === 'object' &&
        Reflect.get(identity, 'authenticated') === false
      ) {
        blockedKind = 'login'
        return false
      }
      if (
        !identity ||
        typeof identity !== 'object' ||
        Reflect.get(identity, 'authenticated') !== true ||
        (store.identityId
          ? Reflect.get(identity, 'mallId') !== store.identityId
          : !store.storeName || Reflect.get(identity, 'storeName') !== store.storeName)
      )
        throw Error('后台店铺身份已改变，未采用本次结果')
      return true
    }
    const readDom = async () =>
      pddTicketDomSchema.parse(
        await page.executeJavaScript(
          `(${(kind === 'ticket' ? readPddTicketDom : readPddAfterSaleDom).toString()})()`,
        ),
      )
    if (kind === 'ticket') {
      const before = await readDom()
      if (!before.recognized) return { ...result, message: before.message }
    }
    if (!(await refreshQuery())) return blocked()
    if (!(await verify())) return blocked()
    let dom = await readDom()
    if (!dom.recognized) return { ...result, message: dom.message }
    if (dom.total === null) throw Error('平台总数尚未识别')
    const total = dom.total
    const pagination = async () => {
      const state = pddPaginationSchema.parse(
        await page.executeJavaScript(
          `(${readPddPagination.toString()})(${dom.total},${dom.rows.length})`,
        ),
      )
      if (!state) throw Error('平台页码或分页总数尚未识别')
      return state
    }
    const turn = async (direction: 'first' | 'next', expected: number) => {
      try {
        await options.turnPage(page, kind, direction, expected, signal)
        return true
      } catch (error) {
        if (!signal?.aborted && (await page.executeJavaScript(verificationScript)) === true)
          return false
        throw error
      }
    }
    let state = await pagination()
    if (state.current !== 1) {
      if (!(await turn('first', state.current)) || !(await verify())) return blocked()
      dom = await readDom()
      if (!dom.recognized) throw Error(dom.message)
      state = await pagination()
      if (state.current !== 1) throw Error('平台页码未回到第一页')
    }
    const items = new Map<string, PlatformItem>()
    const signatures = new Set<string>()
    let expectedPage = 1
    while (true) {
      if (!(await verify())) return blocked()
      if (state.current !== expectedPage) throw Error('平台翻页未生效，页码不一致')
      if (dom.total !== total) throw Error('平台总数在翻页期间已改变，保留上次结果')
      if (!dom.rows.length && total > 0) throw Error('平台分页记录为空，未采用本次结果')
      const observe =
        kind === 'ticket' ? options.observeTicketDetail : options.observeAfterSaleDetail
      if (dom.rows.length && !observe) throw Error('平台详情编号尚未识别')
      const ids: string[] = []
      for (const row of dom.rows) {
        signal?.throwIfAborted()
        let url: string
        try {
          url = await observe!(store.id, row.rowIndex, signal, row.orderNo)
        } catch (error) {
          if (!(await verify())) return blocked()
          throw error
        }
        // 导航观察是异步边界；关闭或切店后不得缓存晚到的详情映射。
        if (!(await verify())) return blocked()
        const id = pddDetailId(kind, url)
        if (!id) throw Error('平台详情路由或编号已改变，未采用本次结果')
        if (kind === 'aftersale' && new URL(url).searchParams.get('orderSn') !== row.orderNo)
          throw Error('售后详情订单关联不一致')
        options.rememberDetail?.(store.id, kind, id, url)
        ids.push(id)
        if (!items.has(id) && items.size >= 1000)
          throw Error('平台记录超出单次采集上限，未采用不完整结果')
        items.set(id, {
          id,
          storeId: store.id,
          platform,
          kind,
          title: row.title,
          status: row.status,
          detailKey: id,
          ...(row.orderNo ? { orderNo: row.orderNo } : {}),
          ...(row.amount ? { amount: row.amount } : {}),
          ...(row.deadline ? { deadline: row.deadline } : {}),
        })
      }
      const checked = await readDom()
      if (
        !checked.recognized ||
        checked.total !== total ||
        JSON.stringify(
          checked.rows.map((row) => [row.orderNo, row.status, row.title, row.amount]),
        ) !==
          JSON.stringify(dom.rows.map((row) => [row.orderNo, row.status, row.title, row.amount]))
      )
        throw Error('平台列表在读取期间已改变，保留上次结果')
      const signature = JSON.stringify(ids)
      if (signatures.has(signature)) throw Error('平台返回重复页，已停止翻页')
      signatures.add(signature)
      if (items.size > total) throw Error('平台总数与去重记录不一致')
      if (!state.hasNext) {
        if (items.size !== total) throw Error('平台总数与已读取记录不一致，保留上次结果')
        if (!(await verify())) return blocked()
        return {
          ...result,
          recognized: true,
          items: [...items.values()],
          total,
          complete: true,
          message: kind === 'ticket' ? '待处理工单（近60天）' : '待商家处理售后（近3个月内）',
        }
      }
      if (expectedPage >= 50 || items.size >= 1000)
        throw Error('达到单次采集上限，未提交部分结果，保留上次数据')
      if (!(await turn('next', state.current)) || !(await verify())) return blocked()
      expectedPage++
      dom = await readDom()
      if (!dom.recognized) throw Error(dom.message)
      if (dom.total !== total) throw Error('平台总数在翻页期间已改变，保留上次结果')
      state = await pagination()
    }
  }
}
