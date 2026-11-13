/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopAiCustomPanelDemo {
  modelValueItems: string
  modelValueItemsState: string
  rows: {
    hot: Array<{ id: string; tip: string; short: string; name: string }>
    more: Array<{ id: string; tip: string; short: string; name: string }>
  }
  placeholder: string
  empty: string
  unboundDot: string
  isAicustom: boolean
  isBtn: boolean
  rowsPreview: Array<{ id: string; name: string; desc: string }>
  div: string
  button: string
  length: string
  maxlength: number
  isCount: boolean
  panel__bar: string
  input: { trim: string }
  isModelValue: string
  rowsPreviewDetail: Array<{ name: string }>
  isButton: boolean
  templateItems: Array<{ name: string; count: number }>
  buttonPreview: string
  rowsPreviewDetailDetail: Array<{ name: string }>
  label: string
  isLabel: boolean
  isActiveId: boolean
  packs: string
}
export function createShopAiCustomPanelDemo(): ShopAiCustomPanelDemo {
  return {
    modelValueItems: '',
    modelValueItemsState: '',
    rows: { hot: [], more: [] },
    placeholder: '',
    empty: '',
    unboundDot: '',
    isAicustom: false,
    isBtn: false,
    rowsPreview: [],
    div: '',
    button: '',
    length: '',
    maxlength: 0,
    isCount: false,
    panel__bar: '',
    input: { trim: '' },
    isModelValue: '',
    rowsPreviewDetail: [],
    isButton: false,
    templateItems: [],
    buttonPreview: '',
    rowsPreviewDetailDetail: [],
    label: '',
    isLabel: false,
    isActiveId: false,
    packs: '',
  }
}
