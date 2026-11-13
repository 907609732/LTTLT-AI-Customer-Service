/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface RuntimeDownloadToastDemo {
  span: string
  isTemplate: boolean
  style: string
  isTemplateSummary: boolean
  runtimeDownloadToast__body: string
  displayText: string
}
export function createRuntimeDownloadToastDemo(): RuntimeDownloadToastDemo {
  return {
    span: '',
    isTemplate: false,
    style: '',
    isTemplateSummary: false,
    runtimeDownloadToast__body: '',
    displayText: '',
  }
}
