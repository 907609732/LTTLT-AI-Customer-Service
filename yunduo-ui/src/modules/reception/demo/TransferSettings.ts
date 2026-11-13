/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface TransferSettingsDemo {
  rows: Array<string>
  emptyPreviewRowsA: Array<string>
}
export function createTransferSettingsDemo(): TransferSettingsDemo {
  return { rows: [], emptyPreviewRowsA: [] }
}
