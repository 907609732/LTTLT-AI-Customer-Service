/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface QuickReplyDialogDemo {
  qrBody: string
  modelValue: string
  button: string
  rows: Array<{ id: string; name: string }>
  template: string
  modelValueState: string
  select: string
  rowsSummary: Array<{ id: string; name: string; count: number }>
  qrItemItems: Array<{ id: string; text: string }>
  maxlength: number
}
export function createQuickReplyDialogDemo(): QuickReplyDialogDemo {
  return {
    qrBody: '',
    modelValue: '',
    button: 'all',
    rows: [],
    template: '',
    modelValueState: '',
    select: '',
    rowsSummary: [],
    qrItemItems: [],
    maxlength: 0,
  }
}
