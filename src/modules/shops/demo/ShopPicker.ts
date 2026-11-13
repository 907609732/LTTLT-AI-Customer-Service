/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopPickerDemo {
  isDiv: boolean
  input: string
  style: string
  online: { online: number }
  src: { icon: string; name: string }
  rows: Array<{ id: string; name: string; online: string }>
}
export function createShopPickerDemo(): ShopPickerDemo {
  return {
    isDiv: false,
    input: '',
    style: '',
    online: { online: 3 },
    src: {
      icon: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      name: '',
    },
    rows: [],
  }
}
