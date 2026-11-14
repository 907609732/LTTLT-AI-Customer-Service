import { z } from 'zod'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00Z')
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, '日期无效')
export const orderRangeSchema = z
  .object({
    from: date,
    to: date,
    timezone: z.literal('Asia/Shanghai').default('Asia/Shanghai'),
    timeField: z.enum(['created', 'paid']).default('created'),
    status: z.literal('all').default('all'),
  })
  .strict()
  .refine((range) => {
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000
    return days >= 0 && days < 90
  }, '订单范围必须按日期先后选择，最多90个自然日')
export type OrderRange = z.infer<typeof orderRangeSchema>
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
export const platformOrderSchema = z
  .object({
    id: z.string().regex(/^\d{6}-\d{15}$/),
    title: z.string().max(2000),
    quantity: z.number().int().positive().max(100000),
    status: z.enum([
      'unpaid',
      'unshipped',
      'shipped',
      'completed',
      'closed',
      'refunding',
      'refunded',
      'other',
    ]),
    rawStatus: z.string().max(500),
    createdAt: z.number().int().nonnegative().nullable(),
    paidAt: z.number().int().nonnegative().nullable(),
    goodsAmountCents: cents,
    receivedCents: cents,
    refundedCents: cents,
    buyerHint: z.string().max(100).default(''),
    source: z.enum(['pdd-native-page', 'csv-import']).default('pdd-native-page'),
  })
  .strict()
export type PlatformOrder = z.infer<typeof platformOrderSchema>
export function summarizeOrders(orders: PlatformOrder[]) {
  const sum = (key: 'receivedCents' | 'refundedCents') => {
    if (orders.some((row) => row[key] === null)) return null
    const total = orders.reduce((n, row) => n + BigInt(row[key] ?? 0), 0n)
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额汇总超过安全范围')
    return Number(total)
  }
  return {
    orders: orders.length,
    receivedCents: sum('receivedCents'),
    refundedCents: sum('refundedCents'),
    unknownReceived: orders.filter((row) => row.receivedCents === null).length,
    unknownRefunds: orders.filter((row) => row.refundedCents === null).length,
  }
}
export const orderReportSchema = z
  .object({
    storeId: z.string().min(1).max(128),
    platformStoreId: z.string().min(1).max(128),
    range: orderRangeSchema,
    capturedAt: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
    complete: z.boolean(),
    source: z.enum(['pdd-native-page', 'csv-import']),
    receivedLabel: z.string().max(100),
    records: z.array(platformOrderSchema).max(10000),
  })
  .strict()
export type PlatformOrderReport = z.infer<typeof orderReportSchema>
export const orderTaskSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().min(1).max(128),
    range: orderRangeSchema,
    state: z.enum(['reading', 'paused', 'complete', 'failed', 'cancelled']),
    pages: z.number().int().nonnegative(),
    records: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
    error: z.string().max(500),
    startedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
export type PlatformOrderTask = z.infer<typeof orderTaskSchema>
export interface PlatformOrderSnapshot {
  workspaceId: string
  storeId: string
  report: PlatformOrderReport | null
  task: PlatformOrderTask | null
}
export const platformOrderSnapshotSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().min(1).max(128),
    report: orderReportSchema.nullable(),
    task: orderTaskSchema.nullable(),
  })
  .strict()
export const orderRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('snapshot'),
      workspaceId: z.string().uuid(),
      storeId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal('read'),
      workspaceId: z.string().uuid(),
      storeId: z.string().min(1).max(128),
      range: orderRangeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('cancel'),
      workspaceId: z.string().uuid(),
      storeId: z.string().min(1).max(128),
      taskId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal('import'),
      workspaceId: z.string().uuid(),
      storeId: z.string().min(1).max(128),
      range: orderRangeSchema,
      csv: z.string().max(8 * 1024 * 1024),
      confirmed: z.literal(true),
    })
    .strict(),
])
export type PlatformOrderRequest = z.infer<typeof orderRequestSchema>
export interface PlatformOrderTransport {
  request(input: PlatformOrderRequest): Promise<PlatformOrderSnapshot>
}
