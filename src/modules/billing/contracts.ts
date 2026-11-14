import { z } from 'zod'

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const billingPlanSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(128),
  currency: z.literal('cny'),
  amount: z.number().int().positive().max(100000000),
  calls: z.number().int().positive().max(1000000),
  valid_days: z.number().int().positive().max(365),
})
export const billingCatalogSchema = z.object({
  ready: z.boolean(),
  reason: z.string().max(128),
  plans: z.array(billingPlanSchema).max(20),
  service: z
    .object({
      version: z.string().max(128),
      billing_protocol: z.literal(2),
      capabilities: z.array(z.string().max(64)).max(20),
    })
    .optional(),
})
export const billingOrderSchema = z.object({
  id: identifier,
  plan: billingPlanSchema,
  state: z.enum(['pending', 'paid']),
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
})
export type BillingPlan = z.infer<typeof billingPlanSchema>
export type BillingCatalog = z.infer<typeof billingCatalogSchema>
export type BillingOrder = z.infer<typeof billingOrderSchema>
