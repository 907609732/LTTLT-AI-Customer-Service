/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface AiAssistCenterViewDemo {
  ariaSelected: string
  isTitlebarPopSoundPop: boolean
  input: Record<string, never>
  isButton: boolean
  isButtonState: boolean
  warn: Record<string, string>
  isSpan: boolean
  inputState: string
  switchNext: { switchNext: string; dismiss: string }
  isButtonStateDetail: boolean
  template: string
  isElIcon: boolean
  isPlatSelectPop: boolean
  button: string
  article: string
  isTemplate: boolean
  displayText: string
  rows: Array<{
    status: string
    id: string
    priority: string
    shopName: string
    assigneeName: string
    orderNo: string
    buyer: string
    detail: string
    plat: string
  }>
  rowsSummary: Array<{ plat: string; label: string }>
  plat: { plat: string; label: string }
  title: string
  isEmptyAction: number
  isDisabled: boolean
  displayTextSummary: string
  isTemplateSummary: boolean
  titleSummary: { title: string; tip: string }
  length: { length: string }
  rowsSummaryDetail: Array<{ id: string; count: number; label: string; plat: string }>
  articleSummary: {
    id: number
    name: string
    shop: string
    orderTag: { tone: string; text: string }
    tone: string
    text: string
    paused: string
  }
  placeholder: string
  rowsSummaryDetailDetail: Array<{
    stale: string
    id: string
    name: string
    shop: string
    lv: string
    lvText: string
    lvIcon: string
    storeId: string
    uid: string
    paused: string
    orderTag: { tone: string; text: string }
    staleReason: string
    desc: string
    time: string
    plat: string
  }>
  rowsSummaryDetailDetailDetail: Array<{
    handled: string
    title: string
    time: string
    lv: string
    lvText: string
    shop: string
    plat: string
  }>
  rowsSummaryDetailDetailDetailDetail: Array<{
    handled: string
    lv: string
    time: string
    shop: string
    refundText: string
    lvText: string
    logisticsTip: string
    reason: string
    plat: string
  }>
  style: string
  isDisabledState: boolean
  isTemplateState: boolean
  isInput: boolean
  isInputPreview: boolean
  displayTextPreview: string
  src: Record<string, string>
  alt: Record<string, string>
  span: string
  emptyPreviewRowsA: Array<{ label: string; plat: string }>
}
export function createAiAssistCenterViewDemo(): AiAssistCenterViewDemo {
  return {
    ariaSelected: 'consult',
    isTitlebarPopSoundPop: false,
    input: {},
    isButton: false,
    isButtonState: false,
    warn: {},
    isSpan: false,
    inputState: '',
    switchNext: { switchNext: '', dismiss: '' },
    isButtonStateDetail: false,
    template: '',
    isElIcon: false,
    isPlatSelectPop: false,
    button: 'platform',
    article: '',
    isTemplate: false,
    displayText: '',
    rows: [],
    rowsSummary: [],
    plat: { plat: '', label: '' },
    title: '',
    isEmptyAction: 0,
    isDisabled: false,
    displayTextSummary: '',
    isTemplateSummary: false,
    titleSummary: { title: '', tip: '这里是示例文案' },
    length: { length: '' },
    rowsSummaryDetail: [],
    articleSummary: {
      id: 1,
      name: '',
      shop: '',
      orderTag: { tone: '', text: '' },
      tone: '',
      text: '这里是示例文案',
      paused: '',
    },
    placeholder: '',
    rowsSummaryDetailDetail: [],
    rowsSummaryDetailDetailDetail: [],
    rowsSummaryDetailDetailDetailDetail: [],
    style: '',
    isDisabledState: false,
    isTemplateState: false,
    isInput: false,
    isInputPreview: false,
    displayTextPreview: '',
    src: {},
    alt: {},
    span: '',
    emptyPreviewRowsA: [],
  }
}
