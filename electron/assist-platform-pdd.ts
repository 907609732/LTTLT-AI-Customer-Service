export interface PddTicketRow {
  rowIndex: number
  title: string
  status: string
  orderNo?: string
  deadline?: string
  amount?: string
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
  for (const [rowIndex, element] of elements.slice(0, 50).entries()) {
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

/** Prepare the bounded pending-work-order query using native form controls. */
export async function preparePddTicketQuery(captcha?: () => boolean): Promise<void> {
  const guard = () => {
    if (captcha?.()) throw Error('platform_verification_required')
    if (
      location.origin !== 'https://mms.pinduoduo.com' ||
      location.pathname !== '/aftersales/work_order/list'
    )
      throw Error('工单查询来源已改变')
  }
  guard()
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  if (!root) throw Error('工单筛选尚未就绪')
  const field = (label: string, selector = 'input[data-testid="beast-core-select-htmlInput"]') => {
    const found = new Set<HTMLInputElement>()
    const labels = Array.from(root.querySelectorAll('*')).filter(
      (element) => element.textContent?.trim().replace(/[:：]$/, '') === label,
    )
    for (const leaf of labels) {
      for (
        let parent: Element | null = leaf;
        parent && parent !== root;
        parent = parent.parentElement
      ) {
        const inputs = parent.querySelectorAll<HTMLInputElement>(selector)
        if (inputs.length === 1) {
          found.add(inputs[0])
          break
        }
        if (inputs.length > 1) break
      }
    }
    if (found.size !== 1) throw Error(`工单${label}筛选尚未唯一识别`)
    return [...found][0]
  }
  const visible = (element: Element) => {
    const entering = Boolean(element.closest('[class*="PT_portalEnterActive_"]'))
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        (style.opacity === '0' && !entering)
      )
        return false
    }
    return element.getClientRects().length > 0
  }
  const wait = async (ready: () => boolean) => {
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      guard()
      if (ready()) return
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    throw Error('工单原生筛选尚未完成')
  }
  const choose = async (label: string, values: string[]) => {
    if (values.includes(field(label).value)) return
    field(label).click()
    await wait(() => {
      const options = Array.from(
        document.querySelectorAll('li[class*="ST_itemRendererLabel_"]'),
      ).filter((option) => visible(option) && values.includes(option.textContent?.trim() ?? ''))
      if (options.length > 1) throw Error(`工单${label}选项尚未唯一识别`)
      if (!options.length) return false
      ;(options[0] as HTMLElement).click()
      return true
    })
    await wait(() => values.includes(field(label).value))
  }
  const order = field('订单编号', 'input[placeholder="请输入订单编号"]')
  if (
    root.querySelectorAll('input[data-testid="beast-core-select-htmlInput"]').length !== 3 ||
    Array.from(root.querySelectorAll('input')).some(
      (input) =>
        input !== order && !input.readOnly && input.type !== 'hidden' && input.value.trim(),
    )
  )
    throw Error('工单包含未识别的额外筛选条件')
  if (order.value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter || order.readOnly) throw Error('工单订单编号筛选无法清除')
    setter.call(order, '')
    order.dispatchEvent(new Event('input', { bubbles: true }))
    order.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await choose('工单状态', ['待处理'])
  await choose('问题类型', ['全部'])
  await choose('创建时间', ['近60天内', '近60天'])
  await wait(() => field('订单编号', 'input[placeholder="请输入订单编号"]').value === '')
  const dates = root.querySelectorAll<HTMLInputElement>(
    '[data-testid="beast-core-rangePicker-htmlInput"]',
  )
  const date = (time: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(time)
  const now = Date.now()
  if (dates.length !== 1 || dates[0].value !== `${date(now - 60 * 86400000)} ~ ${date(now)}`)
    throw Error('工单近60天实际日期尚未核对')
  guard()
}

/** 仅点击已核对的查询/待商家处理入口；请求完成由主进程观察，不改写平台网络函数。 */
export function clickPddQuery(
  kind: 'ticket' | 'aftersale' = 'ticket',
  captcha?: () => boolean,
): void {
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
  query.click()
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

export function readPddAfterSaleDom(
  expectedFilter: '待商家处理' | '待买家处理' = '待商家处理',
): PddTicketDom {
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
  const headers = Array.from(root.querySelectorAll('[class*="after-sales-table_header_cell__"]'))
    .filter(
      (element) =>
        text(element) !== '' || !element.querySelector('input[type="checkbox"], [role="checkbox"]'),
    )
    .map(text)
  if (headers.join('|') !== '订单信息|金额|发货状态|售后类型|售后状态|售后协商|售后原因|操作')
    return failed('售后表头已改变')
  const selected = Array.from(
    root.querySelectorAll('[class*="MmsUiQuickFilter___checked___"]'),
  ).some((element) => new RegExp('^' + expectedFilter + '\\s*\\d*$').test(text(element)))
  if (!selected) return failed('售后尚未选择待商家处理，未把其他筛选当作待办')
  // The current platform renders the selected preset as calendar dates, not its label.
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  start.setDate(
    Math.min(now.getDate(), new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()),
  )
  const date = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const expected = `${date(start)} 00:00:00 ~ ${date(now)} 23:59:59`
  const range = Array.from(root.querySelectorAll('input')).some((element) =>
    ['近3个月', '近3个月内', expected].includes(element.value),
  )
  if (!range) return failed('售后申请时间范围尚未核对')
  const count = text(root).match(/共有\s*(\d+)\s*条/)
  if (!count) return failed('售后分页总数尚未识别')
  const total = Number(count[1])
  const elements = Array.from(root.querySelectorAll('[class*="after-sales-table_order_item__"]'))
  if (!Number.isSafeInteger(total) || total < elements.length || elements.length > 50)
    return failed('售后记录数量矛盾')
  const empty = root.querySelector('[class*="after-sales-table_empty_display__"]')
  if (total === 0 && elements.length === 0 && empty && text(empty) === '暂无售后单')
    return {
      recognized: true,
      total: 0,
      rows: [],
      complete: true,
      message: `${expectedFilter}售后（近3个月内）`,
    }
  if (total === 0 || elements.length === 0) return failed('售后列表尚未加载完成')
  const rows: PddTicketRow[] = []
  for (const [rowIndex, element] of elements.entries()) {
    const cells = Array.from(element.querySelectorAll('[class*="after-sales-table_item_cell__"]'))
    if (cells.length !== 8) return failed('售后记录列数已改变')
    const detail = Array.from(cells[7].querySelectorAll('a')).find(
      (node) => text(node) === '查看详情',
    )
    const orderNo = text(element.querySelector('[class*="table-item-header_sn__"]') ?? cells[0])
    const status = text(cells[4]).replace(/\s+/g, ' ')
    if (!detail || !/^[0-9-]{6,100}$/.test(orderNo) || !status)
      return failed('售后记录或详情入口尚未识别')
    const refund = element.querySelector('[class*="table-item-amount_refund__"]')
    const amount = refund
      ? text(refund)
          .match(/[￥¥]\s*\d+(?:\.\d{1,2})?/)?.[0]
          .replace(/\s/g, '')
      : undefined
    const expiration = element.querySelector('[class*="table-item-header_expiration__"]')
    const deadline = expiration ? text(expiration).replace(/\s+/g, ' ').slice(0, 100) : ''
    rows.push({
      rowIndex,
      orderNo,
      status: status.slice(0, 100),
      title: `${text(cells[3])} · ${text(cells[6])}`.slice(0, 300),
      ...(amount ? { amount } : {}),
      ...(deadline ? { deadline } : {}),
    })
  }
  return {
    recognized: true,
    total,
    rows,
    complete: total === rows.length,
    message: `${expectedFilter}售后（近3个月内）`,
  }
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
        amount: z.string().max(100).optional(),
      }),
    )
    .max(50),
  complete: z.boolean(),
  message: z.string().max(300),
})

export interface PddPagination {
  current: number
  hasNext: boolean
  hasPrevious: boolean
}
/** PGT selectors and disabled/active states were verified on the native six-page work-order list. */
export function readPddPagination(total: number, rowCount: number): PddPagination | null {
  const root = document.querySelector('#pdd-app-skeleton-main-content [class*="PGT_outerWrapper_"]')
  if (!root || !Number.isSafeInteger(total) || total < rowCount || rowCount < 0) return null
  const summary = root
    .querySelector('[class*="PGT_totalText_"]')
    ?.textContent?.match(/共有\s*(\d+)\s*条/)
  if (!summary || Number(summary[1]) !== total) return null
  const active = root.querySelectorAll('[class*="PGT_pagerItemActive_"]')
  const next = root.querySelector('[class*="PGT_next_"]'),
    prev = root.querySelector('[class*="PGT_prev_"]')
  if (active.length === 0)
    return !next && !prev && total === rowCount
      ? { current: 1, hasNext: false, hasPrevious: false }
      : null
  if (active.length !== 1 || !next || !prev) return null
  const current = Number(active[0].textContent?.trim())
  if (!Number.isSafeInteger(current) || current < 1 || current > 10000) return null
  const disabled = (element: Element) =>
    element.className.includes('PGT_disabled_') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.hasAttribute('disabled')
  if ((current === 1) !== disabled(prev)) return null
  return { current, hasNext: !disabled(next), hasPrevious: !disabled(prev) }
}

export function clickPddPage(
  direction: 'first' | 'next',
  expected: number,
  captcha?: () => boolean,
): void {
  if (captcha?.()) throw Error('platform_verification_required')
  const root = document.querySelector('#pdd-app-skeleton-main-content [class*="PGT_outerWrapper_"]')
  const active = root?.querySelectorAll('[class*="PGT_pagerItemActive_"]')
  if (active?.length !== 1 || Number(active[0].textContent?.trim()) !== expected)
    throw Error('平台页码已改变')
  const target =
    direction === 'first'
      ? Array.from(root?.querySelectorAll('[class*="PGT_pagerItem_"]') ?? []).find(
          (node) => node.textContent?.trim() === '1',
        )
      : root?.querySelector('[class*="PGT_next_"]')
  if (
    !target ||
    target.className.includes('PGT_disabled_') ||
    target.getAttribute('aria-disabled') === 'true' ||
    target.hasAttribute('disabled')
  )
    throw Error('平台翻页入口不可用')
  if (direction === 'first' && expected === 1) throw Error('已经位于第一页')
  ;(target as HTMLElement).click()
}

export const pddPaginationSchema = z
  .object({
    current: z.number().int().min(1).max(10000),
    hasNext: z.boolean(),
    hasPrevious: z.boolean(),
  })
  .nullable()

/** Native 查看详情 navigation verified as /aftersales-ssr/detail?id=...&orderSn=.... */
export function pddAfterSaleDetailId(input: string): string | undefined {
  try {
    const url = new URL(input)
    if (
      url.origin !== 'https://mms.pinduoduo.com' ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== '/aftersales-ssr/detail'
    )
      return undefined
    if (
      [...url.searchParams.keys()].some((key) => !['id', 'orderSn'].includes(key)) ||
      url.searchParams.getAll('id').length !== 1 ||
      url.searchParams.getAll('orderSn').length !== 1
    )
      return undefined
    const id = url.searchParams.get('id'),
      order = url.searchParams.get('orderSn')
    return id && /^[a-zA-Z0-9_-]{1,150}$/.test(id) && order && /^[0-9-]{6,100}$/.test(order)
      ? id
      : undefined
  } catch {
    return undefined
  }
}
export const pddDetailId = (kind: 'ticket' | 'aftersale', url: string) =>
  kind === 'ticket' ? pddTicketDetailId(url) : pddAfterSaleDetailId(url)
