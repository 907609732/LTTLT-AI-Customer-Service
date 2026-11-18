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

function selectionReply(evidence: SizeRuleContext): string {
  if (evidence.clarification) return evidence.clarification.slice(0, 600)
  if (evidence.eligibleLabels.length) {
    const labels = evidence.eligibleLabels.slice(0, 5).join('、')
    return `按本商品尺码表和你提供的测量值，建议优先核对 ${labels}；请以实际测量和商品说明为准。`
  }
  return '按本商品尺码表区间，当前测量值暂未匹配到可选规格；请核对测量值或提供具体尺码，我再按表核对。'
}

function lookupReply(evidence: SizeRuleContext): string {
  return evidence.clarification || '当前商品目录暂时无法核对，请稍后重试。'
}

function clearUnsafeFields(result: Record<string, unknown>, reply: string): SizeReplyResult {
  return {
    ...result,
    reply,
    images: [],
    videos: [],
    cardActions: [],
    couponName: '',
  }
}

/**
 * A positive selection request is rendered from the saved table, not from model prose.
 * This is a whitelist by construction: unknown labels such as "XL 最合适" and
 * "加大码更合适" cannot survive because the model text is not used as the recommendation.
 * Direct table lookups and ordinary chat keep the original model reply when the binding
 * is verified; a failed catalog lookup still cannot expose table facts.
 */
export function enforceSizeReply(
  evidence: SizeRuleContext,
  result: Record<string, unknown>,
): SizeReplyResult {
  const reply = typeof result.reply === 'string' ? result.reply : ''
  if (!evidence.selectionRequested && !evidence.tableQueryRequested) return { ...result, reply }
  if (evidence.bindingStatus !== 'valid') return clearUnsafeFields(result, lookupReply(evidence))
  if (!evidence.selectionRequested) return { ...result, reply }
  return clearUnsafeFields(result, selectionReply(evidence))
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
