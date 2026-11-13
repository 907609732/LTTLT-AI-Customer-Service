/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface DashboardViewDemo {
  isDiv: boolean
  isDivState: boolean
  title: { title: string; desc: string; mode: string; offline: number }
  homeBizWechat: { wechat: string }
}
export function createDashboardViewDemo(): DashboardViewDemo {
  return {
    isDiv: false,
    isDivState: false,
    title: {
      title: '添加店铺，开始 AI 接待',
      desc: '接入店铺后即可聚合消息、智能辅助值守',
      mode: 'empty',
      offline: 0,
    },
    homeBizWechat: { wechat: '' },
  }
}
