/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopBannedWordPanelDemo {
  isDisabled: boolean
  isDisabledPreview: boolean
  isDisabledPreviewDetail: boolean
  isBwInput: boolean
  isBwInputBwInput_Replace: boolean
  isBwSearch: boolean
  isTemplate: boolean
  templateItems: Array<string>
  isButton: number
  isBwInputPreview: boolean
  isBwInputBwInput_ReplacePreview: boolean
}
export function createShopBannedWordPanelDemo(): ShopBannedWordPanelDemo {
  return {
    isDisabled: false,
    isDisabledPreview: false,
    isDisabledPreviewDetail: false,
    isBwInput: false,
    isBwInputBwInput_Replace: false,
    isBwSearch: false,
    isTemplate: false,
    templateItems: [],
    isButton: 0,
    isBwInputPreview: false,
    isBwInputBwInput_ReplacePreview: false,
  }
}
