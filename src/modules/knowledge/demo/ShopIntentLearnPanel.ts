/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopIntentLearnPanelDemo {
  shopHomePanel: { title: string; desc: string }
}
export function createShopIntentLearnPanelDemo(): ShopIntentLearnPanelDemo {
  return { shopHomePanel: { title: '', desc: '这里是示例文案' } }
}
