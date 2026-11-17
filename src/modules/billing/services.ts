import type { InjectionKey } from 'vue'
import {
  billingCatalogSchema,
  billingCheckoutSchema,
  billingOrdersSchema,
  isBillingCheckoutURL,
  billingIdentifier,
  billingChannelSchema,
  type BillingChannel,
} from './contracts'

/** 主进程实现受限认证请求。渲染层不接触 Bearer、供应商密钥或任意 URL 请求。 */
export interface BillingTransport {
  request(
    method: 'GET' | 'POST',
    path:
      | '/api/client/billing'
      | '/api/client/billing/orders'
      | `/api/client/billing/orders/${string}`,
    body?: { plan_id: string; request_id: string; channel?: BillingChannel },
  ): Promise<unknown>
  openCheckout(url: string): Promise<void>
}

export const billingTransportKey: InjectionKey<BillingTransport> = Symbol('billing-transport')

export function createBillingClient(transport: BillingTransport) {
  return {
    async catalog() {
      const result = billingCatalogSchema.safeParse(
        await transport.request('GET', '/api/client/billing'),
      )
      if (!result.success)
        throw Object.assign(new Error('Invalid billing catalog'), { code: 'invalid_response' })
      return result.data
    },
    async orders() {
      const result = billingOrdersSchema.safeParse(
        await transport.request('GET', '/api/client/billing/orders'),
      )
      if (!result.success)
        throw Object.assign(new Error('Invalid billing orders'), { code: 'invalid_response' })
      return result.data.orders
    },
    async checkout(planId: string, requestId: string, channel?: BillingChannel) {
      // 订单号与请求号会进入受白名单限制的端点拼接，先按同一字符集核对。
      billingIdentifier.parse(planId)
      billingIdentifier.parse(requestId)
      if (channel) billingChannelSchema.parse(channel)
      const result = billingCheckoutSchema.safeParse(
        await transport.request('POST', '/api/client/billing/orders', {
          plan_id: planId,
          request_id: requestId,
          ...(channel ? { channel } : {}),
        }),
      )
      if (!result.success)
        throw Object.assign(new Error('Invalid billing checkout'), { code: 'invalid_response' })
      return result.data
    },
    async order(id: string) {
      billingIdentifier.parse(id)
      const result = billingCheckoutSchema.safeParse(
        await transport.request('GET', `/api/client/billing/orders/${id}`),
      )
      if (!result.success)
        throw Object.assign(new Error('Invalid billing order'), { code: 'invalid_response' })
      return result.data
    },
    async close(id: string) {
      billingIdentifier.parse(id)
      const result = billingCheckoutSchema.safeParse(
        await transport.request('POST', `/api/client/billing/orders/${id}/close`),
      )
      if (!result.success)
        throw Object.assign(new Error('Invalid billing close'), { code: 'invalid_response' })
      return result.data
    },
    async openCheckout(url: string) {
      if (!isBillingCheckoutURL(url)) throw new Error('支付地址未通过校验')
      await transport.openCheckout(url)
    },
  }
}
