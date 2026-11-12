/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopKbPanelDemo {
  fieldHint: string
  isTemplate: boolean
  isTemplatePreview: boolean
  length: { length: string }
  input: { status: string; q: string }
  rows: Array<{ id: string; status: string; name: string }>
  div: string
  name: { name: string; status: string; content: string; bindGoodsCount: string; goodsIds: string }
  maxlength: number
  maxlengthPreview: number
  button: string
  lengthPreview: { length: string }
  lengthPreviewDetail: { length: string }
  rowsPreview: Array<{ name: string }>
  divPreview: string
  isTemplatePreviewDetail: boolean
  buttonPreview: string
  isInput: boolean
  isInputPreview: boolean
  isInputPreviewDetail: boolean
  isTemplatePreviewDetailDetail: boolean
  isTemplatePreviewDetailDetailDetail: boolean
  isButton: boolean
  buttonPreviewDetail: string
  lengthPreviewDetailDetail: { length: string }
  lengthPreviewDetailDetailDetail: { length: string }
  templateItems: Array<{
    disabled: boolean
    name: string
    storeName: string
    goodsId: string
    outGoodsSn: string
  }>
  isLabel: boolean
  kbBindDialog__body: string
  isTemplatePreviewDetailDetailDetailDetail: boolean
  emptyPreviewRowsA: Array<{ bindGoodsCount: number; storeId: string; name: string }>
}
export function createShopKbPanelDemo(): ShopKbPanelDemo {
  return {
    fieldHint: '',
    isTemplate: false,
    isTemplatePreview: false,
    length: { length: '' },
    input: { status: 'online', q: '' },
    rows: [],
    div: '',
    name: {
      name: '',
      status: 'online',
      content: '这里是示例文案',
      bindGoodsCount: '',
      goodsIds: '',
    },
    maxlength: 0,
    maxlengthPreview: 0,
    button: '',
    lengthPreview: { length: '' },
    lengthPreviewDetail: { length: '' },
    rowsPreview: [],
    divPreview: '',
    isTemplatePreviewDetail: false,
    buttonPreview: '',
    isInput: false,
    isInputPreview: false,
    isInputPreviewDetail: false,
    isTemplatePreviewDetailDetail: false,
    isTemplatePreviewDetailDetailDetail: false,
    isButton: false,
    buttonPreviewDetail: '',
    lengthPreviewDetailDetail: { length: '' },
    lengthPreviewDetailDetailDetail: { length: '' },
    templateItems: [],
    isLabel: false,
    kbBindDialog__body: '',
    isTemplatePreviewDetailDetailDetailDetail: false,
    emptyPreviewRowsA: [],
  }
}
