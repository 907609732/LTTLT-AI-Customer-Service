import type { KnowledgeRepository } from './repository'
export function createKnowledgeDailyCheck(options: {
  repository: KnowledgeRepository
  now?: () => number
  available(): boolean
  stores(): string[]
  start(storeId: string, bindingIds: string[]): Promise<{ jobId: string }>
}) {
  const repo = options.repository
  let closed = false,
    busy = false,
    timer: ReturnType<typeof setInterval> | undefined
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  async function tick() {
    if (closed || busy || repo.readOnly || !options.available()) return
    busy = true
    try {
      const settings = repo.getSettings(),
        now = (options.now ?? Date.now)()
      const p = Object.fromEntries(
        formatter.formatToParts(now).map((part) => [part.type, part.value]),
      )
      const day = `${p.year}-${p.month}-${p.day}`
      if (!settings.dailyCheckEnabled || `${p.hour}:${p.minute}` < settings.dailyCheckTime) return
      for (const storeId of options.stores()) {
        if (closed || !options.available()) return
        const key = `daily-check:${storeId}`
        if (repo.getMetadata(key) === day) continue
        if (repo.hasUnfinishedDailyCheck(storeId)) continue
        const bindingIds = repo
          .listBindings()
          .filter((b) => b.storeId === storeId && !b.skuId)
          .map((b) => b.id)
        if (!bindingIds.length) continue
        // Claim the day before starting I/O; restarting never repeats an uncertain collection.
        repo.setMetadata(key, day)
        try {
          await options.start(storeId, bindingIds)
        } catch (cause) {
          if (closed || !options.available()) return
          const job = repo.createJob({
            kind: 'daily-check',
            storeId,
            payload: { pendingDaily: true, bindingIds },
          })
          repo.updateJob(job.id, {
            expectedRevision: job.revision,
            status: 'paused',
            error: (cause instanceof Error ? cause.message : '每日检查未完成，请人工继续').slice(
              0,
              4000,
            ),
          })
        }
      }
    } finally {
      busy = false
    }
  }
  return {
    tick,
    start() {
      if (!closed && !timer) {
        void tick().catch(() => {})
        timer = setInterval(() => {
          void tick().catch(() => {})
        }, 30000)
        timer.unref?.()
      }
    },
    dispose() {
      closed = true
      if (timer) clearInterval(timer)
    },
  }
}
