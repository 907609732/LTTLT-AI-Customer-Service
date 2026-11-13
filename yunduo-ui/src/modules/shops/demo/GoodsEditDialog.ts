/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface GoodsEditDialogDemo {
  geHead: string
  value: string
  isGeEditor: boolean
  span: string
}
export function createGoodsEditDialogDemo(): GoodsEditDialogDemo {
  return { geHead: '', value: '', isGeEditor: false, span: '' }
}
