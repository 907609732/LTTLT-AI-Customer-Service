import { z } from 'zod'

/** Closed routes: this bridge cannot call authentication, administration or arbitrary URLs. */
export const managedBusinessPayloadSchema = z
  .object({
    endpoint: z.string().max(160),
    method: z.enum(['GET', 'POST']).default('GET'),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const read =
      value.method === 'GET' &&
      (['/billing', '/billing/orders', '/teams'].includes(value.endpoint) ||
        /^\/teams\/[1-9]\d{0,9}$/.test(value.endpoint))
    const write =
      value.method === 'POST' &&
      (['/billing/orders', '/teams'].includes(value.endpoint) ||
        /^\/teams\/[1-9]\d{0,9}\/(?:accept|actions)$/.test(value.endpoint))
    if (!read && !write) ctx.addIssue({ code: 'custom', message: '不允许的团队或计费操作' })
    if (value.method === 'GET' && value.body !== undefined)
      ctx.addIssue({ code: 'custom', message: '读取请求不接受正文' })
    if (
      value.body !== undefined &&
      new TextEncoder().encode(JSON.stringify(value.body)).byteLength > 128 * 1024
    )
      ctx.addIssue({ code: 'custom', message: '业务请求超过大小限制' })
  })
export const managedBusinessRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    request: managedBusinessPayloadSchema,
  })
  .strict()
export type ManagedBusinessRequest = z.infer<typeof managedBusinessRequestSchema>

export const managedCheckoutRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    url: z
      .string()
      .max(4096)
      .refine((value) => {
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
      }),
  })
  .strict()
