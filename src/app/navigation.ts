import type { Component } from 'vue'
import { ShopHomePanel, ShopGoodsPanel, ShopsListPanel } from '@/modules/shops'
import { ShopOpsPanel } from '@/modules/reception'
import {
  ShopKbPanel,
  ShopIntentPanel,
  ShopIntentLearnPanel,
  ShopBannedWordPanel,
  ShopTrainingPanel,
} from '@/modules/knowledge'
import { QcReplyPanel, ShopWorkOrderPanel, ShopWipPanel } from '@/modules/quality'
import { StoreSyncView } from '@/modules/sync'

/** 标题、面板和菜单共用此注册表；不再维护三份相互漂移的映射。 */
export const panelRegistry = {
  home: { title: '数据看板', component: ShopHomePanel },
  shops: { title: '店铺与商品', component: ShopsListPanel },
  sync: { title: '跨店同步', component: StoreSyncView },
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
  kb: { title: '尺码规格', component: ShopKbPanel },
  banned: { title: 'AI禁用词', component: ShopBannedWordPanel },
  workorder: { title: '工单登记', component: ShopWorkOrderPanel },
  qc: { title: '客服质检', component: QcReplyPanel },
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
/** 旧测试入口归并至训练场，旧模型页面回到店铺列表，由本店基础设置维护规则。 */
export function resolvePanelKey(value: unknown): PanelKey {
  if (value === 'sim') return 'training'
  return isPanelKey(value) ? value : 'shops'
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
    items: [item('shops', ['transfer', 'welcome', 'auto', 'image']), item('sync')],
  },
  {
    label: '教AI回答',
    items: [
      item('intent', ['intent-doc', 'intent-chat']),
      item('training'),
      item('kb'),
      item('banned'),
    ],
  },
  { label: '客服工单', items: [item('workorder')] },
  { label: '接待质量', items: [item('qc')] },
]
