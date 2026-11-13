/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ExampleDialogDemo {
  rows: {
    hot: Array<{ id: string; short: string; name: string }>
    more: Array<{ id: string; short: string; name: string }>
  }
  rowsSummary: { subs: Array<{ id: string; name: string }>; name: string; hot: string; tip: string }
  button: string
  exBtn: { name: string }
  exSubline: string
}
export function createExampleDialogDemo(): ExampleDialogDemo {
  return {
    rows: { hot: [], more: [] },
    rowsSummary: { subs: [], name: '', hot: '', tip: '' },
    button: '',
    exBtn: { name: '' },
    exSubline: '',
  }
}
