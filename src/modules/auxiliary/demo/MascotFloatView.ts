/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface MascotFloatViewDemo {
  div: string
  button: string
  isDiv: boolean
  title: string
  buttonState: string
  isTemplate: boolean
  style: number
  styleState: number
  isDivSummary: boolean
  divSummary: string
  isTemplateSummary: boolean
  src: string
}
export function createMascotFloatViewDemo(): MascotFloatViewDemo {
  return {
    div: '',
    button: 'consult',
    isDiv: false,
    title: '',
    buttonState: 'all',
    isTemplate: false,
    style: 0,
    styleState: 0,
    isDivSummary: false,
    divSummary: '',
    isTemplateSummary: false,
    src: '',
  }
}
