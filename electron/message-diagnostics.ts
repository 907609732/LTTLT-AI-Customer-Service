import { createHash } from 'node:crypto'
import type { LogEntry, MessageAiState } from '../src/shared/contracts/review'
import type { BackendSnapshot } from '../src/shared/contracts/backend'

export interface WorkerObservation {
  running: boolean
  paused: boolean
  degraded: boolean
  inflight: number
  manualSuppressed: Set<string>
  suppressionSources: Map<string, string>
  processing: Set<string>
  lastSentAt: Map<string, number>
  lastMerchantAt: Map<string, number>
  sendWindow: number[]
  cfg: { perUidMinIntervalMs?: number; perStorePerMinuteMax?: number; maxInflight?: number }
}
interface Ref {
  msgId?: string
  ts?: number
  content?: string
}
interface Identity {
  id: string
  ts: number
  hash: string
}
interface Tracked {
  log: LogEntry
  ref: Identity
  restored: boolean
}
const identity = (value: Ref): Identity => ({
  id: String(value.msgId || ''),
  ts: Number(value.ts) || 0,
  hash: createHash('sha256')
    .update(String(value.content || '').replace(/\r\n?/g, '\n'))
    .digest('hex'),
})
const match = (a: Identity, b: Identity) => {
  if (a.id && b.id && a.id === b.id) return true
  if (a.id && b.id && !/^(dom:|st:|ts:)/.test(a.id) && !/^(dom:|st:|ts:)/.test(b.id)) return false
  return a.hash === b.hash && Math.abs(a.ts - b.ts) <= 8000
}
export const aiState = (
  stage: MessageAiState['stage'],
  code: string,
  reason: string,
  submitted: boolean | null = false,
  traceId?: string,
): MessageAiState => ({
  stage,
  code,
  reason,
  submitted,
  updatedAt: Date.now(),
  ...(traceId ? { traceId } : {}),
})

/** 同一条买家消息更新状态，不追加轮询噪声；仅有请求发起事件才标记已交给 AI。 */
export class MessageDiagnostics {
  private rows = new Map<string, Tracked>()
  private evidence: { storeId: string; uid: string; refs: Identity[]; state: MessageAiState }[] = []
  constructor(
    private read: () => BackendSnapshot,
    private worker: (storeId: string) => WorkerObservation | undefined = () => undefined,
  ) {}
  private inferred(row: Tracked): MessageAiState {
    if (row.restored)
      return aiState(
        'unknown',
        'historical_unknown',
        '历史消息：本次运行没有对应调用证据，无法还原当时是否交给 AI。',
        null,
      )
    const snap = this.read(),
      store = snap.stores.find((s) => s.id === row.log.storeId),
      worker = this.worker(row.log.storeId),
      uid = row.log.uid
    if (!store?.runtime.online)
      return aiState('blocked', 'store_offline', '未交给 AI：店铺未连接或消息采集未就绪。')
    if (!store.aiEnabled)
      return aiState('blocked', 'store_ai_off', '未交给 AI：本店 AI 开关未开启。')
    if (!snap.config.reply.enabled)
      return aiState('blocked', 'global_ai_off', '未交给 AI：全局 AI 回复已关闭。')
    if (!worker?.running)
      return aiState('waiting', 'worker_not_running', '尚未交给 AI：回复引擎尚未启动或正在切换。')
    if (worker.paused) return aiState('blocked', 'ai_paused', '未交给 AI：该店铺 AI 已暂停。')
    if (worker.manualSuppressed.has(uid)) {
      const source = worker.suppressionSources.get(uid) || 'manual'
      const reasons: Record<string, string> = {
        review: '此前取消/过期候选使本会话暂停，请先恢复本会话 AI。',
        quality: '此前生成或发送异常需要人工核对，请检查质检/发送记录后恢复。',
        vision: '图片处理失败使本会话暂停，请检查识图配置后恢复。',
        manual: '本会话已被人工接管，请明确恢复本会话 AI。',
      }
      return aiState(
        'blocked',
        'suppressed_' + source,
        '未交给 AI：' + (reasons[source] || reasons.manual),
      )
    }
    if (worker.degraded)
      return aiState(
        'waiting',
        'adapter_unavailable',
        '尚未交给 AI：平台页面/队列适配器暂时不可用。',
      )
    const wait =
      (worker.lastSentAt.get(uid) || 0) + (worker.cfg.perUidMinIntervalMs ?? 60000) - Date.now()
    if (worker.lastSentAt.has(uid) && wait > 0)
      return aiState(
        'waiting',
        'uid_interval',
        `尚未交给 AI：同一买家回复间隔为 ${(worker.cfg.perUidMinIntervalMs ?? 60000) / 1000} 秒，约 ${Math.ceil(wait / 1000)} 秒后重试。`,
      )
    const limit = worker.cfg.perStorePerMinuteMax ?? 20
    if (limit > 0 && worker.sendWindow.filter((t) => Date.now() - t < 60000).length >= limit)
      return aiState(
        'waiting',
        'store_rate',
        `尚未交给 AI：本店每分钟 ${limit} 次发送上限，等待窗口恢复。`,
      )
    if (worker.processing.has(uid))
      return aiState('preparing', 'processing', '引擎正在处理本会话，尚无正式模型请求发起记录。')
    if (worker.inflight >= (worker.cfg.maxInflight ?? 6))
      return aiState(
        'waiting',
        'max_inflight',
        '尚未交给 AI：当前生成/待确认任务已占满并发名额，等待其他任务完成。',
      )
    if (Date.now() - row.log.at > 10000)
      return aiState(
        'waiting',
        'queue_unconfirmed',
        '消息已采集，但尚无队列消费或模型请求证据；请检查待回复队列，不代表 AI 已收到。',
      )
    return aiState('waiting', 'collected', '消息已采集，等待回复引擎调度，尚未交给 AI。')
  }
  register(log: LogEntry, raw: Ref, restored: boolean) {
    const row = { log, ref: identity(raw), restored }
    this.rows.set(log.id, row)
    const evidence = [...this.evidence]
      .reverse()
      .find(
        (e) =>
          e.storeId === log.storeId &&
          e.uid === log.uid &&
          e.refs.some((ref) => match(ref, row.ref)),
      )
    log.ai = evidence ? { ...evidence.state } : this.inferred(row)
    if (evidence) row.restored = false
  }
  refresh(logs: LogEntry[]) {
    const live = new Set(logs.map((log) => log.id))
    for (const [id, row] of this.rows) {
      if (!live.has(id)) {
        this.rows.delete(id)
        continue
      }
      if (
        !row.log.ai ||
        (['unknown', 'waiting', 'blocked', 'preparing'].includes(row.log.ai.stage) &&
          row.log.ai.submitted !== true)
      ) {
        const inferred = this.inferred(row)
        if (
          row.log.ai?.stage === 'preparing' &&
          ['model_prepared', 'context_compressing', 'claimed'].includes(row.log.ai.code) &&
          inferred.stage !== 'blocked'
        )
          continue
        row.log.ai = inferred
      }
    }
  }
  record(storeId: string, uid: string, refs: Ref[], state: MessageAiState) {
    if (!storeId || !uid) return
    const ids = refs.map(identity)
    if (ids.length) {
      const index = this.evidence.findIndex(
        (e) =>
          e.storeId === storeId && e.uid === uid && JSON.stringify(e.refs) === JSON.stringify(ids),
      )
      if (index >= 0) {
        const old = this.evidence[index]
        if (
          old.state.submitted === true &&
          !state.traceId &&
          ['waiting', 'blocked', 'preparing', 'skipped'].includes(state.stage)
        )
          return
        state = { ...state, submitted: old.state.submitted === true ? true : state.submitted }
        this.evidence.splice(index, 1)
      }
      this.evidence.push({ storeId, uid, refs: ids, state })
      this.evidence = this.evidence.slice(-1000)
    }
    for (const row of this.rows.values()) {
      if (
        row.log.storeId !== storeId ||
        row.log.uid !== uid ||
        !ids.some((ref) => match(ref, row.ref))
      )
        continue
      row.restored = false
      if (row.log.ai?.stage === 'sent') continue
      if (
        row.log.ai?.submitted === true &&
        !state.traceId &&
        ['waiting', 'blocked', 'preparing', 'skipped'].includes(state.stage)
      )
        continue
      row.log.ai = { ...state, submitted: row.log.ai?.submitted === true ? true : state.submitted }
    }
  }
  byTrace(traceId: string, state: MessageAiState) {
    for (const row of this.rows.values())
      if (row.log.ai?.traceId === traceId)
        row.log.ai = {
          ...state,
          traceId,
          submitted:
            row.log.ai.submitted === true || state.submitted === true
              ? true
              : (state.submitted ?? row.log.ai.submitted),
        }
    for (const evidence of this.evidence)
      if (evidence.state.traceId === traceId)
        evidence.state = {
          ...state,
          traceId,
          submitted:
            evidence.state.submitted === true || state.submitted === true
              ? true
              : (state.submitted ?? evidence.state.submitted),
        }
  }
  refs(context: unknown): Ref[] {
    if (!context || typeof context !== 'object') return []
    const refs = Reflect.get(context, 'buyers')
    if (Array.isArray(refs)) return refs.filter((r): r is Ref => !!r && typeof r === 'object')
    const content = Reflect.get(context, 'buyerMessage')
    return typeof content === 'string'
      ? [
          {
            content,
            ts: Number(Reflect.get(context, 'buyerTs')) || 0,
            msgId: String(Reflect.get(context, 'buyerMsgId') || ''),
          },
        ]
      : []
  }
  clear() {
    this.rows.clear()
    this.evidence = []
  }
}
