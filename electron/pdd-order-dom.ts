import type { OrderRange } from '../src/shared/contracts/platform-orders'
import type { PddOrderPageInput } from './platform-order-parser'

/** Self-contained read function serialized into our same-origin merchant page. No address cells leave it. */
export function readPddOrderDom(input: {
  range: OrderRange
  platformStoreId: string
  url?: string
  previousOrderIds?: readonly string[]
}): PddOrderPageInput {
  const url = input.url ?? location.href
  const source = new URL(url)
  if (source.origin !== 'https://mms.pinduoduo.com' || source.pathname !== '/orders/list')
    throw Error('订单页来源变化')
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  if (!root) throw Error('订单列表尚未就绪')
  const text = (element: Element | null) =>
    ((element as HTMLElement | null)?.innerText ?? element?.textContent ?? '').trim()
  const body = text(root)
  const field = (label: string) => {
    const exact = Array.from(root.querySelectorAll('*')).filter(
      (e) =>
        Array.from(e.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join('')
          .trim()
          .replace(/[:：]$/, '') === label,
    )
    for (const leaf of exact) {
      let parent: Element | null = leaf
      for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
        const inputs = Array.from(parent.querySelectorAll('input')).filter(
          (e) => e.type !== 'hidden',
        )
        if (inputs.length === 1) return inputs[0].value.trim()
        if (inputs.length > 1) break
      }
    }
    return ''
  }
  const orderStatus = field('订单状态'),
    aftersaleStatus = field('售后状态')
  if (
    !['全部', '全部订单', '不限'].includes(orderStatus) ||
    !['全部', '全部售后', '不限'].includes(aftersaleStatus)
  )
    throw Error('订单筛选范围尚未核对为全部')
  const expectedDate = `${input.range.from} 00:00:00 ~ ${input.range.to} 23:59:59`
  if (
    Array.from(root.querySelectorAll('input')).some(
      (e) => !e.readOnly && !['checkbox', 'hidden'].includes(e.type) && e.value.trim(),
    )
  )
    throw Error('订单包含额外筛选条件，不能声明全部订单')
  const dateLabel = input.range.timeField === 'created' ? '订单下单时间' : '订单支付时间'
  if (
    !body.includes(dateLabel) ||
    !Array.from(root.querySelectorAll('input')).some((e) => e.value.trim() === expectedDate)
  )
    throw Error('平台查询日期或时间口径与所选范围不一致，请在订单后台核对')
  const summary = body.match(/共查询到\s*(\d+)\s*个订单/),
    counter = body.match(/共有\s*(\d+)\s*条/)
  if (!summary || !counter || summary[1] !== counter[1]) throw Error('订单总数尚未核对')
  const total = Number(summary[1])
  if (!Number.isSafeInteger(total)) throw Error('订单总数无效')
  const headerRow = Array.from(root.querySelectorAll('tr')).find(
    (row) => text(row).includes('商品信息') && text(row).includes('实收金额'),
  )
  const headers = Array.from(headerRow?.querySelectorAll('th,td') ?? []).map(text)
  if (!headers.includes('商品信息') || !headers.includes('买家'))
    throw Error('订单表头变化，尚未识别')
  const privateColumn = headers.findIndex((h) => h === '收货信息')
  const tables = Array.from(root.querySelectorAll('table')).filter(
    (table) =>
      /订单编号\s*[:：]\s*\d{6}-\d{15}/.test(text(table)) &&
      !Array.from(table.querySelectorAll('table')).some((child) =>
        /订单编号\s*[:：]/.test(text(child)),
      ),
  )
  const blocks = tables.map((table) => {
    const tableText = text(table),
      id = tableText.match(/订单编号\s*[:：]\s*(\d{6}-\d{15})/)?.[1]
    const rows = Array.from(table.querySelectorAll('tr')).filter((row) => {
      const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>(':scope > td'))
      return (
        cells.length > 3 &&
        cells.reduce((count, cell) => count + cell.colSpan, 0) === headers.length
      )
    })
    if (!id || rows.length !== 1) throw Error('订单商品行结构变化，不能合并未知金额')
    const cells: string[] = []
    for (const cell of Array.from(rows[0].querySelectorAll<HTMLTableCellElement>(':scope > td'))) {
      // The real merchant table merges the checkbox/product columns with colspan=2.
      for (let span = 1; span < cell.colSpan; span++) cells.push('')
      cells.push(cells.length === privateColumn ? '' : text(cell))
    }
    const buyerIndex = headers.indexOf('买家')
    cells[buyerIndex] = cells[buyerIndex]
      .replace(/发起聊天[\s\S]*$/, '')
      .trim()
      .slice(0, 100)
    // The native row exposes 成交时间. Its relation to created/paid is not asserted here.
    return { id, cells }
  })
  if (
    input.previousOrderIds?.length &&
    blocks.length === input.previousOrderIds.length &&
    blocks.every((block, index) => block.id === input.previousOrderIds![index])
  )
    throw Error('订单行尚未切换，等待原生列表完成渲染')
  const selectedPage = Array.from(
    root.querySelectorAll(
      '[class*="PGT_pagerItemActive_"], [aria-current="page"], [class*="pagination"] [class*="active"], [class*="Pagination"] [class*="active"], [class*="Pagination"] [class*="selected"]',
    ),
  )
    .map(text)
    .find((t) => /^\d+$/.test(t))
  const page = selectedPage ? Number(selectedPage) : 1
  const next =
    root.querySelector('[class*="PGT_next_"]') ??
    Array.from(root.querySelectorAll('button,a,li,[role="button"]')).find(
      (e) =>
        e.getAttribute('title') === '下一页' ||
        e.getAttribute('aria-label') === '下一页' ||
        text(e) === '下一页',
    )
  const disabled =
    next &&
    (next.hasAttribute('disabled') ||
      next.getAttribute('aria-disabled') === 'true' ||
      /disabled/i.test(next.className) ||
      Boolean(next.querySelector('[disabled]')))
  if (total > blocks.length && !next) throw Error('订单下一页入口尚未识别')
  const hasNext = next ? !disabled : false
  return {
    url,
    platformStoreId: input.platformStoreId,
    range: input.range,
    orderStatus,
    aftersaleStatus,
    page,
    total,
    hasNext,
    emptyConfirmed: total === 0 && /暂无订单|没有查询到|无相关订单/.test(body),
    captcha: /请向右滑块完成拼图|请完成安全验证|滑动验证/.test(body),
    headers,
    blocks,
  }
}

/** Native form interactions only. The caller must verify displayed filters after the resulting query. */
export async function preparePddOrderQuery(input: {
  range: OrderRange
  stage: 'all' | 'date' | 'query' | 'next'
}): Promise<void> {
  const root = document.querySelector('#pdd-app-skeleton-main-content')
  if (
    !root ||
    location.origin !== 'https://mms.pinduoduo.com' ||
    location.pathname !== '/orders/list'
  )
    throw Error('订单页面来源不正确')
  const text = (e: Element) => ((e as HTMLElement).innerText ?? e.textContent ?? '').trim()
  if (input.stage === 'all') {
    const reset = Array.from(root.querySelectorAll('button')).find((e) => text(e) === '重置')
    if (!reset) throw Error('订单原生重置入口尚未识别')
    reset.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const tab = Array.from(root.querySelectorAll('button,a,[role="tab"],div,span')).find(
      (e) => e.children.length < 2 && /^全部订单\s*[（(]近3个月[）)]$/.test(text(e)),
    ) as HTMLElement | undefined
    if (!tab) throw Error('全部订单原生入口尚未识别')
    tab.click()
  } else if (input.stage === 'date') {
    const expected = `${input.range.from} 00:00:00 ~ ${input.range.to} 23:59:59`
    const field = Array.from(root.querySelectorAll('input')).find((e) =>
      /^\d{4}-\d{2}-\d{2}.*\s~\s/.test(e.value),
    )
    if (!field) throw Error('订单日期筛选尚未识别')
    if (field.value === expected) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (field.readOnly || !setter) {
      field.click()
      throw Error(
        '请在已打开的原生订单日期选择器设置起止日期，再次读取；不会用默认近90日冒充所选日期',
      )
    }
    setter.call(field, expected)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    field.blur()
  } else {
    const button =
      (input.stage === 'next' ? root.querySelector('[class*="PGT_next_"]') : undefined) ??
      Array.from(root.querySelectorAll('button,a,li,[role="button"]')).find((e) =>
        input.stage === 'query'
          ? text(e) === '查询'
          : e.getAttribute('title') === '下一页' ||
            e.getAttribute('aria-label') === '下一页' ||
            text(e) === '下一页',
      )
    if (
      !button ||
      button.hasAttribute('disabled') ||
      button.getAttribute('aria-disabled') === 'true' ||
      /disabled/i.test(button.className)
    )
      throw Error('订单查询或分页入口未就绪')
    ;(button as HTMLElement).click()
  }
}
