export interface PddTicketRow {
  rowIndex: number
  title: string
  status: string
  orderNo?: string
  deadline?: string
}
export interface PddTicketDom {
  recognized: boolean
  total: number | null
  rows: PddTicketRow[]
  complete: boolean
  message: string
}

/** 选择器与待处理/近60天范围均来自已登录页面及脱敏结构取证。 */
export function readPddTicketDom(): PddTicketDom {
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  const failed = (message: string): PddTicketDom => ({
    recognized: false,
    total: null,
    rows: [],
    complete: false,
    message,
  })
  if (
    !root ||
    location.origin !== 'https://mms.pinduoduo.com' ||
    location.pathname !== '/aftersales/work_order/list'
  )
    return failed('工单列表来源尚未识别')
  const text = (element: Element) =>
    ((element as HTMLElement).innerText ?? element.textContent ?? '').trim()
  const body = text(root)
  const headers = Array.from(root.querySelectorAll('[class*="listTable_headerCell__"]')).map(text)
  if (headers.join('|') !== '订单信息|处理进度|处理时间|操作')
    return failed('工单表头已改变，未采用本次结果')
  const pending = Array.from(root.querySelectorAll('input')).some(
    (element) => element.value === '待处理',
  )
  const range =
    body.includes('近60天') ||
    Array.from(root.querySelectorAll('input')).some((element) =>
      ['近60天', '近60天内'].includes(element.value),
    )
  if (!pending || !range) return failed('工单筛选范围不是待处理/近60天，请在后台核对')
  const summary = body.match(/共查询到\s*(\d+)\s*个工单/)
  const pagination = body.match(/共有\s*(\d+)\s*条/)
  if (!summary || !pagination || summary[1] !== pagination[1]) return failed('工单总数尚未识别')
  const total = Number(summary[1])
  if (!Number.isSafeInteger(total) || total < 0) return failed('工单总数无效')
  const elements = Array.from(root.querySelectorAll('[class*="listItem_workOrderItem__"]'))
  if (total > 0 && !elements.length) return failed('工单列表尚未加载完成')
  if (total === 0 && elements.length) return failed('工单总数与记录矛盾')
  const rows: PddTicketRow[] = []
  for (const [rowIndex, element] of elements.slice(0, 20).entries()) {
    const cells = Array.from(element.querySelectorAll('[class*="listItem_itemCell__"]'))
    const status = element.querySelector('[class*="tableItemStatus_statusText__"]')
    const button = element.querySelector('[class*="listTable_operateBtn__"]')
    if (
      cells.length !== 4 ||
      !status ||
      text(status) !== '待处理' ||
      !button ||
      text(button) !== '立即处理'
    )
      return failed('工单记录结构已改变')
    const order = text(cells[0])
    const orderNo = text(element).match(/订单号\s*[：:]\s*([0-9-]{6,100})/)?.[1]
    const problem = order.match(/订单问题\s*[：:]\s*([^\n\r]{1,200})/)?.[1]?.trim()
    rows.push({
      rowIndex,
      title: problem || '待处理工单',
      status: text(status).slice(0, 100),
      ...(orderNo ? { orderNo } : {}),
      ...(text(cells[2]) ? { deadline: text(cells[2]).slice(0, 100) } : {}),
    })
  }
  return {
    recognized: true,
    total,
    rows,
    complete: total === rows.length,
    message:
      total === rows.length
        ? '待处理工单（近60天）'
        : `待处理工单（近60天，仅第1页，已读${rows.length}/${total}条）`,
  }
}

/** 只观察“查询”触发的同源请求是否成功结束；不读取响应体、请求头或私有接口路径。 */
export async function refreshPddTicketQuery(
  kind: 'ticket' | 'aftersale' = 'ticket',
  captcha?: () => boolean,
): Promise<void> {
  if (captcha?.()) throw new Error('platform_verification_required')
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  let query: HTMLElement | undefined = Array.from(root?.querySelectorAll('button') ?? []).find(
    (element) => element.textContent?.trim() === '查询' && element.getClientRects().length,
  )
  if (kind === 'aftersale') {
    const filter = Array.from(
      root?.querySelectorAll('[class*="MmsUiQuickFilter___content___"]') ?? [],
    ).find((element) => /^待商家处理\s*\d*$/.test(element.textContent?.trim() ?? ''))
    if (!filter) throw new Error('售后待商家处理筛选尚未识别')
    if (!filter.className.includes('MmsUiQuickFilter___checked___')) query = filter as HTMLElement
  }
  if (!query || query.hasAttribute('disabled')) throw new Error('平台查询入口尚未就绪')
  const originalFetch = window.fetch
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const restoreResponses: (() => void)[] = []
  const tracked = new WeakSet<XMLHttpRequest>()
  let started = 0,
    pending = 0,
    failed = false,
    lastSettled = performance.now()
  const start = () => {
    started++
    pending++
  }
  const finish = (ok: boolean) => {
    pending--
    failed ||= !ok
    lastSettled = performance.now()
  }
  const sameOrigin = (url: string) => {
    try {
      return new URL(url, location.href).origin === location.origin
    } catch {
      return false
    }
  }
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const input = args[0]
    const same = sameOrigin(
      typeof input === 'string' || input instanceof URL ? String(input) : input.url,
    )
    if (!same) return Reflect.apply(originalFetch, this, args)

    start()
    try {
      const response = await Reflect.apply(originalFetch, this, args)
      let settled = false
      const bodyDone = (ok: boolean) => {
        if (!settled) {
          settled = true

          finish(ok)
        }
      }
      if (response.body === null) bodyDone(response.ok)
      else
        for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const) {
          const original = response[method]
          if (typeof original !== 'function') continue
          const descriptor = Object.getOwnPropertyDescriptor(response, method)
          const wrapped = (...values: unknown[]) => {
            try {
              const result: Promise<unknown> = Reflect.apply(original, response, values)
              return result.then(
                (value) => {
                  bodyDone(response.ok)
                  return value
                },
                (error) => {
                  bodyDone(false)
                  throw error
                },
              )
            } catch (error) {
              bodyDone(false)
              throw error
            }
          }
          Object.defineProperty(response, method, {
            configurable: true,
            writable: true,
            value: wrapped,
          })
          restoreResponses.push(() => {
            if (descriptor) Object.defineProperty(response, method, descriptor)
            else Reflect.deleteProperty(response, method)
          })
        }
      return response
    } catch (error) {
      finish(false)
      throw error
    }
  }
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    if (sameOrigin(String(url))) tracked.add(this)
    else tracked.delete(this)
    Reflect.apply(
      originalOpen,
      this,
      async === undefined ? [method, url] : [method, url, async, username, password],
    )
  }
  XMLHttpRequest.prototype.send = function (body) {
    if (!tracked.has(this)) return Reflect.apply(originalSend, this, [body])

    start()
    const ended = () => finish(this.status >= 200 && this.status < 300)
    this.addEventListener('loadend', ended, { once: true })
    try {
      Reflect.apply(originalSend, this, [body])
    } catch (error) {
      this.removeEventListener('loadend', ended)
      finish(false)
      throw error
    }
  }
  try {
    const deadline = performance.now() + 8000
    query.click()
    while (performance.now() < deadline) {
      if (captcha?.()) throw new Error('platform_verification_required')
      if (
        started > 0 &&
        pending === 0 &&
        performance.now() - lastSettled >= 200 &&
        !query.hasAttribute('disabled') &&
        !root?.querySelector('[aria-busy="true"]')
      ) {
        if (failed) throw new Error('工单查询请求失败，保留上次结果')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('尚未确认工单查询完成，保留上次结果')
  } finally {
    window.fetch = originalFetch
    XMLHttpRequest.prototype.open = originalOpen
    XMLHttpRequest.prototype.send = originalSend
    for (const restore of restoreResponses) restore()
  }
}

/** 未绘制窗口的hit-test可能返回null；CSS可见且有布局的滑块提示必须阻断采集。 */
export function hasVisiblePddCaptcha(): boolean {
  const labels = ['请向右滑块完成拼图', '请完成安全验证', '滑动验证']
  return Array.from(document.body?.querySelectorAll('*') ?? []).some((element) => {
    if (
      element.children.length ||
      !labels.some((value) => element.textContent?.trim().includes(value))
    )
      return false
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        return false
    }
    return Array.from(element.getClientRects()).some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth,
    )
  })
}

/** 真实原生“立即处理”已核对为此详情路由；订单号永不代替工单ID。 */
export function pddTicketDetailId(input: string): string | undefined {
  try {
    const url = new URL(input)
    if (
      url.origin !== 'https://mms.pinduoduo.com' ||
      url.username ||
      url.password ||
      url.pathname !== '/aftersales/work_order/tododetail'
    )
      return undefined
    const id = url.searchParams.get('id')
    return id && /^[a-zA-Z0-9_-]{1,150}$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

export function readPddAfterSaleDom(): PddTicketDom {
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  const failed = (message: string): PddTicketDom => ({
    recognized: false,
    total: null,
    rows: [],
    complete: false,
    message,
  })
  if (
    !root ||
    location.origin !== 'https://mms.pinduoduo.com' ||
    location.pathname !== '/aftersales/aftersale_list'
  )
    return failed('售后列表来源尚未识别')
  const text = (element: Element) =>
    ((element as HTMLElement).innerText ?? element.textContent ?? '').trim()
  const headers = Array.from(
    root.querySelectorAll('[class*="after-sales-table_header_cell__"]'),
  ).map(text)
  if (headers.join('|') !== '订单信息|金额|发货状态|售后类型|售后状态|售后协商|售后原因|操作')
    return failed('售后表头已改变')
  const selected = Array.from(
    root.querySelectorAll('[class*="MmsUiQuickFilter___checked___"]'),
  ).some((element) => /^待商家处理\s*\d*$/.test(text(element)))
  if (!selected) return failed('售后尚未选择待商家处理，未把其他筛选当作待办')
  const range =
    text(root).includes('近3个月') ||
    Array.from(root.querySelectorAll('input')).some((element) =>
      ['近3个月', '近3个月内'].includes(element.value),
    )
  if (!range) return failed('售后申请时间范围尚未核对')
  const count = text(root).match(/共有\s*(\d+)\s*条/)
  if (!count) return failed('售后分页总数尚未识别')
  const total = Number(count[1])
  const empty = root.querySelector('[class*="after-sales-table_empty_display__"]')
  if (total === 0 && empty && text(empty) === '暂无售后单')
    return {
      recognized: true,
      total: 0,
      rows: [],
      complete: true,
      message: '待商家处理售后（近3个月内）',
    }
  return failed('售后非空记录结构尚未完成核对，数量未知')
}
import { z } from 'zod'

export const pddTicketDomSchema = z.object({
  recognized: z.boolean(),
  total: z.number().int().nonnegative().nullable(),
  rows: z
    .array(
      z.object({
        rowIndex: z.number().int().min(0).max(49),
        title: z.string().max(300),
        status: z.string().max(100),
        orderNo: z.string().max(100).optional(),
        deadline: z.string().max(100).optional(),
      }),
    )
    .max(20),
  complete: z.boolean(),
  message: z.string().max(300),
})
