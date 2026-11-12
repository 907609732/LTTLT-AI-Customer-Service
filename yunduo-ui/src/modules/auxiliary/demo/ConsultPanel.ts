/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ConsultPanelDemo {
  div: string
  toolChip: string
  input: string
  isDisabled: boolean
  templateItems: Array<{ categoryName: string; text: string; plat: string }>
  li: number
  isTemplate: boolean
  isDiv: boolean
  red: string
  isTemplateSummary: boolean
  title: { title: string; tip: string }
  rows: Array<{
    id: string
    timeout: number
    name: string
    storeName: string
    orderTag: { tone: string; text: string }
    paused: string
    preview: string
    time: string
    filter: string
    unread: string
    plat: string
  }>
  goodsName: {
    goodsName: string
    name: string
    storeName: string
    orderTag: { tone: string; text: string }
    tone: string
    text: string
    paused: string
  }
  placeholder: string
  titleSummary: string
  templateItemsSummary: Array<{
    buyer: { text: string }
    showBuyer: boolean
    buyerIndex: string
    ai: { role: string; text: string }
    plat: string
  }>
  isCorrectBubble: string
  isTemplateState: boolean
  rowsState: Array<{ id: string; name: string; plat: string }>
  savePackWarn: string
  select: string
  button: string
  inputState: string
  isSaveField: boolean
  saveSheetA: string
  saveSheetQ: string
  rowsStateDetail: Array<{ text: string; plat: string }>
  saveKwChipItems: Array<string>
  saveKwInput: string
  isTemplateStateDetail: boolean
  isDisabledState: boolean
  isDisabledStateDetail: boolean
  templateItemsState: Array<{ type: string; url: string; plat: string }>
  isTemplateSummaryDetail: boolean
  isDisabledSummary: boolean
  saveSheet: string
  isP: string
  isTemplateSummaryDetailDetail: boolean
  buttonSummary: string
  src: Record<string, string>
  alt: Record<string, string>
}
export function createConsultPanelDemo(): ConsultPanelDemo {
  return {
    div: 'pending',
    toolChip: 'latest',
    input: '',
    isDisabled: false,
    templateItems: [],
    li: 0,
    isTemplate: false,
    isDiv: false,
    red: '',
    isTemplateSummary: false,
    title: { title: '', tip: '这里是示例文案' },
    rows: [],
    goodsName: {
      goodsName: '',
      name: '',
      storeName: '',
      orderTag: { tone: '', text: '' },
      tone: '',
      text: '这里是示例文案',
      paused: '',
    },
    placeholder: '',
    titleSummary: '',
    templateItemsSummary: [],
    isCorrectBubble: '',
    isTemplateState: false,
    rowsState: [],
    savePackWarn: '',
    select: '',
    button: 'general',
    inputState: '',
    isSaveField: false,
    saveSheetA: '',
    saveSheetQ: '',
    rowsStateDetail: [],
    saveKwChipItems: [],
    saveKwInput: '',
    isTemplateStateDetail: false,
    isDisabledState: false,
    isDisabledStateDetail: false,
    templateItemsState: [],
    isTemplateSummaryDetail: false,
    isDisabledSummary: false,
    saveSheet: '',
    isP: '',
    isTemplateSummaryDetailDetail: false,
    buttonSummary: '',
    src: {},
    alt: {},
  }
}
