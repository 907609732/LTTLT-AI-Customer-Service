/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface HubTabBarDemo {
  rows: Array<{ id: string; name: string }>
  isModelValue: string
  hubLevelHubLevel_2Items: Array<{ id: string; name: string }>
  modelValue: string
  hubLevelHubLevel_3Items: Array<{ id: string; title: string }>
  modelValueState: string
}
export function createHubTabBarDemo(): HubTabBarDemo {
  return {
    rows: [],
    isModelValue: '',
    hubLevelHubLevel_2Items: [],
    modelValue: '',
    hubLevelHubLevel_3Items: [],
    modelValueState: '',
  }
}
