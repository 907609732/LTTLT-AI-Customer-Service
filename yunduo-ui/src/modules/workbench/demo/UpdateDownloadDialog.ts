/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface UpdateDownloadDialogDemo {
  closeOnPressEscape: {
    downloadVisible: string
    downloadPhase: string
    downloadProgress: string
    downloadError: string
    downloadReceived: string
    downloadTotal: string
    packageSize: string
    cancelDownload: string
    dialogForce: string
    remindLater: string
    startDownload: string
    downloadSpeedLabel: string
    downloadEtaLabel: string
  }
  style: string
  updateDownloadBrand: string
  updateDownloadBarFill: string
  src: string
}
export function createUpdateDownloadDialogDemo(): UpdateDownloadDialogDemo {
  return {
    closeOnPressEscape: {
      downloadVisible: '',
      downloadPhase: '',
      downloadProgress: '',
      downloadError: '',
      downloadReceived: '',
      downloadTotal: '',
      packageSize: '',
      cancelDownload: '',
      dialogForce: '',
      remindLater: '',
      startDownload: '',
      downloadSpeedLabel: '',
      downloadEtaLabel: '',
    },
    style: '',
    updateDownloadBrand: '',
    updateDownloadBarFill: '',
    src: '',
  }
}
