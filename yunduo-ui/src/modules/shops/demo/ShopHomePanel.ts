/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopHomePanelDemo {
  dashUpdated: string
  isDataLevel: boolean
  dashHero__main: string
  dashRisk: string
  isTemplate: boolean
  button: string
  isDisabled: boolean
  rows: Array<{
    warn: string
    icoClass: string
    ico: string
    valueClass: string
    label: string
    tip: string
  }>
  rowsPreview: Array<{ state: string; label: string; tip: string }>
  templateItems: Array<{ name: string; timeout: number }>
  btn: { ready: string }
  rowsPreviewDetail: Array<{ label: string; warn: string; tip: string }>
  rowsPreviewDetailDetail: Array<{ state: string; label: string; tip: string }>
  truncated: { truncated: string; ready: string }
  dashGrid: string
  rowsPreviewDetailDetailDetail: Array<{
    active: boolean
    title: string
    height: number
    label: string
  }>
  templateItemsPreview: Array<{ name: string }>
  dashGridPreview: string
  panel: string
  isTemplatePreview: boolean
  isDashHint: boolean
  templateItemsPreviewDetail: Array<{ name: string }>
  b: { running: number; done: string; total: number; jobCount: string }
  dashQuickItems: Array<{ label: string; desc: string }>
}
export function createShopHomePanelDemo(): ShopHomePanelDemo {
  return {
    dashUpdated: '',
    isDataLevel: false,
    dashHero__main: '',
    dashRisk: '',
    isTemplate: false,
    button: '',
    isDisabled: false,
    rows: [],
    rowsPreview: [],
    templateItems: [],
    btn: { ready: '' },
    rowsPreviewDetail: [],
    rowsPreviewDetailDetail: [],
    truncated: { truncated: '', ready: '' },
    dashGrid: '',
    rowsPreviewDetailDetailDetail: [],
    templateItemsPreview: [],
    dashGridPreview: '',
    panel: '',
    isTemplatePreview: false,
    isDashHint: false,
    templateItemsPreviewDetail: [],
    b: { running: 0, done: '', total: 3, jobCount: '' },
    dashQuickItems: [],
  }
}
