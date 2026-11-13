/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface CookieLoginDialogDemo {
  template: string
  modelValue: string
  isModelValue: boolean
  modelValueState: string
  cookieLoginHeader: string
}
export function createCookieLoginDialogDemo(): CookieLoginDialogDemo {
  return {
    template: '',
    modelValue: 'chat',
    isModelValue: false,
    modelValueState: '',
    cookieLoginHeader: '',
  }
}
