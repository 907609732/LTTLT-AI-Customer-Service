/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface UpdateAvailableDialogDemo {
  closeOnClickModalItems: {
    dialogForce: string
    changelog: Array<{ icon: string; text: string }>
    packageSizeLabel: string
  }
  src: string
}
export function createUpdateAvailableDialogDemo(): UpdateAvailableDialogDemo {
  return {
    closeOnClickModalItems: { dialogForce: '', changelog: [], packageSizeLabel: '' },
    src: '',
  }
}
