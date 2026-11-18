import { AsyncLocalStorage } from 'node:async_hooks'
import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'

interface SizeRequestState {
  evidence?: SizeRuleContext
  canonicalReply?: string
}

/**
 * The prompt preparation and the final reply guard run in the same request chain.
 * Keeping the exact evidence in async-local state prevents a concurrent rule edit
 * from changing the labels used to constrain the already-submitted model request.
 */
const storage = new AsyncLocalStorage<SizeRequestState>()

export function withSizeRequest<T>(job: () => Promise<T>): Promise<T> {
  // Reuse an outer training/command owner so the final output can inspect the same evidence.
  return storage.getStore() ? job() : storage.run({}, job)
}

export function captureSizeEvidence(evidence: SizeRuleContext | null): void {
  const state = storage.getStore()
  if (state && evidence) state.evidence = evidence
}

export function capturedSizeEvidence(): SizeRuleContext | undefined {
  return storage.getStore()?.evidence
}

export function captureSizeCanonicalReply(reply: string): void {
  const state = storage.getStore()
  if (state) state.canonicalReply = reply
}

export function capturedSizeCanonicalReply(): string | undefined {
  return storage.getStore()?.canonicalReply
}
