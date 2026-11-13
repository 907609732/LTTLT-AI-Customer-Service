/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface GoodsLearnDialogDemo {
  isTemplate: boolean
  isTemplateSummary: boolean
  isDisabled: boolean
  disabled: number
  style: string
  gld__panel: string
  gldBtn: string
  gld__body: string
  gld__panelSummary: string
  gld__batch: string
  gld__kpis: string
}
export function createGoodsLearnDialogDemo(): GoodsLearnDialogDemo {
  return {
    isTemplate: false,
    isTemplateSummary: false,
    isDisabled: false,
    disabled: 0,
    style: '',
    gld__panel: '',
    gldBtn: '',
    gld__body: '',
    gld__panelSummary: '',
    gld__batch: '',
    gld__kpis: '',
  }
}
