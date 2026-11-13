/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface WelcomeSettingsDemo {
  isTemplate: boolean
  modelValue: string
  panel__bar: string
  isDisabled: boolean
  div: number
  templateItems: Array<{ type: string; text: string; url: string; src: string }>
}
export function createWelcomeSettingsDemo(): WelcomeSettingsDemo {
  return {
    isTemplate: false,
    modelValue: '',
    panel__bar: '',
    isDisabled: false,
    div: 0,
    templateItems: [],
  }
}
