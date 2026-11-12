/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface GoodsListPanelDemo {
  disabled: number
  listPager__left: string
  listPager__leftSummary: string
  rows: Array<number | '…'>
  target: { code: string }
  emptyPreviewRowsA: Array<{ label: string; value: number }>
}
export function createGoodsListPanelDemo(): GoodsListPanelDemo {
  return {
    disabled: 0,
    listPager__left: '',
    listPager__leftSummary: '',
    rows: [],
    target: { code: '' },
    emptyPreviewRowsA: [],
  }
}
