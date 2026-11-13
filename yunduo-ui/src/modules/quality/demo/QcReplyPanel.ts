/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface QcReplyPanelDemo {
  isButton: boolean
  isButtonState: boolean
  button: string
  qcSearch: string
  isLoading: boolean
  buttonState: string
  length: { length: string }
  qciList: { length: string }
  rows: Array<{ key: string; name: string; count: number; plat: string }>
  rowsSummary: Array<{
    id: string
    review: string
    level: string
    buyer: string
    time: string
    reply: string
    plat: string
  }>
  customers: { customers: string; shops: string; open: boolean }
  displayText: string
  shop: { shop: string; buyer: string; time: string; review: string }
  rowsSummaryDetail: Array<{ level: string; issues: Array<string>; plat: string }>
}
export function createQcReplyPanelDemo(): QcReplyPanelDemo {
  return {
    isButton: false,
    isButtonState: false,
    button: 'today',
    qcSearch: '',
    isLoading: false,
    buttonState: 'all',
    length: { length: '' },
    qciList: { length: '' },
    rows: [],
    rowsSummary: [],
    customers: { customers: '', shops: '', open: false },
    displayText: '',
    shop: { shop: '', buyer: '', time: '2026-11-11 10:00', review: '' },
    rowsSummaryDetail: [],
  }
}
