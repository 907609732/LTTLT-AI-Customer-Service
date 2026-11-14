import type { WebContents } from 'electron'
import type { AssistPageResult, AssistStore } from './assist-platform-collector'
import type { PlatformItemKind } from '../src/shared/contracts/platform-items'
import {
  assistCollectionUrl,
  isAllowedAssistUrl,
  type AssistPlatform,
} from './assist-platform-host'
import {
  pddTicketDetailId,
  pddTicketDomSchema,
  readPddTicketDom,
  refreshPddTicketQuery,
  readPddAfterSaleDom,
  hasVisiblePddCaptcha,
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
  identityScript(): string
  observeTicketDetail?(storeId: string, rowIndex: number, signal?: AbortSignal): Promise<string>
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
        await page.executeJavaScript(
          `(${refreshPddTicketQuery.toString()})(${JSON.stringify(kind)}, ${hasVisiblePddCaptcha.toString()})`,
        )
        return true
      } catch (error) {
        if (!signal?.aborted && (await page.executeJavaScript(verificationScript)) === true)
          return false
        throw error
      }
    }
    if (kind === 'ticket') {
      let dom = pddTicketDomSchema.parse(
        await page.executeJavaScript(`(${readPddTicketDom.toString()})()`),
      )
      if (!dom.recognized) return { ...result, message: dom.message }
      if (!(await refreshQuery()))
        return { ...unknownPage('平台需要人工验证，请完成后手动刷新'), blocked: 'verification' }
      signal?.throwIfAborted()
      if ((await page.executeJavaScript(verificationScript)) === true)
        return { ...unknownPage('平台需要人工验证，请完成后手动刷新'), blocked: 'verification' }
      dom = pddTicketDomSchema.parse(
        await page.executeJavaScript(`(${readPddTicketDom.toString()})()`),
      )
      if (!dom.recognized) return { ...result, message: dom.message }
      if (dom.rows.length && !options.observeTicketDetail)
        return { ...result, message: '工单详情编号尚未识别' }
      const items = []
      for (const row of dom.rows) {
        signal?.throwIfAborted()
        const url = await options.observeTicketDetail!(store.id, row.rowIndex, signal)
        const id = pddTicketDetailId(url)
        if (!id) return { ...result, message: '工单详情路由或编号已改变，未采用本次结果' }
        options.rememberDetail?.(store.id, kind, id, url)
        items.push({
          id,
          storeId: store.id,
          platform,
          kind,
          title: row.title,
          status: row.status,
          ...(row.orderNo ? { orderNo: row.orderNo } : {}),
          ...(row.deadline ? { deadline: row.deadline } : {}),
          detailKey: id,
        })
      }
      return {
        ...result,
        recognized: true,
        items,
        total: dom.total,
        complete: dom.complete,
        message: dom.message,
      }
    }
    if (kind === 'aftersale') {
      if (!(await refreshQuery()))
        return { ...unknownPage('平台需要人工验证，请完成后手动刷新'), blocked: 'verification' }
      signal?.throwIfAborted()
      if ((await page.executeJavaScript(verificationScript)) === true)
        return { ...unknownPage('平台需要人工验证，请完成后手动刷新'), blocked: 'verification' }
      const dom = pddTicketDomSchema.parse(
        await page.executeJavaScript(`(${readPddAfterSaleDom.toString()})()`),
      )
      if (!dom.recognized) return { ...result, message: dom.message }
      return {
        ...result,
        recognized: true,
        items: [],
        total: dom.total,
        complete: dom.complete,
        message: dom.message,
      }
    }
    return result
  }
}
