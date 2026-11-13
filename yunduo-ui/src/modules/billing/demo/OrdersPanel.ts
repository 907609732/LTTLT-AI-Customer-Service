/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface OrdersPanelDemo {
  em: {
    remainingQuota: string
    totalQuota: string
    packageName: string
    plan: string
    expireAt: string
  }
  isLoading: boolean
  card: string
  currentPage: number
  pageSize: number
  summaryItem: string
  summary: string
  total: number
  data: string
  id: { id: number; status: string }
}
export function createOrdersPanelDemo(): OrdersPanelDemo {
  return {
    em: { remainingQuota: '', totalQuota: '', packageName: '', plan: '', expireAt: '' },
    isLoading: false,
    card: '',
    currentPage: 1,
    pageSize: 10,
    summaryItem: '',
    summary: '',
    total: 0,
    data: '',
    id: { id: 1, status: 'online' },
  }
}
