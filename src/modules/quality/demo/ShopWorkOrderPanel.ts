/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopWorkOrderPanelDemo {
  woLate: string
  isButton: boolean
  button: string
  open: { open: boolean; doing: string; wait: string; done: string; overdue: string }
  rows: Array<{ id: string; label: string }>
  isWoSelect: boolean
  rowsPreview: Array<{ userId: string; label: string; id: string }>
  isWoSelectPreview: boolean
  isInput: boolean
  rowsPreviewDetail: Array<{
    id: string
    status: string
    priority: string
    orderNo: string
    title: string
    shopName: string
    assigneeName: string
    buyer: string
    no: string
  }>
  isButtonPreview: boolean
  isButtonPreviewDetail: boolean
  isTemplate: boolean
  isSelect: boolean
  woFieldEditItems: Array<{ label: string; kind: string; required: string; id: string }>
  rowsPreviewDetailDetail: Array<{ id: string; label: string }>
  isTemplatePreview: boolean
  selectItems: {
    type: string
    priority: string
    shopName: string
    assigneeId: string
    buyer: string
    extras: Record<string, Array<string>>
    dueLocal: string
  }
  rowsPreviewDetailDetailDetail: Array<{ id: string; label: string }>
  rowsPreviewDetailDetailDetailDetail: Array<{ userId: string; label: string; id: string }>
  woFieldItems: Array<{
    label: string
    required: string
    kind: string
    placeholder: string
    options: Array<string>
    id: string
  }>
  no: {
    type: string
    no: string
    priority: string
    orderNo: string
    title: string
    status: string
    shopName: string
    assigneeId: string
    assigneeName: string
    buyer: string
    dueAt: string
    fields: string
    detail: string
    logs: string
  }
  woType: string
  rowsPreviewDetailDetailDetailDetailDetail: Array<{ userId: string; label: string; id: string }>
  isTextarea: boolean
  emptyPreviewRowsA: Array<{ label: string; kind: string; images: Array<string>; text: string }>
  emptyPreviewRowsB: Array<{ text: string; id: string }>
}
export function createShopWorkOrderPanelDemo(): ShopWorkOrderPanelDemo {
  return {
    woLate: '',
    isButton: false,
    button: '',
    open: { open: false, doing: '', wait: '', done: '', overdue: '' },
    rows: [],
    isWoSelect: false,
    rowsPreview: [],
    isWoSelectPreview: false,
    isInput: false,
    rowsPreviewDetail: [],
    isButtonPreview: false,
    isButtonPreviewDetail: false,
    isTemplate: false,
    isSelect: false,
    woFieldEditItems: [],
    rowsPreviewDetailDetail: [],
    isTemplatePreview: false,
    selectItems: {
      type: '',
      priority: '',
      shopName: '',
      assigneeId: '',
      buyer: '',
      extras: {},
      dueLocal: '',
    },
    rowsPreviewDetailDetailDetail: [],
    rowsPreviewDetailDetailDetailDetail: [],
    woFieldItems: [],
    no: {
      type: '',
      no: '',
      priority: '',
      orderNo: '',
      title: '',
      status: 'online',
      shopName: '',
      assigneeId: '',
      assigneeName: '',
      buyer: '',
      dueAt: '',
      fields: '',
      detail: '这里是示例文案',
      logs: '',
    },
    woType: '',
    rowsPreviewDetailDetailDetailDetailDetail: [],
    isTextarea: false,
    emptyPreviewRowsA: [],
    emptyPreviewRowsB: [],
  }
}
