/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface IntentEditorModalDemo {
  tagEditor__input: string
  isDisabled: boolean
  isDisabledState: boolean
  isDiv: boolean
  intentMetaRow__name: string
  fieldHint: string
  fieldHintSummary: string
  isDivSummary: number
  isTemplate: boolean
  rows: Array<{ goodsId: string; goodsName: string }>
  fieldHintSummaryDetail: string
  intentMediaField: string
  count: { count: number }
  intentGoodsSide__stats: string
  displayText: string
  disabled: { length: string }
  isSpan: boolean
  input: string
  isDivPreview: boolean
  div: string
  intentModalMain: string
  value: string
  maxlength: number
  rowsPreview: Array<{ id: string; label: string }>
  isSelect: boolean
  isSelectPreview: boolean
  intentGoodsSearch__input: { trim: string }
  chipChip_EditableItems: Array<string>
  isMaxlength: number
  isDisabledPreview: number
  valuePreview: string
  maxlengthPreview: number
  rowsPreviewDetail: Array<{ type: string; pddUrl: string; url: string; name: string }>
  disabledPreview: number
  isDisabledPreviewDetail: boolean
  rowsPreviewDetailDetail: Array<{ shopId: string; shopName: string }>
  isButton: boolean
  emptyPreviewRowsA: Array<{ goodsName: string; goodsId: string; goodsCode: string }>
}
export function createIntentEditorModalDemo(): IntentEditorModalDemo {
  return {
    tagEditor__input: '',
    isDisabled: false,
    isDisabledState: false,
    isDiv: false,
    intentMetaRow__name: '',
    fieldHint: '',
    fieldHintSummary: '',
    isDivSummary: 0,
    isTemplate: false,
    rows: [],
    fieldHintSummaryDetail: '',
    intentMediaField: '',
    count: { count: 3 },
    intentGoodsSide__stats: '',
    displayText: '',
    disabled: { length: '' },
    isSpan: false,
    input: '',
    isDivPreview: false,
    div: '',
    intentModalMain: '',
    value: '',
    maxlength: 0,
    rowsPreview: [],
    isSelect: false,
    isSelectPreview: false,
    intentGoodsSearch__input: { trim: '' },
    chipChip_EditableItems: [],
    isMaxlength: 0,
    isDisabledPreview: 0,
    valuePreview: '',
    maxlengthPreview: 0,
    rowsPreviewDetail: [],
    disabledPreview: 0,
    isDisabledPreviewDetail: false,
    rowsPreviewDetailDetail: [],
    isButton: false,
    emptyPreviewRowsA: [],
  }
}
