import { createHash } from 'node:crypto'
import type { SendProposal } from './review-console'
import type { StoreSendModeState } from '../src/shared/contracts/review'
import { pageReviewFingerprint, pageReviewSchema } from './conversation-review'

/** 批准时受控的网页基线；发送锁内只能与它比较，不能把此刻网页当新基线。 */
export interface ApprovedPageReview {
  uid: string
  page: string
  fingerprint: string
}
/** 兼容既有 consume 调用者：仍是可调用 guard，附带受控批准网页基线。 */
export type SendAuthorizationGuard = (() => boolean) & {
  approvalPage?: ApprovedPageReview
}
type Permit = { storeId: string; uid: string; guard: SendAuthorizationGuard }
const lifetimeMs = 10 * 60 * 1000
const keyFor = (storeId: string, uid: string, text: string) =>
  createHash('sha256')
    .update(JSON.stringify([storeId, uid, text.trim()]))
    .digest('hex')

/** 将同一批准的自动模式租约延续到排队、逐字输入和最终点击；不替代原发送确认门。 */
export class SendModeAuthorizations {
  private permits = new Map<string, Permit>()
  private attempts = new Map<string, symbol>()
  private closed = false
  constructor(private readMode: (storeId: string) => StoreSendModeState) {}

  async authorize(proposal: SendProposal, decision: () => Promise<boolean>): Promise<boolean> {
    if (this.closed) return false
    const key = keyFor(proposal.storeId, proposal.uid, proposal.text)
    // 不逐出旧许可：旧 AI 若已排队，丢掉其许可会被误认为不经此门的人工发送。
    if (!this.permits.has(key) && this.permits.size + this.attempts.size >= 100) return false
    const entry = { ...this.readMode(proposal.storeId) }
    const parsedPage = pageReviewSchema.safeParse(proposal.pageReview)
    const pageFingerprint = pageReviewFingerprint(proposal.pageReview)
    const approvalPage: ApprovedPageReview | undefined =
      parsedPage.success &&
      parsedPage.data.known &&
      parsedPage.data.uid &&
      parsedPage.data.page &&
      pageFingerprint
        ? {
            uid: parsedPage.data.uid,
            page: parsedPage.data.page,
            fingerprint: pageFingerprint,
          }
        : undefined
    this.permits.delete(key)
    const attempt = Symbol()
    this.attempts.set(key, attempt)
    const started = Date.now()
    const originalCurrent = proposal.isCurrent.bind(proposal)
    const guard: SendAuthorizationGuard = () => {
      if (this.closed || Date.now() - started > lifetimeMs) return false
      try {
        if (!originalCurrent()) return false
        const current = this.readMode(proposal.storeId)
        return (
          entry.mode !== 'auto' || (current.mode === 'auto' && current.revision === entry.revision)
        )
      } catch {
        return false
      }
    }
    proposal.isCurrent = guard
    try {
      if (!(await decision()) || !guard() || this.attempts.get(key) !== attempt) return false
      if (approvalPage) guard.approvalPage = approvalPage
      this.permits.set(key, { storeId: proposal.storeId, uid: proposal.uid, guard })
      return true
    } finally {
      if (this.attempts.get(key) === attempt) this.attempts.delete(key)
    }
  }

  consume(storeId: string, uid: string, text: string): SendAuthorizationGuard | undefined {
    if (this.closed) return () => false
    const key = keyFor(storeId, uid, text),
      permit = this.permits.get(key)
    if (!permit) return undefined
    this.permits.delete(key)
    // 即使许可已过期也返回拒绝的 guard；不能回退到不携带租约的旧人工入口。
    return permit.guard
  }

  /** 仅在 worker 已明确结束这次发送后清理未消费许可，不能依据超时推断发送已结束。 */
  release(storeId: string, uid: string) {
    for (const [key, permit] of this.permits)
      if (permit.storeId === storeId && permit.uid === uid) this.permits.delete(key)
  }

  dispose() {
    this.closed = true
    this.permits.clear()
    this.attempts.clear()
  }
}
