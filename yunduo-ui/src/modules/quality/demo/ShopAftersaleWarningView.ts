/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopAftersaleWarningViewDemo {
  button: string
  buttonState: string
  modelValue: string
  rows: Array<{
    level: string
    id: string
    icon: string
    levelLabel: string
    title: string
    platform: string
    type: string
    desc: string
    shop: string
    goods: string
    amount: number
    time: string
    countdown: number
  }>
  title: {
    title: string
    levelLabel: string
    platform: string
    type: string
    shop: string
    countdown: string
    desc: string
  }
}
export function createShopAftersaleWarningViewDemo(): ShopAftersaleWarningViewDemo {
  return {
    button: 'all',
    buttonState: 'all',
    modelValue: '',
    rows: [],
    title: {
      title: '',
      levelLabel: '',
      platform: '',
      type: '',
      shop: '',
      countdown: '',
      desc: '这里是示例文案',
    },
  }
}
