import { ElMessage } from 'element-plus'

export type CapabilityStatus = 'available' | 'demo' | 'unavailable'

/** 仅由具体操作显式调用，不拦截导航、输入和所有按钮的点击事件。 */
export function notifyUnavailable(label = '该功能'): void {
  ElMessage({
    message: `「${label === '此操作' ? '该功能' : label}」暂未接入，敬请期待`,
    type: 'info',
    duration: 1600,
    grouping: true,
    plain: true,
  })
}
