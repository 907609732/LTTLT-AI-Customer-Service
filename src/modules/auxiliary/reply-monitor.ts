import type { BackendSnapshot, Conversation, LocalStore } from '@/shared/contracts/backend'
import type { LogEntry, ReplyReview } from '@/shared/contracts/review'

export interface MonitorProduct {
  productId: string
  title: string
  imageUrl: string
}
export interface MonitorBubble {
  key: string
  side: 'buyer' | 'seller' | 'system' | 'candidate'
  label: string
  text: string
  at: number
  status?: ReplyReview['status']
}
export interface MonitorSelection {
  reply?: ReplyReview
  log?: LogEntry
  store?: LocalStore
  conversation?: Conversation
  product?: MonitorProduct
  bubbles: MonitorBubble[]
  pendingCount: number
  status: string
  reason: string
}

const lifecycleLogKinds = new Set([
  '确认发送',
  '自动模式放行',
  '自动发送复核',
  '待确认发送',
  '确认暂未放行',
  '已拒绝发送',
  '候选失效',
  '客服消息',
])
const replyStatusLabels: Record<ReplyReview['status'], string> = {
  pending: '等待确认',
  sending: '发送中',
  sent: '已发送',
  rejected: '已取消',
  expired: '已失效',
  failed: '需核对发送',
}
const candidateLabels: Partial<Record<ReplyReview['status'], string>> = {
  pending: '候选 · 未发送',
  sending: '候选 · 等待回执',
  sent: '候选 · 平台已确认',
  failed: '候选 · 发送未确认',
}

/** 沿用原监控的候选选择顺序，避免新消息日志把尚待处理或发送中的候选遮住。 */
function selectReply(snapshot: BackendSnapshot): ReplyReview | undefined {
  const pending = snapshot.review.replies.filter((row) => row.status === 'pending')
  if (pending.length) return pending[0]
  const recent = [...snapshot.review.replies].sort((a, b) => b.at - a.at)
  const sending = recent.find((row) => row.status === 'sending')
  if (sending) return sending
  const latest = recent[0],
    log = snapshot.review.logs.at(-1)
  if (!latest || !log || latest.at >= log.at) return latest
  // 发送日志晚于候选创建时间；同会话的发送生命周期继续展示候选的实际状态。
  const related = log.storeId === latest.storeId && log.uid === latest.uid
  return related && (log.kind.startsWith('reply:') || lifecycleLogKinds.has(log.kind))
    ? latest
    : undefined
}

function displayText(message: Conversation['messages'][number]): string {
  const type = message.type || 'text'
  if (type === 'text') return message.content
  const marker = type === 'image' ? '[图片]' : type === 'video' ? '[视频]' : `[${type}]`
  return message.content ? `${marker} ${message.content}` : marker
}

function productOf(value: ReplyReview['product'] | undefined): MonitorProduct | undefined {
  if (!value) return undefined
  const productId = typeof value.productId === 'string' ? value.productId.trim() : ''
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const imageUrl = typeof value.imageUrl === 'string' ? value.imageUrl.trim() : ''
  return productId || title || imageUrl ? { productId, title, imageUrl } : undefined
}

function sellerEchoesCandidate(conversation: Conversation | undefined, reply: ReplyReview) {
  if (reply.status !== 'sent') return false
  const text = reply.text.trim()
  return (
    !!text &&
    !!conversation?.messages.some(
      (message) =>
        message.from === 'seller' && message.ts >= reply.at && message.content.trim() === text,
    )
  )
}

/**
 * 监控只读投影：会话严格按 storeId + uid 匹配；商品只来自本次候选的 trace 或同一买家
 * 最近一次生成，绝不把另一会话的推荐商品、模型正文或店铺目录补进来。
 */
export function selectReplyMonitor(snapshot: BackendSnapshot): MonitorSelection {
  const reply = selectReply(snapshot)
  const latestLog = snapshot.review.logs.at(-1)
  const logsNewestFirst = [...snapshot.review.logs].reverse()
  const tracesNewestFirst = [...snapshot.review.traces].reverse()
  const identity =
    reply ??
    logsNewestFirst.find((entry) => entry.storeId && entry.uid) ??
    tracesNewestFirst.find((trace) => trace.storeId && trace.uid)
  const { storeId = '', uid = '' } = identity ?? {}
  const log = identity
    ? logsNewestFirst.find((entry) => entry.storeId === storeId && entry.uid === uid)
    : latestLog
  const conversation = snapshot.conversations.find(
    (row) => row.storeId === storeId && row.uid === uid,
  )
  const fallbackStoreId = snapshot.selection.storeId || snapshot.stores[0]?.id || ''
  const store = snapshot.stores.find((row) => row.id === (storeId || fallbackStoreId))
  const bubbles: MonitorBubble[] = []
  if (conversation)
    conversation.messages.forEach((message, index) => {
      const side =
        message.from === 'buyer' ? 'buyer' : message.from === 'seller' ? 'seller' : 'system'
      bubbles.push({
        key: `${storeId}:${uid}:${index}:${message.msgId || message.ts}`,
        side,
        label:
          side === 'buyer'
            ? '买家'
            : side === 'seller'
              ? '我方'
              : message.from === 'system'
                ? '系统'
                : '未识别来源',
        text: displayText(message),
        at: message.ts,
      })
    })
  else if (log && (log.kind === '买家消息' || log.kind === '客服消息'))
    // 归档尚未出现时，真实消息事件仍按明确来源显示；系统/未知事件不会被当成买卖方。
    bubbles.push({
      key: `log:${log.id}`,
      side: log.kind === '买家消息' ? 'buyer' : 'seller',
      label: log.kind === '买家消息' ? '买家' : '我方',
      text: log.text,
      at: log.at,
    })
  if (reply && candidateLabels[reply.status] && !sellerEchoesCandidate(conversation, reply)) {
    const candidate: MonitorBubble = {
      key: `candidate:${reply.id}`,
      side: 'candidate',
      label: candidateLabels[reply.status]!,
      text: reply.text,
      at: reply.at,
      status: reply.status,
    }
    // 候选按生成时间插入，不能把旧候选固定放在新买家消息之后冒充“最新气泡”。
    const later = bubbles.findIndex((bubble) => bubble.at > candidate.at)
    if (later === -1) bubbles.push(candidate)
    else bubbles.splice(later, 0, candidate)
  }

  let product = productOf(reply?.product)
  if (!product && !reply && conversation) {
    const latestBuyerAt = conversation.messages.reduce(
      (latest, message) => (message.from === 'buyer' ? Math.max(latest, message.ts) : latest),
      0,
    )
    product = productOf(
      tracesNewestFirst.find(
        (trace) =>
          trace.storeId === storeId &&
          trace.uid === uid &&
          trace.purpose !== 'compression' &&
          trace.at >= latestBuyerAt,
      )?.product,
    )
  }

  const pendingCount = snapshot.review.replies.filter((row) => row.status === 'pending').length
  const status = reply ? replyStatusLabels[reply.status] : log?.ai?.reason || '等待新消息'
  // 买家/客服消息已经在气泡区展示，不再把同一正文当作“原因”输出第二次。
  const reason =
    reply?.reason ||
    (log && log.kind !== '买家消息' && log.kind !== '客服消息' ? log.text : '') ||
    ''
  return { reply, log, store, conversation, product, bubbles, pendingCount, status, reason }
}
