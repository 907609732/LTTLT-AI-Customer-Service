/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopIntentPanelDemo {
  input: string
  button: string
  buttonState: string
  isDisabled: boolean
  inputState: string
  templateItems: Array<{
    askGoods: { goodsName: string; goodsId: string }
    askImages: Array<string>
    ask: string
    pending: number
    error: string
    reply: string
    hit: { name: string }
    disabledHit: boolean
    isTransfer: boolean
    pics: Array<string>
    videos: Array<string>
    key: string
  }>
  isDisabledState: boolean
  isDiv: boolean
  templateItemsState: Array<{ preview: string; name: string; key: string }>
  goodsId: { goodsId: string; goodsCode: string }
  isTemplate: boolean
  inputStateDetail: string
  isTemplateState: boolean
  article: string
  list: { list: Array<{ url: string }>; idx: number }
  isTemplateSummary: boolean
  name: { name: string }
  packChatGoods__chip: string
  packTry__hd: string
  templateItemsSummary: Array<{
    goodsName: string
    shopName: string
    goodsId: string
    goodsCode: string
    key: string
  }>
  disabled: number
  rows: Array<string>
  rowsSummary: Array<string>
  templateItemsSummaryDetail: Array<{ name: string; count: number; key: string }>
  rowsSummaryDetail: Array<{ name: string; key: string }>
  packCol__sub: string
  displayText: string
  packCol__hd: string
  buttonSummary: string
  em: number
  textarea: string
  inputStateDetailDetail: string
  isDisabledStateDetail: boolean
  elementLoadingText: string
  isViewIsOn: boolean
  isViewIsOnPreview: boolean
  disabledPreview: boolean
  isButton: boolean
  isButtonPreview: boolean
  inputPreview: { trim: string }
  rowsPreview: Array<{ id: string; name: string; key: string }>
  div: string
  rowsPreviewDetail: Array<{ id: string; key: string }>
  buttonPreview: string
  isInput: boolean
  buttonPreviewDetail: string
  isPackIntentSort: boolean
  isPackIntentSortPreview: boolean
  rowsPreviewDetailDetail: Array<{
    enabled: boolean
    id: string
    apiId: string
    name: string
    key: string
  }>
  isArticle: boolean
  findIndex: { findIndex: string; length: string }
  isDisabledPreview: number
  isListPager__size: number
  buttonItems: string
  isLabel: boolean
  isTemplatePreview: boolean
  divPreview: string
  isInputPreview: boolean
  isInputPreviewDetail: boolean
  setupQItems: Array<{
    label: string
    rulePlaceholder: string
    replyPlaceholder: string
    key: string
  }>
  emptyPreviewRowsA: Array<{ type: string; pddUrl: string; url: string; name: string; key: string }>
}
export function createShopIntentPanelDemo(): ShopIntentPanelDemo {
  return {
    input: '',
    button: 'all',
    buttonState: 'all',
    isDisabled: false,
    inputState: '',
    templateItems: [],
    isDisabledState: false,
    isDiv: false,
    templateItemsState: [],
    goodsId: { goodsId: '', goodsCode: '' },
    isTemplate: false,
    inputStateDetail: '',
    isTemplateState: false,
    article: '',
    list: { list: [], idx: 0 },
    isTemplateSummary: false,
    name: { name: '' },
    packChatGoods__chip: '',
    packTry__hd: '',
    templateItemsSummary: [],
    disabled: 0,
    rows: [],
    rowsSummary: [],
    templateItemsSummaryDetail: [],
    rowsSummaryDetail: [],
    packCol__sub: '',
    displayText: '',
    packCol__hd: '',
    buttonSummary: '',
    em: 0,
    textarea: '',
    inputStateDetailDetail: '',
    isDisabledStateDetail: false,
    elementLoadingText: '',
    isViewIsOn: false,
    isViewIsOnPreview: false,
    disabledPreview: false,
    isButton: false,
    isButtonPreview: false,
    inputPreview: { trim: '' },
    rowsPreview: [],
    div: '',
    rowsPreviewDetail: [],
    buttonPreview: '',
    isInput: false,
    buttonPreviewDetail: '',
    isPackIntentSort: false,
    isPackIntentSortPreview: false,
    rowsPreviewDetailDetail: [],
    isArticle: false,
    findIndex: { findIndex: '', length: '' },
    isDisabledPreview: 1,
    isListPager__size: 0,
    buttonItems: '',
    isLabel: false,
    isTemplatePreview: false,
    divPreview: '',
    isInputPreview: false,
    isInputPreviewDetail: false,
    setupQItems: [],
    emptyPreviewRowsA: [],
  }
}
