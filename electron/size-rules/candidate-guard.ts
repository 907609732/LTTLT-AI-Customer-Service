import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'
import { sizeEvidenceFromMessages } from './inject'

export interface SizeCandidateProposal {
  traceId?: string
  invalidReason?(): string
  isCurrent(): boolean
}

export interface SizeCandidateGuard {
  capture(traceId: string, messages: unknown): void
  attach(proposal: SizeCandidateProposal): void
}

/**
 * Candidate lifetime is tied to the exact generation trace, not a global "latest" value.
 * Two buyers can therefore have independent in-flight candidates in the same store.
 */
export function createSizeCandidateGuard(options: {
  currentReason(evidence: SizeRuleContext): string
}): SizeCandidateGuard {
  const evidenceByTrace = new Map<string, SizeRuleContext>()
  const attached = new WeakSet<object>()
  return {
    capture(traceId, messages) {
      const evidence = sizeEvidenceFromMessages(messages)
      if (!evidence) return
      evidenceByTrace.set(traceId, evidence)
      while (evidenceByTrace.size > 200)
        evidenceByTrace.delete(evidenceByTrace.keys().next().value!)
    },
    attach(proposal) {
      if (!proposal.traceId || attached.has(proposal)) return
      const evidence = evidenceByTrace.get(proposal.traceId)
      if (!evidence) return
      attached.add(proposal)
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
  }
}
