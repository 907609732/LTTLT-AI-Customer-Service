import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'
import { sizeEvidenceFromMessages } from './inject'
import { sizeFinalTextReason, type BannedRule } from './final-text'

export interface SizeCandidateProposal {
  traceId?: string
  invalidReason?(): string
  isCurrent(): boolean
}

export interface SizeCandidateGuard {
  capture(traceId: string, messages: unknown): void
  captureReply(traceId: string, reply: string): void
  attach(proposal: SizeCandidateProposal): void
  finalTextReason(proposal: { traceId?: string; text: string }, bannedWords?: BannedRule[]): string
}

const CAPTURED_LIMIT = 1000
const EXPIRED = '尺码证据已过期或无法确认，旧候选已失效；请重新生成。'

/**
 * Every reply trace has an explicit entry: evidence or null (no size rule).
 * Older entries are evicted; an unknown AI trace is not treated as "no evidence".
 * Welcome/non-model paths without a traceId remain unaffected.
 */
export function createSizeCandidateGuard(options: {
  currentReason(evidence: SizeRuleContext): string
}): SizeCandidateGuard {
  const captured = new Map<string, SizeRuleContext | null>()
  const canonical = new Map<string, string>()
  const attached = new WeakSet<object>()
  return {
    capture(traceId, messages) {
      captured.delete(traceId)
      captured.set(traceId, sizeEvidenceFromMessages(messages))
      canonical.delete(traceId)
      while (captured.size > CAPTURED_LIMIT) {
        const oldest = captured.keys().next().value
        if (!oldest) break
        captured.delete(oldest)
        canonical.delete(oldest)
      }
    },
    captureReply(traceId, reply) {
      if (!captured.has(traceId)) return
      canonical.set(traceId, reply)
    },
    attach(proposal) {
      if (!proposal.traceId || attached.has(proposal)) return
      attached.add(proposal)
      if (!captured.has(proposal.traceId)) {
        proposal.invalidReason = () => EXPIRED
        proposal.isCurrent = () => false
        return
      }
      const evidence = captured.get(proposal.traceId)
      if (!evidence) return
      const previousCurrent = proposal.isCurrent.bind(proposal)
      const previousReason = proposal.invalidReason?.bind(proposal)
      const reason = () => {
        const inherited = previousReason?.() || ''
        if (inherited) return inherited
        try {
          return options.currentReason(evidence)
        } catch (error) {
          return `尺码规则不可用：${error instanceof Error ? error.message : String(error)}；旧候选已失效。`
        }
      }
      proposal.invalidReason = reason
      proposal.isCurrent = () => previousCurrent() && !reason()
    },
    finalTextReason(proposal, bannedWords = []) {
      if (!proposal.traceId) return ''
      if (!captured.has(proposal.traceId)) return EXPIRED
      const evidence = captured.get(proposal.traceId)
      return evidence
        ? sizeFinalTextReason(evidence, proposal.text, {
            canonical: canonical.get(proposal.traceId),
            bannedWords,
          })
        : ''
    },
  }
}
