import type { Component } from 'vue'
import { ShopHomePanel, ShopGoodsPanel, ShopsListPanel } from '@/modules/shops'
import { ShopOpsPanel } from '@/modules/reception'
import {
  ShopKbPanel,
  ShopIntentPanel,
  ShopIntentLearnPanel,
  ShopAiCustomPanel,
  ShopBannedWordPanel,
  ShopTrainingPanel,
} from '@/modules/knowledge'
import { QcReplyPanel, ShopWorkOrderPanel, ShopWipPanel } from '@/modules/quality'
import { ShopAccountPanel } from '@/modules/billing'
import { SimConsoleView } from '@/modules/simulation'

/** 标题、面板和菜单共用此注册表；不再维护三份相互漂移的映射。 */
export const panelRegistry = {
  home: { title: '数据看板', component: ShopHomePanel },
  shops: { title: '店铺与商品', component: ShopsListPanel },
  sim: { title: '模拟客服台', component: SimConsoleView },
  goods: { title: '店铺商品', component: ShopGoodsPanel },
  desk: { title: '店铺工作台', component: ShopGoodsPanel },
  transfer: { title: '转接人工', component: ShopOpsPanel },
  welcome: { title: '进店欢迎', component: ShopOpsPanel },
  auto: { title: '自动操作', component: ShopOpsPanel },
  image: { title: '图片识别', component: ShopOpsPanel },
  intent: { title: '意图问法', component: ShopIntentPanel },
  'intent-doc': { title: '文档转意图', component: ShopIntentLearnPanel },
  'intent-chat': { title: '聊天转意图', component: ShopIntentLearnPanel },
  training: { title: 'AI训练场', component: ShopTrainingPanel },
  aicustom: { title: '模型定制', component: ShopAiCustomPanel },
  kb: { title: '尺码规格', component: ShopKbPanel },
  banned: { title: 'AI禁用词', component: ShopBannedWordPanel },
  workorder: { title: '工单登记', component: ShopWorkOrderPanel },
  qc: { title: '客服质检', component: QcReplyPanel },
  orders: { title: '我的订单', component: ShopAccountPanel },
  usage: { title: '算力消耗', component: ShopAccountPanel },
  general: { title: '软件偏好', component: ShopAccountPanel },
  account: { title: '登录账号', component: ShopAccountPanel },
  team: { title: '团队管理', component: ShopAccountPanel },
  learn: { title: '学习任务', component: ShopWipPanel },
  supervise: { title: '接待监督', component: ShopWipPanel },
  drill: { title: '训练演练', component: ShopWipPanel },
} satisfies Record<string, { title: string; component: Component }>

export type PanelKey = keyof typeof panelRegistry
export interface NavItem {
  key: PanelKey
  title: string
  children?: NavItem[]
}
export function isPanelKey(value: unknown): value is PanelKey {
  return typeof value === 'string' && Object.hasOwn(panelRegistry, value)
}
const item = (key: PanelKey, children?: PanelKey[]): NavItem => ({
  key,
  title: panelRegistry[key].title,
  children: children?.map((key) => item(key)),
})
export const navGroups: { label: string; items: NavItem[] }[] = [
  { label: '数据中心', items: [item('home')] },
  {
    label: '开店准备',
    items: [item('shops', ['transfer', 'welcome', 'auto', 'image']), item('sim')],
  },
  {
    label: '教AI回答',
    items: [
      item('intent', ['intent-doc', 'intent-chat']),
      item('training'),
      item('aicustom'),
      item('kb'),
      item('banned'),
    ],
  },
  { label: '客服工单', items: [item('workorder')] },
  { label: '接待质量', items: [item('qc')] },
  { label: '账户账单', items: [item('orders'), item('usage'), item('general'), item('account')] },
]
