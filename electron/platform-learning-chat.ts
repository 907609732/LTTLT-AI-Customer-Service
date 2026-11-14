import type { Debugger } from 'electron'
import { z } from 'zod'

export const pddHistoryPaths = [
  '/latitude/search/message/getMessagesUsers',
  '/latitude/search/message/getMessages',
] as const
export type NativeHistoryDebugger = Pick<
  Debugger,
  'attach' | 'detach' | 'isAttached' | 'sendCommand' | 'on' | 'removeListener'
>
const platformId = z
  .union([z.string().min(1).max(200), z.number().int().nonnegative().safe()])
  .transform(String)
const usersSchema = z.object({
  success: z.literal(true),
  result: z.object({
    mallInfo: z.object({ mallId: platformId }),
    total: z.number().int().nonnegative(),
    convUsers: z.array(z.object({ uid: platformId })).max(1000),
  }),
})
const messagesSchema = z.object({
  success: z.literal(true),
  result: z.object({
    mallInfo: z.object({ mallId: platformId }),
    userInfo: z.object({ uid: platformId }),
    total: z.number().int().nonnegative(),
    pageNum: z.number().int().nonnegative().nullable(),
    contentList: z
      .array(
        z.object({
          msgId: platformId,
          ts: z.number().finite().nonnegative(),
          type: z.number().int(),
          direction: z.boolean(),
        }),
      )
      .max(10000),
  }),
})
export interface NativeHistoryUsers {
  mallId: string
  total: number
  uids: string[]
}
export interface NativeHistoryMessages {
  mallId: string
  uid: string
  total: number
  pageNum: number | null
  messages: Array<{ id: string; at: number; type: number; seller: boolean }>
}
export interface NativeHistoryObserver {
  ready(): Promise<void>
  begin(): void
  waitUsers(signal: AbortSignal): Promise<NativeHistoryUsers>
  waitMessages(signal: AbortSignal, timeoutMs?: number): Promise<NativeHistoryMessages>
  dispose(): void
}

/** Observe only native UI responses on an owned history window. Never replays HTTP or retains text/headers. */
export function createPddHistoryObserver(
  debuggerApi: NativeHistoryDebugger,
): NativeHistoryObserver {
  if (debuggerApi.isAttached()) throw Error('学习窗口原生响应观察已被占用，请关闭调试面板后重试')
  debuggerApi.attach('1.3')
  let epoch = 0,
    closed = false,
    error = ''
  let users: NativeHistoryUsers | undefined, messages: NativeHistoryMessages | undefined
  const requests = new Map<string, { path: string; epoch: number; ok: boolean }>()
  const ready = debuggerApi.sendCommand('Network.enable').then(() => undefined)
  async function body(id: string, request: { path: string; epoch: number }) {
    try {
      const raw: unknown = await debuggerApi.sendCommand('Network.getResponseBody', {
        requestId: id,
      })
      if (closed || request.epoch !== epoch) return
      const response = z.object({ body: z.string(), base64Encoded: z.boolean() }).parse(raw)
      if (response.base64Encoded || Buffer.byteLength(response.body, 'utf8') > 1048576)
        throw Error('聊天原生响应超过观察容量，未截断或采用部分内容')
      const value: unknown = JSON.parse(response.body)
      if (request.path === pddHistoryPaths[0]) {
        const parsed = usersSchema.parse(value).result
        if (
          new Set(parsed.convUsers.map((row) => row.uid)).size !== parsed.convUsers.length ||
          parsed.total < parsed.convUsers.length
        )
          throw Error('聊天消费者总数或编号矛盾')
        users = {
          mallId: parsed.mallInfo.mallId,
          total: parsed.total,
          uids: parsed.convUsers.map((row) => row.uid),
        }
      } else {
        const parsed = messagesSchema.parse(value).result
        const projected = parsed.contentList.map((row) => ({
          id: row.msgId,
          at: row.ts < 100000000000 ? row.ts * 1000 : row.ts,
          type: row.type,
          seller: row.direction,
        }))
        if (
          new Set(projected.map((row) => row.id)).size !== projected.length ||
          parsed.total < projected.length
        )
          throw Error('平台消息总数或编号矛盾')
        messages = {
          mallId: parsed.mallInfo.mallId,
          uid: parsed.userInfo.uid,
          total: parsed.total,
          pageNum: parsed.pageNum,
          messages: projected,
        }
      }
    } catch (cause) {
      if (!closed && request.epoch === epoch)
        error =
          cause instanceof Error && /容量|总数|编号/.test(cause.message)
            ? cause.message
            : '聊天原生响应元数据未识别，未采用不完整结果'
    }
  }
  const onMessage = (_event: unknown, method: string, input: unknown) => {
    if (closed || !input || typeof input !== 'object') return
    const data = input as Record<string, unknown>,
      requestId = data.requestId
    if (typeof requestId !== 'string') return
    if (method === 'Network.requestWillBeSent') {
      const request = data.request
      if (!request || typeof request !== 'object' || !['XHR', 'Fetch'].includes(String(data.type)))
        return
      try {
        const url = new URL(String(Reflect.get(request, 'url')))
        if (
          url.origin === 'https://mms.pinduoduo.com' &&
          pddHistoryPaths.includes(url.pathname as (typeof pddHistoryPaths)[number])
        ) {
          if (requests.size >= 1000) throw Error('聊天原生请求观察容量已满')
          requests.set(requestId, { path: url.pathname, epoch, ok: false })
        }
      } catch {
        error = '聊天原生请求来源或观察容量异常'
      }
      return
    }
    const request = requests.get(requestId)
    if (!request || request.epoch !== epoch) return
    if (method === 'Network.responseReceived') {
      const response = data.response
      let sameSource = false
      try {
        const url = new URL(
          String(response && typeof response === 'object' ? Reflect.get(response, 'url') : ''),
        )
        sameSource = url.origin === 'https://mms.pinduoduo.com' && url.pathname === request.path
      } catch {
        /* A response without its verified source is never inspected. */
      }
      request.ok =
        sameSource &&
        !!response &&
        typeof response === 'object' &&
        Reflect.get(response, 'status') === 200 &&
        /json/i.test(String(Reflect.get(response, 'mimeType')))
    } else if (method === 'Network.loadingFinished') {
      requests.delete(requestId)
      if (typeof data.encodedDataLength !== 'number' || data.encodedDataLength > 1048576) {
        error = '聊天原生响应超过观察容量，未截断'
        return
      }
      if (!request.ok) {
        error = '平台聊天查询请求失败，未采用结果'
        return
      }
      void body(requestId, request)
    } else if (method === 'Network.loadingFailed') {
      requests.delete(requestId)
      error = '平台聊天查询请求失败，未采用结果'
    }
  }
  const onDetach = () => {
    if (!closed) error = '聊天原生响应观察已中断，请重新打开采集窗口后重试'
  }
  debuggerApi.on('message', onMessage)
  debuggerApi.on('detach', onDetach)
  async function wait<T>(
    read: () => T | undefined,
    signal: AbortSignal,
    timeoutMs = 8000,
  ): Promise<T> {
    await ready
    const until = Date.now() + timeoutMs
    do {
      signal.throwIfAborted()
      if (closed || error) throw Error(error || '聊天原生响应观察已关闭')
      const value = read()
      if (value) return structuredClone(value)
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    } while (Date.now() < until)
    throw Error('尚未确认平台聊天原生响应，请检查平台后重试')
  }
  return {
    ready: () => ready,
    begin() {
      epoch++
      users = undefined
      messages = undefined
      error = ''
      requests.clear()
    },
    waitUsers: (signal) => wait(() => users, signal),
    waitMessages: (signal, timeoutMs) => wait(() => messages, signal, timeoutMs),
    dispose() {
      if (closed) return
      closed = true
      epoch++
      requests.clear()
      users = undefined
      messages = undefined
      debuggerApi.removeListener('message', onMessage)
      debuggerApi.removeListener('detach', onDetach)
      try {
        if (debuggerApi.isAttached()) debuggerApi.detach()
      } catch {
        /* Window teardown already detached the owned observer. */
      }
    },
  }
}

export const pddChatDomSchema = z.object({
  recognized: z.boolean(),
  error: z.string(),
  from: z.string(),
  to: z.string(),
  allStaff: z.boolean(),
  queried: z.boolean(),
  empty: z.boolean(),
  page: z.number().int().positive(),
  pages: z.number().int().positive(),
  hasNext: z.boolean(),
  messagePage: z.number().int().positive(),
  messageHasNext: z.boolean(),
  consumers: z
    .array(z.object({ index: z.number().int(), label: z.string(), active: z.boolean() }))
    .max(1000),
  messages: z
    .array(
      z.object({
        id: z.string(),
        at: z.number(),
        text: z.string(),
        system: z.boolean(),
        type: z.enum(['text', 'image', 'video', 'other']),
      }),
    )
    .max(10000),
})
export type PddChatDom = z.infer<typeof pddChatDomSchema>
/** This reader uses structures observed on /mms-chat/search, including real message IDs in container IDs. */
export function readPddChatDom(): PddChatDom {
  const result: PddChatDom = {
    recognized: false,
    error: '',
    from: '',
    to: '',
    allStaff: false,
    queried: false,
    empty: false,
    page: 1,
    pages: 1,
    hasNext: false,
    messagePage: 1,
    messageHasNext: false,
    consumers: [],
    messages: [],
  }
  const failed = (message: string) => ({ ...result, recognized: false, error: message })
  if (location.origin !== 'https://mms.pinduoduo.com' || location.pathname !== '/mms-chat/search')
    return failed('聊天历史页面来源不符')
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  if (!root || !root.querySelector('.cs-message-table-header'))
    return failed('平台聊天记录结构尚未识别')
  const queryMode = Array.from(root.querySelectorAll('label[data-checked="true"]')).some((node) =>
    node.textContent?.includes('按客服账号查询'),
  )
  const staff = root.querySelector<HTMLInputElement>('input[placeholder="请选择"]')
  result.allStaff = queryMode && staff?.value === '全部'
  const range = root
    .querySelector<HTMLInputElement>('input[data-testid="beast-core-rangePicker-htmlInput"]')
    ?.value.match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/)
  if (!range) return failed('聊天历史日期范围尚未核对')
  result.from = range[1]!
  result.to = range[2]!
  const elements = Array.from(root.querySelectorAll('.cs-list>.user-item'))
  result.consumers = elements.map((node, index) => ({
    index,
    label: node.querySelector('.user-name')?.textContent?.trim() ?? '',
    active: node.classList.contains('is-active'),
  }))
  if (
    result.consumers.some((row) => !row.label) ||
    result.consumers.filter((row) => row.active).length > 1
  )
    return failed('聊天消费者列表结构已变化')
  const pager = root
    .querySelector('.table-section-left-footer [class*="PGT_simplePager_"]')
    ?.getAttribute('title')
    ?.match(/^(\d+)\/(\d+)$/)
  result.empty =
    elements.length === 0 &&
    /暂无数据|暂无记录|无查询结果|没有查询到|暂无聊天|暂无消费者/.test(root.textContent ?? '')
  result.queried =
    !/请点击[“"]?查询[”"]?查看聊天记录/.test(root.textContent ?? '') &&
    (elements.length > 0 || result.empty)
  if (elements.length && !pager) return failed('聊天消费者分页未识别')
  if (pager) {
    result.page = Number(pager[1])
    result.pages = Number(pager[2])
    if (result.page < 1 || result.pages < result.page || result.pages > 1000)
      return failed('聊天消费者页码无效')
    const next = root.querySelector(
      '.table-section-left-footer [data-testid="beast-core-pagination-next"]',
    )
    if (!next) return failed('聊天消费者翻页入口缺失')
    result.hasNext =
      !next.className.includes('PGT_disabled_') && next.getAttribute('aria-disabled') !== 'true'
    if (result.hasNext !== result.page < result.pages) return failed('聊天消费者页码与下一页矛盾')
  }
  const messagePager =
    root.querySelector('.table-section-right-footer [data-testid="beast-core-pagination"]') ??
    root.querySelector('.table-section-right-footer')
  if (messagePager?.querySelector('[class*="PGT_pagerItemActive_"]')) {
    const active = messagePager.querySelectorAll('[class*="PGT_pagerItemActive_"]')
    const next = messagePager.querySelector('[data-testid="beast-core-pagination-next"]')
    result.messagePage = Number(active[0]?.textContent?.trim())
    if (
      active.length !== 1 ||
      !Number.isSafeInteger(result.messagePage) ||
      result.messagePage < 1 ||
      !next
    )
      return failed('聊天消息独立分页结构未识别')
    result.messageHasNext =
      !next.className.includes('PGT_disabled_') &&
      next.getAttribute('aria-disabled') !== 'true' &&
      !next.hasAttribute('disabled')
  }
  for (const container of Array.from(
    root.querySelectorAll('.new-message-list>.message-item-container'),
  )) {
    const node = container.querySelector('.message-item'),
      body = node?.querySelector('.message-body')
    const id = container.id.replace(/^message-item-/, '')
    const time = node?.querySelector('.message-time')?.textContent?.trim() ?? ''
    if (!id || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time))
      return failed('聊天消息标识或实际时间未识别')
    const at = Date.parse(time.replace(' ', 'T') + '+08:00')
    if (!Number.isFinite(at) || !body) return failed('聊天消息实际时间或正文结构无效')
    const text = Array.from(body.querySelectorAll('.message-text'))
      .map((entry) => entry.textContent ?? '')
      .join('\n')
      .trim()
    result.messages.push({
      id,
      at,
      text,
      system: node?.classList.contains('system-message') ?? false,
      type: body.querySelector('video')
        ? 'video'
        : body.querySelector('img')
          ? 'image'
          : text
            ? 'text'
            : 'other',
    })
  }
  result.recognized = true
  return result
}

export type PddChatAction =
  | { action: 'open-range' | 'confirm-range' | 'query'; from?: string; to?: string }
  | { action: 'date'; date: string }
  | { action: 'consumer'; index: number; label: string }
  | { action: 'next'; page: number }
  | { action: 'message-next'; page: number }
  | { action: 'scroll'; edge: 'start' | 'end' }
/** Only fixed native query controls. No editable input, message send button, or private HTTP call. */
export function performPddChatAction(input: PddChatAction): void {
  if (location.origin !== 'https://mms.pinduoduo.com' || location.pathname !== '/mms-chat/search')
    throw Error('聊天历史页面来源不符')
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  if (!root) throw Error('聊天历史容器不可读')
  const tap = (element: Element | null | undefined) => {
    if (
      !element ||
      element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true'
    )
      throw Error('平台聊天原生查询入口不可用')
    for (const type of ['mousedown', 'mouseup', 'click'])
      element.dispatchEvent(new MouseEvent(type, { bubbles: true }))
  }
  const popup = () =>
    document.querySelector('[data-testid="beast-core-rangePicker-dropdown-contentRoot"]')
  if (input.action === 'open-range') {
    tap(root.querySelector('input[data-testid="beast-core-rangePicker-htmlInput"]'))
    return
  }
  if (input.action === 'date') {
    const match = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) throw Error('聊天日期格式无效')
    const headers = Array.from(popup()?.querySelectorAll('[class*="RPR_panelHeader_"]') ?? [])
    const tables = Array.from(popup()?.querySelectorAll('table') ?? [])
    const index = headers.findIndex(
      (header) =>
        header.querySelector('input')?.value === `${match[1]}年` &&
        header.querySelector('[class*="RPR_dateText_"]')?.textContent === `${Number(match[2])}月`,
    )
    if (index < 0 || tables.length !== headers.length)
      throw Error('所选聊天日期不在平台开放的最近30天日历范围内')
    const cells = Array.from(tables[index]!.querySelectorAll('[role="date-cell"]')).filter(
      (cell) =>
        Number(cell.textContent?.trim()) === Number(match[3]) &&
        !cell.className.includes('RPR_outOfMonth_'),
    )
    if (cells.length !== 1 || cells[0]!.className.includes('RPR_disabled_'))
      throw Error('所选聊天日期超出平台实际开放范围；请调整为最近30天内的有效日期')
    tap(cells[0])
    return
  }
  if (input.action === 'confirm-range') {
    tap(
      Array.from(popup()?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent?.trim() === '确认',
      ),
    )
    return
  }
  if (input.action === 'query') {
    const range = root
      .querySelector<HTMLInputElement>('input[data-testid="beast-core-rangePicker-htmlInput"]')
      ?.value.replace(/\s/g, '')
    const staff = root.querySelector<HTMLInputElement>('input[placeholder="请选择"]')?.value
    const mode = Array.from(root.querySelectorAll('label[data-checked="true"]')).some((label) =>
      label.textContent?.includes('按客服账号查询'),
    )
    if (!mode || staff !== '全部' || range !== `${input.from}~${input.to}`)
      throw Error('聊天历史查询方式、客服或实际日期范围已变化')
    tap(
      Array.from(root.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === '查询',
      ),
    )
    return
  }
  if (input.action === 'consumer') {
    const row = Array.from(root.querySelectorAll('.cs-list>.user-item'))[input.index]
    if (!row || row.querySelector('.user-name')?.textContent?.trim() !== input.label)
      throw Error('聊天消费者列表已变化，请重新查询')
    tap(row)
    return
  }
  if (input.action === 'message-next') {
    const footer = root.querySelector('.table-section-right-footer')
    const current = Number(
      footer?.querySelector('[class*="PGT_pagerItemActive_"]')?.textContent?.trim(),
    )
    const next = footer?.querySelector('[data-testid="beast-core-pagination-next"]')
    if (current !== input.page || !next || next.className.includes('PGT_disabled_'))
      throw Error('聊天消息页码已变化或没有下一页')
    tap(next)
    return
  }
  if (input.action === 'next') {
    const footer = root.querySelector('.table-section-left-footer')
    const actual = footer
      ?.querySelector('[class*="PGT_simplePager_"]')
      ?.getAttribute('title')
      ?.split('/')[0]
    const next = footer?.querySelector('[data-testid="beast-core-pagination-next"]')
    if (Number(actual) !== input.page || next?.className.includes('PGT_disabled_'))
      throw Error('聊天消费者页码已变化或没有下一页')
    tap(next)
    return
  }
  if (input.action !== 'scroll') throw Error('聊天原生查询操作无效')
  const list = root.querySelector('.message-list')
  if (!list) throw Error('聊天消息滚动区域未识别')
  list.scrollTop = input.edge === 'start' ? 0 : list.scrollHeight
  list.dispatchEvent(new Event('scroll', { bubbles: true }))
}
