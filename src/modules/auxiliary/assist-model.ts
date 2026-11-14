import type { Conversation } from '@/shared/contracts/backend'

export type AssistTab = 'consult' | 'handoff' | 'ticket' | 'aftersale'
export const conversationKey = (row: Pick<Conversation, 'storeId' | 'uid'>) =>
  JSON.stringify([row.storeId, row.uid])
export const conversationVersion = (row: Conversation) =>
  JSON.stringify([row.updatedAt, row.messages.at(-1)?.ts, row.messages.at(-1)?.content, row.status])
export function conversationTime(row: Conversation): number {
  return row.updatedAt ?? row.messages.at(-1)?.ts ?? 0
}
export function relativeTime(at: number, now = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return '时间未知'
  const minutes = Math.max(0, Math.floor((now - at) / 60000))
  return minutes < 1
    ? '刚刚'
    : minutes < 60
      ? `${minutes}分钟前`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}小时前`
        : `${Math.floor(minutes / 1440)}天前`
}

/** 首次快照仅作基线；同一事项同一版本只响一次，不把历史刷新当新提醒。 */
export function createAssistAlertTracker() {
  let workspace = '',
    baseline = false
  let current = new Set<string>()
  const history = new Set<string>()
  return {
    reset() {
      baseline = false
      current.clear()
      history.clear()
    },
    update(workspaceId: string, events: readonly string[]): boolean {
      if (workspaceId !== workspace) {
        workspace = workspaceId
        baseline = false
        current.clear()
        history.clear()
      }
      const next = new Set(events)
      const fresh = events.some((event) => !current.has(event) && !history.has(event))
      for (const event of current) if (!next.has(event)) history.add(event)
      while (history.size > 2000) history.delete(history.values().next().value!)
      // 当前快照必须完整保留；只限制已经离开快照的历史，避免大列表反复响铃。
      current = next
      const alert = baseline && fresh
      baseline = true
      return alert
    },
  }
}
