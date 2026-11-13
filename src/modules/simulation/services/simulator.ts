import type { LocalStore } from '@/shared/contracts/backend'
import {
  SIM_PLATFORM_ID,
  type SimulatorActionResult,
  type SimulatorStatus,
} from '@/shared/contracts/simulation'
import { getDesktop } from '@/shared/platform/desktop'

/**
 * 本机模拟模块服务：渲染层接触“模拟顾客”桌面能力的唯一入口。
 *
 * 约束：
 * - 组件不直接读 window.yunduoDesktop，也不自己推断服务是否在跑；“运行中”只以主进程返回为准；
 * - 浏览器预览没有桥，能力缺失时返回明确原因，绝不伪造 running=true 或“已打开”；
 * - 读取失败按“未运行 + 真实错误原因”返回，方便界面原样展示，而不是吞掉错误说成功。
 */
const DESKTOP_ONLY = '此操作需要桌面版；浏览器仅提供界面预览'

/** 模拟能力是否可用；不可用时 reason 必须能直接展示给用户。 */
export interface SimulatorSupport {
  supported: boolean
  reason: string
}

export function simulatorSupport(): SimulatorSupport {
  const desktop = getDesktop()
  if (!desktop.isElectron) return { supported: false, reason: DESKTOP_ONLY }
  if (!desktop.simulatorStatus || !desktop.openSimulatorPage)
    return { supported: false, reason: '当前桌面版本未提供模拟顾客服务接口，请更新桌面版后再试' }
  return { supported: true, reason: '' }
}

/** 读取模拟顾客服务状态；不可用时 error 里是真实原因（例如端口被占用）。 */
export async function readSimulatorStatus(): Promise<SimulatorStatus> {
  const desktop = getDesktop()
  if (!desktop.simulatorStatus) return { running: false, port: 0, url: '', error: DESKTOP_ONLY }
  try {
    return await desktop.simulatorStatus()
  } catch (cause) {
    return {
      running: false,
      port: 0,
      url: '',
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

/** 在系统浏览器打开模拟顾客页；返回主进程给出的成败文案，界面原样展示。 */
export async function openSimulatorPage(): Promise<SimulatorActionResult> {
  const desktop = getDesktop()
  if (!desktop.openSimulatorPage) return { ok: false, message: DESKTOP_ONLY }
  try {
    return await desktop.openSimulatorPage()
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * 店铺是否属于本机模拟。
 * 只认共享契约里的平台 id：真实店铺的业务语义不同（有平台登录、有真实买家），不能混为一谈。
 */
export function isSimStore(store: LocalStore): boolean {
  return store.platform === SIM_PLATFORM_ID
}

/** 客服台只展示本机模拟店铺，真实店铺走各自的平台流程。 */
export function listSimStores(stores: readonly LocalStore[]): LocalStore[] {
  return stores.filter(isSimStore)
}
