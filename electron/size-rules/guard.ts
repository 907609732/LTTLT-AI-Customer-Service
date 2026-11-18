import { z } from 'zod'
import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'
import type { SizeEvidenceResolver } from './context'
import { capturedSizeEvidence, withSizeRequest } from './request-state'

export type SizeReplyResolver = Pick<SizeEvidenceResolver, 'resolve'>

export interface SizeReplyResult extends Record<string, unknown> {
  reply: string
}

const reviewContextSchema = z.object({
  storeId: z.string().min(1).max(64),
  productId: z.string().max(100).optional(),
})
const threadSchema = z.array(
  z.object({
    from: z.string(),
    type: z.string().optional(),
    content: z.string(),
  }),
)

function explicitLabel(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const value = Reflect.get(raw, 'sizeLabel')
    if (typeof value === 'string') return value.trim()
  }
  if (typeof raw !== 'string') return ''
  const match = raw.match(/"sizeLabel"\s*:\s*"((?:\\.|[^"\\])*)"/)
  if (!match) return ''
  try {
    const parsed: unknown = JSON.parse(`"${match[1]}"`)
    return typeof parsed === 'string' ? parsed.trim() : ''
  } catch {
    return ''
  }
}

function mentionsLabel(text: string, label: string): boolean {
  if (!label) return false
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (/^[a-z0-9]/i.test(label))
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text)
  return text.includes(label)
}

function unknownRecommendationTokens(text: string): string[] {
  const pattern =
    /(?:推荐|建议|选择|选|穿|适合|优先核对|优先选)[^。；\n，,]{0,6}?([a-z]{1,4}|\d{1,3})(?:码|号)?/gi
  return [...text.matchAll(pattern)].map((match) => match[1]!.trim()).filter(Boolean)
}

function safeReply(evidence: SizeRuleContext): string {
  if (evidence.clarification) return evidence.clarification.slice(0, 600)
  if (evidence.eligibleLabels.length) {
    const labels = evidence.eligibleLabels.slice(0, 5).join('、')
    return `按本商品尺码表和你提供的测量值，建议优先核对 ${labels}；请以实际测量和商品说明为准。`
  }
  return '按本商品尺码表区间，当前测量值暂未匹配到可选规格；请核对测量值或提供具体尺码，我再按表核对。'
}

/**
 * Apply the same eligibleLabels constraint after normalization. The prompt alone is not a
 * security boundary: an out-of-range model label becomes a safe table/clarification reply,
 * and any media/coupon fields from the rejected answer are removed.
 */
export function enforceSizeReply(
  evidence: SizeRuleContext,
  result: Record<string, unknown>,
): SizeReplyResult {
  const reply = typeof result.reply === 'string' ? result.reply : ''
  if (!evidence.selectionRequested || !reply) return { ...result, reply }
  const allLabels = new Set(evidence.rows.map((row) => row.label))
  const allowed = new Set(evidence.eligibleLabels)
  const explicit = explicitLabel(result.raw)
  const mentioned = [...allLabels].filter((label) => mentionsLabel(reply, label))
  const unknown = unknownRecommendationTokens(reply)
  const recommendationPresent = Boolean(explicit) || mentioned.length > 0 || unknown.length > 0
  if (!recommendationPresent) return { ...result, reply }
  const invalid =
    Boolean(evidence.clarification) ||
    allowed.size === 0 ||
    (explicit !== '' && !allowed.has(explicit)) ||
    mentioned.some((label) => !allowed.has(label)) ||
    unknown.some((token) => !allowed.has(token) && !allLabels.has(token))
  if (!invalid) return { ...result, reply }
  return {
    ...result,
    reply: safeReply(evidence),
    images: [],
    videos: [],
    cardActions: [],
    couponName: '',
  }
}

export interface GuardableReplyClient {
  reply(input: unknown): Promise<unknown>
}

const STALE_MESSAGE = '尺码规则已更新或停用，本次未采用旧尺码结论；请重新核对商品规则后再推荐。'
function staleResult(result: Record<string, unknown>): SizeReplyResult {
  return {
    ...result,
    reply: STALE_MESSAGE,
    images: [],
    videos: [],
    cardActions: [],
    couponName: '',
  }
}

function contextInput(input: unknown) {
  if (!input || typeof input !== 'object') return null
  const review = reviewContextSchema.safeParse(Reflect.get(input, 'reviewContext'))
  if (!review.success) return null
  const thread = threadSchema.safeParse(Reflect.get(input, 'thread'))
  if (!thread.success) return null
  const question =
    [...thread.data].reverse().find((message) => message.from === 'buyer')?.content ?? ''
  return { review: review.data, thread: thread.data, question }
}

/**
 * Wrap the existing AiClient instance so both reception and training pass through the
 * same post-generation guard without modifying vendor code or adding a send path.
 */
export function installSizeReplyGuard<T extends GuardableReplyClient>(
  client: T,
  resolver: SizeReplyResolver,
): T {
  const original = client.reply.bind(client)
  client.reply = async (input: unknown): Promise<unknown> => {
    return withSizeRequest(async () => {
      const result = await original(input)
      if (!result || typeof result !== 'object') return result
      const parsed = contextInput(input)
      if (!parsed) return result
      const captured = capturedSizeEvidence()
      let current: SizeRuleContext | null = null
      try {
        current = await resolver.resolve(
          parsed.review.storeId,
          parsed.review.productId ?? '',
          parsed.question,
          parsed.thread,
        )
      } catch {
        current = null
      }
      // A rule disabled/rebound/versioned while the model was running must not use old labels.
      if (
        captured &&
        (!current ||
          current.ruleId !== captured.ruleId ||
          current.ruleVersion !== captured.ruleVersion)
      )
        return staleResult(result as Record<string, unknown>)
      if (!current) return result
      return enforceSizeReply(current, result as Record<string, unknown>)
    })
  }
  return client
}
