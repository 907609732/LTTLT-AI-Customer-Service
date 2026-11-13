/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface StoreWebWorkspaceDemo {
  stores: { stores: string; activeStoreId: string; visible: boolean }
  storeZoomCapture: string
  rows: Array<{ id: string; webPartition: string }>
  style: string
  styleSummary: string
}
export function createStoreWebWorkspaceDemo(): StoreWebWorkspaceDemo {
  return {
    stores: { stores: '', activeStoreId: '', visible: false },
    storeZoomCapture: '',
    rows: [],
    style: '',
    styleSummary: '',
  }
}
