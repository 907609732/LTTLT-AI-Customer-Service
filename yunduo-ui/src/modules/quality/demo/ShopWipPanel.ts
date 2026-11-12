/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopWipPanelDemo {
  shopHomePanel: { title: string; subtitle: string; headline: string; desc: string }
}
export function createShopWipPanelDemo(): ShopWipPanelDemo {
  return {
    shopHomePanel: { title: '', subtitle: '这里是示例文案', headline: '', desc: '这里是示例文案' },
  }
}
