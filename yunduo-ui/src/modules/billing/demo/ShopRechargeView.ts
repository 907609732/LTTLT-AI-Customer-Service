/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopRechargeViewDemo {
  isTemplate: boolean
  th: Record<
    string,
    {
      recommended: string
      badge: string
      name: string
      price: string
      unit: string
      avg: string
      fit: string
      extra: string
      hot: string
      contactOnly: string
      quota: number
      quotaUnit: number
      reception: string
    }
  >
  rows: Array<string>
  input: number
  select: string
  rowsSummary: Array<string>
  locked: {
    locked: string
    plan: string
    name: string
    perWan: string
    wan: number
    amount: number
  }
  is: { price: number; packageRulesId: string }
  isState: { price: number; packageRulesId: string }
  isDiv: boolean
  isHidden: boolean
  div: string
  isHiddenState: boolean
  rcToast__card: string
  isButton: boolean
  label: string
  divState: string
  template: string
  displayText: string
  rcQr__placeholder: string
  thState: string
  table: string
  divStateDetail: string
  fxConfetti: string
  rcSheet__body: { name: string; cycle: string; price: number }
  isRcPayPanel: boolean
  btnLabel: string
  wechat: { wechat: string }
  emptyPreviewRowsA: Array<{ title: string; rows: Array<{ ico: string; sub: string }> }>
  emptyPreviewRowsB: Array<{ kind: string; text: string }>
}
export function createShopRechargeViewDemo(): ShopRechargeViewDemo {
  return {
    isTemplate: false,
    th: {},
    rows: [],
    input: 10,
    select: 'advanced',
    rowsSummary: [],
    locked: { locked: '', plan: '', name: '', perWan: '', wan: 0, amount: 3 },
    is: { price: 3, packageRulesId: '' },
    isState: { price: 3, packageRulesId: '' },
    isDiv: false,
    isHidden: false,
    div: '',
    isHiddenState: false,
    rcToast__card: '',
    isButton: false,
    label: 'wechat',
    divState: '',
    template: '',
    displayText: '确认后权益即时生效 · 可开发票',
    rcQr__placeholder: '点击确认支付生成收款码',
    thState: '',
    table: '',
    divStateDetail: '',
    fxConfetti: '',
    rcSheet__body: { name: '—', cycle: '—', price: 0 },
    isRcPayPanel: false,
    btnLabel: '',
    wechat: { wechat: '' },
    emptyPreviewRowsA: [],
    emptyPreviewRowsB: [],
  }
}
