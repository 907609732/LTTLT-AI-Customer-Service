/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface UsagePanelDemo {
  modelValue: string
  modelValueState: string
  currentPage: number
  pageSize: number
  total: number
  dataItems: Array<string>
  elTable: string
  isTemplate: boolean
  rows: Array<{ label: string; value: string }>
}
export function createUsagePanelDemo(): UsagePanelDemo {
  return {
    modelValue: 'all',
    modelValueState: 'all',
    currentPage: 1,
    pageSize: 10,
    total: 0,
    dataItems: [],
    elTable: '',
    isTemplate: false,
    rows: [],
  }
}
