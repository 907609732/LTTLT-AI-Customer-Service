/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopTrainingPanelDemo {
  trComposer__input: string
  isTemplate: boolean
  isTemplateState: boolean
  name: { name: string; id: string; price: string }
  button: string
  isTemplateStateDetail: boolean
  trInput: string
  templateItems: Array<{ name: string; storeId: string }>
  isTemplateStateDetailDetail: boolean
  message: string
  trGroupItems: Array<{
    label: string
    items: Array<{
      active: boolean
      draft: string
      id: string
      title: string
      store: string
      rounds: string
      corrected: string
      open: string
    }>
    storeId: string
  }>
  item: { item: string; open: boolean; x: string; y: string }
  isTemplateStateDetailDetailDetail: boolean
  trInputTrFix__kw: string
  disabledItems: Array<{ name: string; storeName: string; code: string; storeId: string }>
  isTemplateStateDetailDetailDetailDetail: boolean
  template: string
  trFix__store: string
  isTemplateSummary: string
  isDefaultItems: {
    isDefault: boolean
    goods: Array<{ type: string; storeName: string; storeId: string; name: string }>
  }
  trFix__bar: string
  disabled: boolean
  templateState: string
  trItem__rename: string
  length: { length: string }
  trSide__hd: { length: string }
  disabledPreview: { cls: string; short: string }
  isDisabled: boolean
  span: string
  isTemplatePreview: boolean
  isDisabledPreview: boolean
  rows: Array<{ id: string; name: string; online: string; storeId: string }>
  buttonPreview: string
  trCapsule__icon: string
  isTemplatePreviewDetail: boolean
  rowsPreview: Array<{
    role: string
    text: string
    status: string
    error: string
    corrected: { mode: string; intentName: string; packName: string; text: string }
    pictures: Array<string>
    videos: Array<string>
    isTransfer: boolean
    hitIntents: Array<{ name: string; id: string }>
    kbSceneHit: string
    storeId: string
  }>
  goods: string
  isCorrectScope: boolean
}
export function createShopTrainingPanelDemo(): ShopTrainingPanelDemo {
  return {
    trComposer__input: '',
    isTemplate: false,
    isTemplateState: false,
    name: { name: '', id: '', price: '' },
    button: 'none',
    isTemplateStateDetail: false,
    trInput: '',
    templateItems: [],
    isTemplateStateDetailDetail: false,
    message: '',
    trGroupItems: [],
    item: { item: '', open: false, x: '', y: '' },
    isTemplateStateDetailDetailDetail: false,
    trInputTrFix__kw: '',
    disabledItems: [],
    isTemplateStateDetailDetailDetailDetail: false,
    template: '',
    trFix__store: '',
    isTemplateSummary: '',
    isDefaultItems: { isDefault: false, goods: [] },
    trFix__bar: '',
    disabled: false,
    templateState: '',
    trItem__rename: '',
    length: { length: '' },
    trSide__hd: { length: '' },
    disabledPreview: { cls: '', short: '' },
    isDisabled: false,
    span: '',
    isTemplatePreview: false,
    isDisabledPreview: false,
    rows: [],
    buttonPreview: '',
    trCapsule__icon: '',
    isTemplatePreviewDetail: false,
    rowsPreview: [],
    goods: '',
    isCorrectScope: false,
  }
}
