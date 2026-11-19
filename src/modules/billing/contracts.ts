import { z } from 'zod'

/** 订单号/套餐号由服务端生成；只允许固定端点可安全拼接的字符集。 */
export const billingIdentifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const identifier = billingIdentifier
/** 官方扫码渠道。USDT、对公转账等未获批渠道不在此枚举内。 */
export const billingChannelSchema = z.enum(['alipay', 'wechat'])
export type BillingChannel = z.infer<typeof billingChannelSchema>
/** 服务端分开返回试用、有期限的付费和永久额度。 */
const quotaBucket = z.object({
  provenance: z.string().max(64).optional(),
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
})
export const billingPlanSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(128),
  currency: z.literal('cny'),
  amount: z.number().int().positive().max(100000000),
  // 划线原价只用于展示，支付金额仍以 amount 为准。
  list_amount: z.number().int().positive().max(100000000).optional(),
  calls: z.number().int().positive().max(1000000),
  valid_days: z.number().int().positive().max(365),
  permanent: z.boolean().optional(),
})
export const billingCatalogSchema = z.object({
  ready: z.boolean(),
  reason: z.string().max(128),
  plans: z.array(billingPlanSchema).max(20),
  // 旧服务端不含渠道/额度投影：缺省时仍按历史 stripe 与账号快照展示，不虚构渠道。
  channels: z
    .array(z.object({ id: billingChannelSchema, ready: z.boolean(), reason: z.string().max(256) }))
    .max(2)
    .optional(),
  quota: z
    .object({
      trial: quotaBucket,
      paid: quotaBucket,
      permanent: quotaBucket.optional(),
      remaining: z.number().int().nonnegative(),
    })
    .optional(),
  service: z
    .object({
      version: z.string().max(128),
      billing_protocol: z.literal(2),
      capabilities: z.array(z.string().max(64)).max(20),
    })
    .optional(),
})
/** closed 表示已关单，reconciling 表示渠道结果未确认；两者都不能再次付款。 */
export const billingOrderSchema = z.object({
  id: identifier,
  plan: billingPlanSchema,
  state: z.enum(['pending', 'paid', 'closed', 'reconciling']),
  channel: z.enum(['stripe', 'alipay', 'wechat']).optional(),
  credited_at: z.number().int().nonnegative().optional(),
  expires_at: z.number().int().nonnegative().optional(),
  created_at: z.number().int().nonnegative(),
  paid_at: z.number().int().nonnegative(),
})
export const billingOrdersSchema = z.object({ orders: z.array(billingOrderSchema).max(100) })
export function isBillingCheckoutURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.host === 'checkout.stripe.com' &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
export const billingCheckoutSchema = z.object({
  order: billingOrderSchema,
  checkout_url: z
    .string()
    .max(4096)
    .refine((value) => !value || isBillingCheckoutURL(value)),
  // 扫码渠道的二维码内容只在本机渲染成图片；客户端不会打开该串或上传到第三方。
  qr_code: z.string().max(4096).optional(),
  expires_at: z.number().int().nonnegative().optional(),
})
export type BillingPlan = z.infer<typeof billingPlanSchema>
export type BillingCatalog = z.infer<typeof billingCatalogSchema>
export type BillingOrder = z.infer<typeof billingOrderSchema>
export type BillingPayment = z.infer<typeof billingCheckoutSchema>
