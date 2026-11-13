/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface LoginViewDemo {
  button: string
  isLoading: boolean
  disabled: number
  modelValue: boolean
  mobile: { mobile: string; code: string; password: string }
  loginFormPanel: string
  alt: { name: string }
}
export function createLoginViewDemo(): LoginViewDemo {
  return {
    button: 'code',
    isLoading: false,
    disabled: 0,
    modelValue: false,
    mobile: { mobile: '', code: '', password: '' },
    loginFormPanel: '全平台消息聚合 · AI 智能辅助值守',
    alt: { name: '' },
  }
}
