/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopSyncConfigDialogDemo {
  label: Record<string, string>
  isInput: boolean
  input: string
  isDisabled: boolean
  plat: string
  src: { icon: string; name: string }
  syncEmpty: { length: string }
  rows: Array<{ name: string; online: string }>
  isDisabledSummary: boolean
  syncFt: string
  emptyPreviewRowsA: Array<{ key: string; label: string; tip: string }>
}
export function createShopSyncConfigDialogDemo(): ShopSyncConfigDialogDemo {
  return {
    label: {},
    isInput: false,
    input: '',
    isDisabled: false,
    plat: '',
    src: {
      icon: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      name: '',
    },
    syncEmpty: { length: '' },
    rows: [],
    isDisabledSummary: false,
    syncFt: '',
    emptyPreviewRowsA: [],
  }
}
