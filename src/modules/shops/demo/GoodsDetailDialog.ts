/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface GoodsDetailDialogDemo {
  displayText: string
}
export function createGoodsDetailDialogDemo(): GoodsDetailDialogDemo {
  return { displayText: '' }
}
