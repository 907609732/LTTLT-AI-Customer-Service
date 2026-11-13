/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopDeskPanelDemo {
  src: { name: string; icon: string }
  plat: string
  kpi: string
  kpiSummary: string
  emptyPreviewRowsA: Array<{ jump: string; key: string; label: string }>
}
export function createShopDeskPanelDemo(): ShopDeskPanelDemo {
  return {
    src: {
      name: '',
      icon: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    },
    plat: '',
    kpi: '',
    kpiSummary: '',
    emptyPreviewRowsA: [],
  }
}
