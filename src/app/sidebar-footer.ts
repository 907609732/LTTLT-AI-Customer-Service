import { computed } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getDesktop } from '@/shared/platform/desktop'
import type { ManagedState } from '@/shared/contracts/managed'

/**
 * 左下角额度读取服务端账号聚合的 legacy `trial.remaining` 字段。
 * 字段名虽为 trial，服务端实际把试用和付费可用次数聚合在这里，因此界面
 * 只称“账号当前可用次数”，不能把它描述成试用剩余。
 * 这里的登录判定与 billing/use-billing.ts 保持一致；本机 Key、待重启和
 * 尚未同步的账号分别显示短状态，不能用 0 或演示数字冒充真实余额。
 */
export type SidebarBalanceState = 'loading' | 'local' | 'login' | 'restart' | 'unknown' | 'ready'

export interface SidebarBalance {
  state: SidebarBalanceState
  balance: number | null
  label: string
  detail: string
  canRecharge: boolean
}

export interface SidebarBalanceInput {
  available: boolean
  workspaceId: string
  loading: boolean
  managed: ManagedState
}

const waiting = (detail: string): SidebarBalance => ({
  state: 'loading',
  balance: null,
  label: '待核对',
  detail,
  canRecharge: false,
})
function quotaLabel(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  return value.toLocaleString('zh-CN')
}

export function deriveSidebarBalance(input: SidebarBalanceInput): SidebarBalance {
  if (!input.available) return waiting('浏览器预览或本机服务尚未就绪')
  if (!input.workspaceId && input.loading) return waiting('正在等待本机账号快照')
  const managed = input.managed
  if (managed.restartRequired) {
    return {
      state: 'restart',
      balance: null,
      label: '待重启',
      detail: '账号模式切换需要重启软件后生效',
      canRecharge: false,
    }
  }
  const signedIn =
    managed.active.mode === 'managed' &&
    !managed.restartRequired &&
    managed.session.status === 'signed_in'
  if (signedIn) {
    const remaining = managed.session.account?.trial.remaining
    const label = quotaLabel(remaining)
    if (label === null) {
      return {
        state: 'unknown',
        balance: null,
        label: '待核对',
        detail: '已登录，但尚未取得可用额度',
        canRecharge: true,
      }
    }
    return {
      state: 'ready',
      balance: remaining!,
      label,
      detail: '账号当前可用次数',
      canRecharge: true,
    }
  }
  if (managed.active.mode === 'managed') {
    return {
      state: 'login',
      balance: null,
      label: '需登录',
      detail: '托管账号尚未登录',
      canRecharge: false,
    }
  }
  return {
    state: 'local',
    balance: null,
    label: '本机 Key',
    detail: '当前使用本机 Key，不读取托管账号算力',
    canRecharge: false,
  }
}

/** 快照随启动同步及业务刷新更新；不在此处新增定时器或网络请求。 */
export function useSidebarBalance() {
  const runtime = useRuntimeStore()
  return computed(() =>
    deriveSidebarBalance({
      available: runtime.available,
      workspaceId: runtime.snapshot.workspaceId,
      loading: runtime.loading,
      managed: runtime.snapshot.managed,
    }),
  )
}

/** 教程使用固定官方地址，仍经既有受限 openExternal 桥接打开。 */
export const OFFICIAL_TUTORIAL_URL =
  'https://github.com/907609732/LTTLT-AI-Customer-Service#快速使用'

function isOfficialTutorialUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.username &&
      !url.password &&
      url.pathname === '/907609732/LTTLT-AI-Customer-Service' &&
      decodeURIComponent(url.hash) === '#快速使用'
    )
  } catch {
    return false
  }
}

export async function openOfficialTutorial(): Promise<void> {
  const desktop = getDesktop()
  if (!desktop.isElectron) throw new Error('浏览器预览不支持打开使用教程')
  if (!isOfficialTutorialUrl(OFFICIAL_TUTORIAL_URL)) throw new Error('使用教程地址无效')
  await desktop.openExternal(OFFICIAL_TUTORIAL_URL)
}
