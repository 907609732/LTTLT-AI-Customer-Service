/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopsListPanelDemo {
  select: string
  selectState: string
  input: string
  button: string
  listPager__size: number
  rows: Array<{ name: string }>
  displayText: string
  displayTextSummary: string
  panel__bar: { length: string }
  rowsSummary: {
    rows: Array<{ online: string; id: string; name: string }>
    total: number
    page: number
    pages: number
  }
}
export function createShopsListPanelDemo(): ShopsListPanelDemo {
  return {
    select: 'all',
    selectState: 'all',
    input: '',
    button: 'all',
    listPager__size: 10,
    rows: [],
    displayText: '',
    displayTextSummary: '',
    panel__bar: { length: '' },
    rowsSummary: { rows: [], total: 0, page: 0, pages: 0 },
  }
}
