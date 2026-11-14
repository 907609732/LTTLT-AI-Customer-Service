import type { SchedulerBridge } from '@/shared/contracts/scheduler'
import { getDesktop } from '@/shared/platform/desktop'
import { useRuntimeStore } from '@/shared/state/runtime'
export function getSchedulerWorkspaceId(): string {
  return useRuntimeStore().snapshot.workspaceId
}

/** Main UI remains explicit about missing preload wiring and browser preview. */
export function getSchedulerService(): SchedulerBridge | undefined {
  const desktop = getDesktop()
  if (!desktop.isElectron || !('schedulerSnapshot' in desktop) || !('schedulerExecute' in desktop))
    return undefined
  if (
    typeof desktop.schedulerSnapshot !== 'function' ||
    typeof desktop.schedulerExecute !== 'function'
  )
    return undefined
  return desktop as typeof desktop & SchedulerBridge
}
