/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface TrainingCorrectModalDemo {
  tcInput: string
  tcTextarea: string
  tcChipItems: Array<string>
  tcChipInput: string
  button: string
  templateItems: Array<{ id: string; name: string }>
  tcInputState: string
  isTemplate: boolean
  tcPack: string
  isDisabled: boolean
  isDisabledState: boolean
  tcChipTcGoods__chip: Array<{ name: string; type: string; storeName: string; storeId: string }>
  isTemplateState: boolean
  tcGoods__search: string
  templateItemsState: Array<{ name: string }>
  isTemplateStateDetail: boolean
  template: string
  buttonState: string
  buttonStateDetail: string
  tcField: string
  isTcPack: boolean
  templateState: string
  isTemplateSummary: string
  isDiv: boolean
  disabledItems: Array<{ id: string; name: string }>
  isTcPackSummary: boolean
  isTcField: boolean
  tcFieldSummary: string
  isDisabledSummary: boolean
}
export function createTrainingCorrectModalDemo(): TrainingCorrectModalDemo {
  return {
    tcInput: '',
    tcTextarea: '',
    tcChipItems: [],
    tcChipInput: '',
    button: 'store',
    templateItems: [],
    tcInputState: '',
    isTemplate: false,
    tcPack: '',
    isDisabled: false,
    isDisabledState: false,
    tcChipTcGoods__chip: [],
    isTemplateState: false,
    tcGoods__search: '',
    templateItemsState: [],
    isTemplateStateDetail: false,
    template: '',
    buttonState: 'new',
    buttonStateDetail: '',
    tcField: '',
    isTcPack: false,
    templateState: '',
    isTemplateSummary: '',
    isDiv: false,
    disabledItems: [],
    isTcPackSummary: false,
    isTcField: false,
    tcFieldSummary: '',
    isDisabledSummary: false,
  }
}
