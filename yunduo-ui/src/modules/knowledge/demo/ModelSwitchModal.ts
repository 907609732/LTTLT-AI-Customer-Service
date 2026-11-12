/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ModelSwitchModalDemo {
  isMsMask: boolean
  rows: Array<{ id: string; locked: string; name: string; tip: string }>
  modeId: { modeId: string; llmId: string }
  isTemplate: boolean
  msPromoCard: { one: string; highlights: Array<{ tag: string; text: string }> }
  msContactLink: string
  isTemplatePreview: boolean
  preset: { preset: string; lenMin: string; lenMax: string }
  rowsPreview: Array<{ id: string; icon: string; name: string; tip: string }>
  msToast: string
  msToastPreview: string
  link: { link: string }
  rowsState: Array<{ id: string; name: string; tip: string }>
  min: number
  max: number
}
export function createModelSwitchModalDemo(): ModelSwitchModalDemo {
  return {
    isMsMask: false,
    rows: [],
    modeId: { modeId: '', llmId: '' },
    isTemplate: false,
    msPromoCard: { one: '', highlights: [] },
    msContactLink: '',
    isTemplatePreview: false,
    preset: { preset: '', lenMin: '', lenMax: '' },
    rowsPreview: [],
    msToast: '',
    msToastPreview: '',
    link: { link: '' },
    rowsState: [],
    min: 0,
    max: 0,
  }
}
