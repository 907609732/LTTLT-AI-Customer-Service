/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface BackendHubViewDemo {
  tabs: Array<string>
  activeId: string
  isOpeningAll: boolean
}
export function createBackendHubViewDemo(): BackendHubViewDemo {
  return { tabs: [], activeId: '', isOpeningAll: false }
}
