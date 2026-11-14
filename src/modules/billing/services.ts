import type { InjectionKey } from 'vue'
import {
  billingCatalogSchema,
  billingCheckoutSchema,
  billingOrdersSchema,
  isBillingCheckoutURL,
} from './contracts'

/** 主进程实现受限认证请求。渲染层不接触 Bearer、供应商密钥或任意 URL 请求。 */
export interface BillingTransport {
  request(
    method: 'GET' | 'POST',
    path: '/api/client/billing' | '/api/client/billing/orders',
    body?: { plan_id: string; request_id: string },
  ): Promise<unknown>
  openCheckout(url: string): Promise<void>
}
export const billingTransportKey: InjectionKey<BillingTransport> = Symbol('billing-transport')
export function createBillingClient(transport: BillingTransport) {
  return {
    async catalog() {
      return billingCatalogSchema.parse(await transport.request('GET', '/api/client/billing'))
    },
    async orders() {
      return billingOrdersSchema.parse(await transport.request('GET', '/api/client/billing/orders'))
        .orders
    },
    async checkout(planId: string, requestId: string) {
      return billingCheckoutSchema.parse(
        await transport.request('POST', '/api/client/billing/orders', {
          plan_id: planId,
          request_id: requestId,
        }),
      )
    },
    async openCheckout(url: string) {
      if (!isBillingCheckoutURL(url)) throw new Error('支付地址未通过校验')
      await transport.openCheckout(url)
    },
  }
}
