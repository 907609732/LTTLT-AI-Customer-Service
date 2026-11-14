import { z } from 'zod'
import {
  orderRangeSchema,
  platformOrderSchema,
  type PlatformOrder,
} from '../src/shared/contracts/platform-orders'

export function parsePlatformMoney(input: string): number | null {
  const text = input.trim()
  if (!text || ['—', '-', '--', '未知', '暂无'].includes(text)) return null
  const match = /^(?:[¥￥]\s*)?((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{1,2}))?(?:\s*元)?$/.exec(text)
  if (!match) throw new Error('平台金额格式无法核实')
  const result =
    BigInt(match[1].replaceAll(',', '')) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('平台金额超过安全范围')
  return Number(result)
}
const timestamp = (input?: string): number | null => {
  if (!input?.trim() || ['—', '-', '--'].includes(input.trim())) return null
  const value = input.trim()
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(value)
  if (!match || !orderRangeSchema.safeParse({ from: match[1], to: match[1] }).success)
    throw new Error('平台订单时间无法核实')
  const [hour, minute, second = 0] = match[2].split(':').map(Number)
  if (hour > 23 || minute > 59 || second > 59) throw new Error('平台订单时间无法核实')
  const n = Date.parse(`${match[1]}T${match[2].length === 5 ? match[2] + ':00' : match[2]}+08:00`)
  if (!Number.isFinite(n)) throw new Error('平台订单时间无法核实')
  return n
}
const pageSchema = z.object({
  url: z.url(),
  platformStoreId: z.string().min(1).max(128),
  orderStatus: z.string(),
  aftersaleStatus: z.string(),
  range: orderRangeSchema,
  page: z.number().int().min(1).max(1000),
  total: z.number().int().nonnegative().nullable(),
  hasNext: z.boolean(),
  emptyConfirmed: z.boolean(),
  captcha: z.boolean(),
  headers: z.array(z.string()).min(1).max(30),
  blocks: z
    .array(
      z.object({
        id: z.string(),
        created: z.string().optional(),
        paid: z.string().optional(),
        cells: z.array(z.string()).max(30),
        refund: z.string().optional(),
      }),
    )
    .max(10000),
})
export type PddOrderPageInput = z.input<typeof pageSchema>
export interface PddOrderPage {
  platformStoreId: string
  range: z.infer<typeof orderRangeSchema>
  page: number
  total: number | null
  hasNext: boolean
  orders: PlatformOrder[]
}
export function parsePddOrderPage(input: unknown): PddOrderPage {
  const page = pageSchema.parse(input)
  const url = new URL(page.url)
  if (
    url.origin !== 'https://mms.pinduoduo.com' ||
    url.pathname !== '/orders/list' ||
    url.username ||
    url.password
  )
    throw new Error('订单页来源不正确')
  if (page.captcha) throw new Error('平台出现验证码，已停止读取')
  if (
    !['全部', '全部订单', '不限'].includes(page.orderStatus) ||
    !['全部', '不限', '全部售后'].includes(page.aftersaleStatus)
  )
    throw new Error('订单筛选不是所声明的全部范围')
  const indexes = {
    title: page.headers.findIndex((h) => h === '商品信息'),
    status: page.headers.findIndex((h) => h === '订单/售后状态'),
    quantity: page.headers.findIndex((h) => h === '数量'),
    goods: page.headers.findIndex((h) => /商品总价/.test(h)),
    received: page.headers.findIndex((h) => /实收金额/.test(h)),
    buyer: page.headers.findIndex((h) => h === '买家'),
  }
  if (Object.values(indexes).some((i) => i < 0)) throw new Error('平台订单表头变化，已停止读取')
  if (!page.blocks.length && (!page.emptyConfirmed || page.total !== 0 || page.hasNext))
    throw new Error('尚未确认平台订单空结果')
  const seen = new Set<string>()
  const orders = page.blocks.map((block) => {
    if (seen.has(block.id)) throw new Error('同页订单重复，不能确认完整性')
    seen.add(block.id)
    const get = (key: keyof typeof indexes) => block.cells[indexes[key]]?.trim() ?? ''
    const rawStatus = get('status')
    let status: PlatformOrder['status'] = 'other'
    if (/退款成功|已退款/.test(rawStatus)) status = 'refunded'
    else if (/退款中|售后处理中/.test(rawStatus)) status = 'refunding'
    else if (/待付款|未付款|待支付/.test(rawStatus)) status = 'unpaid'
    else if (/已关闭|已取消/.test(rawStatus)) status = 'closed'
    else if (/已完成|交易成功|已签收/.test(rawStatus)) status = 'completed'
    else if (/已发货|待收货/.test(rawStatus)) status = 'shipped'
    else if (/待发货|待成团/.test(rawStatus)) status = 'unshipped'
    const quantity = Number(get('quantity'))
    return platformOrderSchema.parse({
      id: block.id,
      title: get('title'),
      quantity,
      status,
      rawStatus,
      createdAt: timestamp(block.created),
      paidAt: timestamp(block.paid),
      goodsAmountCents: parsePlatformMoney(get('goods')),
      receivedCents: parsePlatformMoney(get('received')),
      refundedCents: block.refund === undefined ? null : parsePlatformMoney(block.refund),
      buyerHint: get('buyer').slice(0, 100),
      source: 'pdd-native-page',
    })
  })
  if (page.total !== null && page.total < orders.length) throw new Error('平台订单总数与列表不符')
  return {
    platformStoreId: page.platformStoreId,
    range: page.range,
    page: page.page,
    total: page.total,
    hasNext: page.hasNext,
    orders,
  }
}
