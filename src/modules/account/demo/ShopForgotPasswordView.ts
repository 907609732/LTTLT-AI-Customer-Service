/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopForgotPasswordViewDemo {
  i: number
  isLoading: boolean
  disabled: number
  phone: { phone: string; code: string; password: string; confirm: string }
  rows: Array<number>
}
export function createShopForgotPasswordViewDemo(): ShopForgotPasswordViewDemo {
  return {
    i: 1,
    isLoading: false,
    disabled: 0,
    phone: { phone: '', code: '', password: '', confirm: '' },
    rows: [],
  }
}
