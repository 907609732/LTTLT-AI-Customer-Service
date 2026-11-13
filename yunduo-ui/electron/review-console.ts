import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { BackendSnapshot } from '../src/shared/contracts/backend'
import { pageReviewFingerprint, pageReviewSchema } from './conversation-review'
import { MessageDiagnostics, aiState, type WorkerObservation } from './message-diagnostics'
import {
  reviewDecisionSchema,
  compressionInfoSchema,
  type LogEntry,
  type ModelTrace,
  type ReplyReview,
} from '../src/shared/contracts/review'

const threadSchema = z.array(
  z.object({
    from: z.string(),
    content: z.string().default(''),
    ts: z.number().optional(),
    msgId: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
  }),
)
type Thread = z.infer<typeof threadSchema>
export interface SendProposal {
  storeId: string
  uid: string
  text: string
  thread: unknown
  isCurrent(): boolean
  getHistory(): Promise<{ known: boolean; messages: unknown }>
  pageReview?: unknown
  getPageReview?: (focus?: boolean) => Promise<unknown>
  retryNewMessage?: boolean
}
type Pending = {
  row: ReplyReview
  resolve: (approved: boolean) => void
  proposal: SendProposal
  baseline: string
  timer: ReturnType<typeof setInterval>
  checking?: boolean
}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
// 仅输出请求正文；不接收 HTTP 头、Key 或完整错误响应，避免凭证流入调试窗口。
const redact = (value: string) =>
  value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[密钥已隐藏]')
const json = (value: unknown, limit = 120000) => {
  const encoded = redact(JSON.stringify(value, null, 2) || '')
  return encoded.length > limit ? encoded.slice(0, limit) + '\n[内容超出调试上限，已截断]' : encoded
}

/** 候选确认留在主进程，重启不恢复批准状态；所有实际发送继续经过原引擎。 */
export class ReviewConsole {
  private logs: LogEntry[] = []
  private traces: ModelTrace[] = []
  private traceStarted = new Map<string, number>()
  private replies: ReplyReview[] = []
  private pending = new Map<string, Pending>()
  private seen = new Set<string>()
  private closed = false
  private initialized = false
  private messageDiagnostics: MessageDiagnostics
  constructor(
    private read: () => BackendSnapshot,
    private changed: () => void,
    worker: (storeId: string) => WorkerObservation | undefined = () => undefined,
  ) {
    this.messageDiagnostics = new MessageDiagnostics(read, worker)
  }
  snapshot() {
    return { logs: this.logs, traces: this.traces, replies: this.replies }
  }
  private identity(storeId: string, uid: string) {
    const snap = this.read()
    return {
      storeId,
      uid,
      storeName: snap.stores.find((s) => s.id === storeId)?.storeName || storeId || '全局',
      buyerName:
        snap.conversations.find((c) => c.storeId === storeId && c.uid === uid)?.name ||
        uid ||
        '训练/测试',
    }
  }
  private fingerprint(storeId: string, uid: string) {
    return JSON.stringify(
      (
        this.read().conversations.find((c) => c.storeId === storeId && c.uid === uid)?.messages ||
        []
      ).map((m) => ({
        from: m.from,
        type: m.type,
        content: m.content.replace(/\r\n?/g, '\n').normalize('NFC'),
      })),
    )
  }
  private log(kind: string, body: string, storeId = '', uid = '', at = Date.now()) {
    const entry: LogEntry = {
      id: randomUUID(),
      at,
      ...this.identity(storeId, uid),
      kind,
      text: redact(body).slice(0, 12000),
    }
    this.logs.push(entry)
    this.logs = this.logs.sort((a, b) => a.at - b.at).slice(-500)
    this.changed()
    return entry
  }
  sync() {
    if (this.closed) return
    const snap = this.read()
    for (const c of snap.conversations)
      for (const m of c.messages) {
        const key = `${c.storeId}:${c.uid}:${m.from}:${m.ts}:${m.content}`
        if (this.seen.has(key)) continue
        this.seen.add(key)
        const entry = this.log(
          m.from === 'buyer' ? '买家消息' : '客服消息',
          m.content,
          c.storeId,
          c.uid,
          m.ts,
        )
        if (m.from === 'buyer') this.messageDiagnostics.register(entry, m, !this.initialized)
      }
    // 去重集合有界；归档本身最多 200 个会话，每个 100 条消息。
    if (this.seen.size > 25000) this.seen = new Set([...this.seen].slice(-20000))
    this.initialized = true
    this.messageDiagnostics.refresh(this.logs)
    for (const item of this.pending.values())
      if (!this.current(item))
        this.finish(item, 'expired', '出现新消息、人工回复、店铺断开或 AI 状态变化，旧候选已作废。')
  }
  event(input: unknown) {
    if (!input || typeof input !== 'object' || this.closed) return
    const event = input as Record<string, unknown>,
      type = text(event.type),
      storeId = text(event.storeId),
      uid = text(event.uid)
    if (type === 'reply:decision') {
      const stage = text(event.stage)
      const allowed = ['waiting', 'blocked', 'preparing', 'skipped', 'failed'] as const
      if (allowed.includes(stage as (typeof allowed)[number]))
        this.messageDiagnostics.record(
          storeId,
          uid,
          this.messageDiagnostics.refs(event),
          aiState(stage as (typeof allowed)[number], text(event.code), text(event.reason)),
        )
      this.changed()
      return
    }
    // 轮询节流是正常调度，不进入用户日志缓冲，避免挤掉实际消息和异常。
    if (type === 'reply:throttled') return
    if (type === 'reply:sent' || type === 'reply:review-result' || type === 'reply:transfer') {
      const row = [...this.replies]
        .reverse()
        .find((r) => r.storeId === storeId && r.uid === uid && r.status === 'sending')
      if (row) {
        const success = type === 'reply:sent' || event.ok === true || event.sent === true
        row.status = success ? 'sent' : 'failed'
        row.reason = success
          ? '平台已确认发送'
          : '发送失败、会话已改变或结果不确定，请在平台核对，不自动重发。'
        if (row.traceId)
          this.messageDiagnostics.byTrace(
            row.traceId,
            aiState(
              success ? 'sent' : 'failed',
              success ? 'sent' : 'delivery_failed',
              row.reason,
              true,
              row.traceId,
            ),
          )
      }
    }
    if (type === 'reply:failed' || type === 'reply:error') {
      for (const row of this.replies.filter(
        (r) => r.storeId === storeId && r.uid === uid && r.status === 'sending',
      )) {
        row.status = 'failed'
        row.reason = '发送失败或结果不确定，请在平台核对，不自动重发。'
      }
    }
    if (/^(shop:|collection:|reply:)/.test(type))
      this.log(
        type,
        [
          text(event.text),
          text(event.reason),
          type === 'reply:error' ? '处理失败，请检查模型配置或平台状态' : '',
        ]
          .filter(Boolean)
          .join('\n') || type,
        storeId,
        uid,
      )
  }
  trace(input: unknown): string | undefined {
    if (!input || typeof input !== 'object' || this.closed) return
    const event = input as Record<string, unknown>
    const context =
      event.reviewContext && typeof event.reviewContext === 'object'
        ? (event.reviewContext as Record<string, unknown>)
        : {}
    const storeId = text(context.storeId),
      uid = text(context.uid)
    if (event.type === 'compression-failed') {
      this.log('上下文压缩失败', text(event.reason), storeId, uid)
      return
    }
    if (event.type === 'request') {
      const id = randomUUID()
      const compression = compressionInfoSchema.safeParse(event.compression)
      this.traces.push({
        id,
        at: Date.now(),
        startedAt:
          typeof event.startedAt === 'number' && Number.isFinite(event.startedAt)
            ? event.startedAt
            : Date.now(),
        ...this.identity(storeId, uid),
        model: text(event.model),
        messages: json(event.messages),
        thread: json(event.thread),
        reply: '',
        error: '',
        purpose: event.purpose === 'compression' ? 'compression' : 'reply',
        ...(compression.success
          ? { compression: { ...compression.data, summary: redact(compression.data.summary) } }
          : {}),
      })
      this.traces = this.traces.slice(-40)
      this.traceStarted.set(id, performance.now())
      this.messageDiagnostics.record(
        storeId,
        uid,
        this.messageDiagnostics.refs(context),
        aiState(
          'preparing',
          event.purpose === 'compression' ? 'context_compressing' : 'model_prepared',
          event.purpose === 'compression'
            ? '正在压缩上下文，正式回复请求尚未提交。'
            : '上下文已构造，尚未发起正式模型请求。',
          false,
          id,
        ),
      )
      const retained = new Set(this.traces.map((row) => row.id))
      for (const key of this.traceStarted.keys())
        if (!retained.has(key)) this.traceStarted.delete(key)
      this.log(
        event.purpose === 'compression' ? '上下文摘要请求' : 'AI 请求',
        compression.success && compression.data.triggered
          ? `上下文压缩：${compression.data.beforeTokens} → ${compression.data.afterTokens} 估算 token（16K 触发，目标 8K）。`
          : '已按时间合并本机已采集聊天、可读的平台历史及当前消息；展开请求查看实际上下文。',
        storeId,
        uid,
      )
      return id
    }
    const row = this.traces.find((t) => t.id === event.traceId)
    if (row) {
      if (event.type === 'submitted') {
        row.submittedAt = Date.now()
        this.messageDiagnostics.byTrace(
          row.id,
          aiState(
            row.purpose === 'compression' ? 'preparing' : 'requesting',
            row.purpose === 'compression' ? 'context_compressing' : 'model_submitted',
            row.purpose === 'compression'
              ? '正在压缩上下文：摘要请求已发起，正式回复尚未提交。'
              : '已发起正式 AI 请求，等待模型生成正文。',
            row.purpose === 'compression' ? false : true,
            row.id,
          ),
        )
      }
      if ((event.type === 'result' || event.type === 'error') && row.completedAt === undefined) {
        row.completedAt = Date.now()
        // 正式回复由 AiClient 提供完整生成耗时（含上下文准备/压缩）；摘要回合从请求记录开始。
        row.durationMs =
          typeof event.durationMs === 'number' &&
          Number.isFinite(event.durationMs) &&
          event.durationMs >= 0
            ? Math.round(event.durationMs)
            : Math.max(
                0,
                Math.round(
                  performance.now() - (this.traceStarted.get(row.id) ?? performance.now()),
                ),
              )
        this.traceStarted.delete(row.id)
      }
      if (event.type === 'result') {
        row.reply = redact(text(event.reply))
        if (row.purpose === 'reply')
          this.messageDiagnostics.byTrace(
            row.id,
            aiState(
              'generated',
              'generated',
              '正文已生成，等待形成发送候选。',
              row.submittedAt !== undefined,
              row.id,
            ),
          )
        this.log(row.purpose === 'compression' ? '摘要结果' : 'AI 生成', row.reply, storeId, uid)
      }
      if (event.type === 'error') {
        row.error = text(event.error)
        this.messageDiagnostics.byTrace(
          row.id,
          aiState(
            'failed',
            'model_failed',
            '模型处理失败：' + row.error,
            row.submittedAt !== undefined && row.purpose === 'reply',
            row.id,
          ),
        )
        this.log('AI 失败', row.error, storeId, uid)
      }
    }
    this.changed()
  }
  private current(item: Pending) {
    return (
      !this.closed &&
      item.proposal.isCurrent() &&
      this.fingerprint(item.row.storeId, item.row.uid) === item.baseline &&
      !!this.read().stores.find((s) => s.id === item.row.storeId && s.runtime.online && s.aiEnabled)
    )
  }
  /** 复核平台最新历史，防止确认期间刚到的新消息尚未来得及写入本机归档。 */
  private newPageBuyer(before: unknown, after: unknown) {
    const a = pageReviewSchema.safeParse(before),
      b = pageReviewSchema.safeParse(after)
    return (
      a.success &&
      b.success &&
      a.data.known &&
      b.data.known &&
      a.data.page === b.data.page &&
      a.data.uid === b.data.uid &&
      b.data.messages.at(-1)?.from === 'buyer' &&
      pageReviewFingerprint(before) !== pageReviewFingerprint(after)
    )
  }
  private async historyCurrent(
    proposal: SendProposal,
  ): Promise<
    { ok: true } | { ok: false; retryable: boolean; reason: string; retryNewMessage?: boolean }
  > {
    if (proposal.getPageReview) {
      const baseline = pageReviewFingerprint(proposal.pageReview)
      if (!baseline)
        return {
          ok: false,
          retryable: false,
          reason: '生成前未能取得这位买家的网页消息基线，请恢复本会话 AI 重新生成。',
        }
      let latest: unknown
      try {
        latest = await proposal.getPageReview(true)
      } catch {
        return {
          ok: false,
          retryable: true,
          reason: '网页消息读取暂时失败，未发送。请打开该买家会话后再次确认。',
        }
      }
      const current = pageReviewFingerprint(latest)
      if (!current)
        return {
          ok: false,
          retryable: true,
          reason: '暂时无法核对这位买家的网页消息，未发送。请打开该会话，等待消息加载后再次确认。',
        }
      return current === baseline
        ? { ok: true }
        : {
            ok: false,
            retryable: false,
            reason: '检测到该买家网页消息已变化，旧候选已失效，请重新生成。',
            retryNewMessage: this.newPageBuyer(proposal.pageReview, latest),
          }
    }
    const baseline = threadSchema.safeParse(proposal.thread)
    const latest = await proposal.getHistory()
    if (!latest.known)
      return {
        ok: false,
        retryable: true,
        reason: '平台历史暂时读取失败，未发送。候选已保留，请稍后再次确认。',
      }
    const current = threadSchema.safeParse(latest.messages)
    if (!baseline.success || !current.success)
      return {
        ok: false,
        retryable: true,
        reason: '平台历史格式暂时无法核对，未发送，请稍后重试。',
      }
    const signature = (m: Thread[number]) => `${m.from}:${m.msgId || ''}:${m.ts || 0}:${m.content}`
    const keys = new Set(baseline.data.map(signature))
    const last = Math.max(0, ...baseline.data.map((m) => m.ts || 0))
    return current.data.some((m) => !keys.has(signature(m)) && (m.ts || 0) >= last)
      ? { ok: false, retryable: false, reason: '平台会话已有新消息，请重新生成。' }
      : { ok: true }
  }
  async propose(proposal: SendProposal): Promise<boolean> {
    if (this.closed || !proposal.isCurrent()) return false
    if (this.pending.size >= 100) {
      this.log(
        '候选未放行',
        '待确认候选已达 100 条，请先处理已有候选。',
        proposal.storeId,
        proposal.uid,
      )
      return false
    }
    if (redact(proposal.text) !== proposal.text) {
      this.log(
        '候选未放行',
        '回复包含疑似密钥，已阻止发送，请人工核对。',
        proposal.storeId,
        proposal.uid,
      )
      return false
    }
    if (
      (!Array.isArray(proposal.thread) || !proposal.thread.length) &&
      !pageReviewFingerprint(proposal.pageReview)
    ) {
      const history = await proposal.getHistory()
      if (!history.known) {
        this.log('候选未放行', '无法读取会话历史，未允许发送。', proposal.storeId, proposal.uid)
        return false
      }
      proposal.thread = history.messages
    }
    const previous = [...this.pending.values()].find(
      (p) => p.row.storeId === proposal.storeId && p.row.uid === proposal.uid,
    )
    if (previous) this.finish(previous, 'expired', '已被新的候选替代')
    const trace = [...this.traces]
      .reverse()
      .find(
        (t) => t.storeId === proposal.storeId && t.uid === proposal.uid && t.purpose === 'reply',
      )
    const row: ReplyReview = {
      id: randomUUID(),
      at: Date.now(),
      ...this.identity(proposal.storeId, proposal.uid),
      text: redact(proposal.text),
      traceId: trace?.id || '',
      status: 'pending',
      reason: '等待你确认后才发送；关闭日志窗不会发送。',
    }
    if (row.traceId)
      this.messageDiagnostics.byTrace(
        row.traceId,
        aiState(
          'confirming',
          'awaiting_confirmation',
          '已生成回复，等待你确认；尚未向买家发送。',
          null,
          row.traceId,
        ),
      )
    return new Promise<boolean>((resolve) => {
      const item: Pending = {
        row,
        resolve,
        proposal,
        baseline: this.fingerprint(row.storeId, row.uid),
        timer: setInterval(() => {
          if (!this.current(item) || Date.now() - row.at > 10 * 60 * 1000)
            this.finish(item, 'expired', '候选已过期或会话状态改变，请恢复会话 AI 重新生成。')
          else if (proposal.getPageReview && !item.checking) {
            item.checking = true
            void proposal
              .getPageReview(false)
              .then((snapshot) => {
                const before = pageReviewFingerprint(proposal.pageReview),
                  after = pageReviewFingerprint(snapshot)
                if (before && after && before !== after && this.pending.get(row.id) === item) {
                  item.proposal.retryNewMessage = this.newPageBuyer(proposal.pageReview, snapshot)
                  this.finish(item, 'expired', '检测到该买家网页消息已变化，旧候选已作废。')
                }
              })
              .catch(() => {})
              .finally(() => {
                item.checking = false
              })
          }
        }, 500),
      }
      item.timer.unref?.()
      this.replies.push(row)
      this.replies = this.replies
        .filter((r) => r.status === 'pending' || r.status === 'sending')
        .concat(
          this.replies.filter((r) => r.status !== 'pending' && r.status !== 'sending').slice(-100),
        )
      this.pending.set(row.id, item)
      this.log('待确认发送', proposal.text, proposal.storeId, proposal.uid)
    })
  }
  private finish(item: Pending, status: 'rejected' | 'expired', reason: string) {
    if (status === 'expired') {
      const current = this.read().conversations.find(
        (c) => c.storeId === item.row.storeId && c.uid === item.row.uid,
      )
      item.proposal.retryNewMessage =
        item.proposal.retryNewMessage === true ||
        (!!current?.messages.length &&
          current.messages.at(-1)?.from === 'buyer' &&
          this.fingerprint(item.row.storeId, item.row.uid) !== item.baseline)
    }
    clearInterval(item.timer)
    this.pending.delete(item.row.id)
    item.row.status = status
    if (status === 'expired' && item.proposal.retryNewMessage)
      reason = '买家有新消息，旧候选已作废；引擎会继续处理最新消息，无需因此手动恢复会话。'
    item.row.reason = reason
    item.resolve(false)
    if (item.row.traceId)
      this.messageDiagnostics.byTrace(
        item.row.traceId,
        aiState('canceled', status, reason, null, item.row.traceId),
      )
    this.log(
      status === 'rejected' ? '已拒绝发送' : '候选失效',
      reason,
      item.row.storeId,
      item.row.uid,
    )
  }
  async decide(input: unknown) {
    const value = reviewDecisionSchema.parse(input),
      item = this.pending.get(value.id)
    if (!item || item.row.status !== 'pending') throw new Error('候选已处理或失效，不能重复发送')
    if (!value.approve) {
      this.finish(item, 'rejected', '你已取消发送，本会话暂停 AI；可在辅助中心恢复。')
      return
    }
    if (!this.current(item)) {
      this.finish(item, 'expired', '会话或店铺状态已变化，未发送，请重新生成。')
      throw new Error(item.row.reason)
    }
    const history = await this.historyCurrent(item.proposal)
    if (this.pending.get(value.id) !== item || item.row.status !== 'pending')
      throw new Error('候选已在其他窗口处理或失效')
    if (!this.current(item)) {
      this.finish(item, 'expired', '复核期间会话或店铺状态已变化，未发送，请重新生成。')
      throw new Error(item.row.reason)
    }
    if (!history.ok) {
      item.proposal.retryNewMessage = history.retryNewMessage === true
      if (history.retryable) {
        item.row.reason = history.reason
        this.log('确认暂未放行', history.reason, item.row.storeId, item.row.uid)
      } else this.finish(item, 'expired', history.reason)
      throw new Error(history.reason)
    }
    // 异步复核期间另一窗口可能已批准；第二次检查确保一次确认只能放行一次。
    if (!this.pending.has(value.id)) throw new Error('候选已在其他窗口处理')
    clearInterval(item.timer)
    this.pending.delete(value.id)
    item.row.status = 'sending'
    item.row.reason = '你已确认，正在等待平台发送结果。'
    if (item.row.traceId)
      this.messageDiagnostics.byTrace(
        item.row.traceId,
        aiState(
          'sending',
          'sending',
          '你已确认，正在逐字输入并等待平台发送确认。',
          true,
          item.row.traceId,
        ),
      )
    this.log('确认发送', item.proposal.text, item.row.storeId, item.row.uid)
    item.resolve(true)
  }
  dispose() {
    this.closed = true
    for (const item of this.pending.values())
      this.finish(item, 'expired', '本地服务已关闭，不会发送')
    this.logs = []
    this.traces = []
    this.traceStarted.clear()
    this.messageDiagnostics.clear()
    this.replies = []
  }
}
