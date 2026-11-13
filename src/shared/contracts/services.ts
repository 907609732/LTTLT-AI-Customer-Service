import { inject, type InjectionKey } from 'vue'
import type { CapabilityStatus } from '../ui/feedback'

export interface ShopSummary {
  id: string
  name: string
  platform: string
}
export interface AccountSummary {
  displayName: string
  authenticated: boolean
}
export interface Page<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}
export interface Capability {
  status: CapabilityStatus
  reason: string
}

/** 各模块只声明当前实际需要的查询。真实鉴权、支付和消息契约待后端确认。 */
export interface AppServices {
  account: { getSummary(): AccountSummary; login: Capability }
  shops: { list(): Page<ShopSummary>; connect: Capability }
  workbench: { getWelcome(): { title: string; desc: string; mode: string; offline: number } }
  reception: { save: Capability }
  knowledge: { train: Capability }
  quality: { submit: Capability }
  billing: { pay: Capability }
  settings: { sync: Capability }
  auxiliary: { reply: Capability }
}

export const servicesKey: InjectionKey<AppServices> = Symbol('AppServices')
export function useServices(): AppServices {
  const services = inject(servicesKey)
  if (!services) throw new Error('应用服务尚未装配，请通过应用入口或测试 provider 挂载组件')
  return services
}
