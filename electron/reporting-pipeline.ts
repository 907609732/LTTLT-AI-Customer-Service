import { createHash } from 'node:crypto'
import path from 'node:path'
import type { BackendSnapshot } from '../src/shared/contracts/backend'
import type { ReportingSnapshot } from '../src/shared/contracts/reporting'
import type { PlatformItemsSnapshot } from '../src/shared/contracts/platform-items'
import { ReportingLedger, type ReportingEvidence } from './reporting-ledger'

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** 在受控主进程接入；observe 只消费已经采集的快照，绝不打开平台或发起模型请求。 */
export function createReportingPipeline(dataDir: string, clock: () => number = Date.now) {
  const ledger = new ReportingLedger(path.join(dataDir, 'reporting-events-v1.json'), clock)
  return {
    observe(snapshot: BackendSnapshot) {
      const stores = new Map(snapshot.stores.map((store) => [store.id, store]))
      const evidence: ReportingEvidence[] = []
      const push = (storeId: string, id: string, kind: ReportingEvidence['kind'], at: number) => {
        const store = stores.get(storeId)
        if (store) evidence.push({ storeId, platform: store.platform, id, kind, at })
      }
      for (const conversation of snapshot.conversations) {
        for (const message of conversation.messages) {
          if (message.from !== 'buyer' && message.from !== 'seller') continue
          // 归档消息来源标识可能变化，固定使用本机线程中的角色、时间和内容指纹。
          push(
            conversation.storeId,
            fingerprint([conversation.uid, message.from, message.ts, message.content]),
            message.from === 'buyer' ? 'buyer-message' : 'seller-message',
            message.ts,
          )
        }
      }
      for (const order of snapshot.workOrders)
        push(order.storeId, order.id, 'work-order-created', order.createdAt)
      for (const trace of snapshot.review.traces) {
        if (trace.purpose !== 'reply' || !trace.completedAt || !trace.submittedAt) continue
        if (trace.error) push(trace.storeId, trace.id, 'ai-failed', trace.completedAt)
        else if (trace.reply.trim())
          push(trace.storeId, trace.id, 'ai-generated', trace.completedAt)
      }
      for (const reply of snapshot.review.replies) {
        if (reply.status !== 'sent') continue
        // 审批记录 at 是候选创建时间；送达时间取对应诊断证据，未知时不伪造时间。
        const sent = snapshot.review.logs.find(
          (log) =>
            log.storeId === reply.storeId &&
            log.uid === reply.uid &&
            log.ai?.traceId === reply.traceId &&
            log.ai.stage === 'sent',
        )
        if (sent?.ai) push(reply.storeId, reply.traceId || reply.id, 'ai-sent', sent.ai.updatedAt)
      }
      return ledger.recordMany(evidence)
    },
    snapshot(platformItems?: PlatformItemsSnapshot): ReportingSnapshot {
      const now = clock(),
        midnight = new Date(now)
      midnight.setHours(0, 0, 0, 0)
      const tomorrow = new Date(midnight)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const start = (days: number) => {
        const day = new Date(midnight)
        day.setDate(day.getDate() - days)
        return day.getTime()
      }
      return {
        aftersales: (platformItems?.stores ?? [])
          .filter((store) => store.kind === 'aftersale')
          .map((store) => ({
            storeId: store.storeId,
            platform: store.platform,
            status: store.status,
            complete: store.complete && store.status === 'success',
            total: store.status === 'success' && store.complete ? store.total : null,
            observed: store.items.length,
            lastSyncedAt: store.lastSyncedAt ?? null,
            scope: 'current-merchant-pending',
            queryWindow: store.platform === 'pdd-web' ? 'last-3-months' : 'unknown',
          })),
        today: ledger.report(start(0), tomorrow.getTime()),
        yesterday: ledger.report(start(1), start(0)),
        week: ledger.report(start(6), tomorrow.getTime()),
        month: ledger.report(start(29), tomorrow.getTime()),
      }
    },
  }
}
