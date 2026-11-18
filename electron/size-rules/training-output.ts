import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'
import { sizeFinalTextReason } from './final-text'

/**
 * The vendor has already applied store/model-profile banned words and max length.
 * Never rebuild the deterministic reply here: doing so could reintroduce a banned
 * label or exceed the shop's limit. Preserve the final text unless it violates the
 * generated evidence, in which case fail the command with an explicit error.
 */
export function applySizeTrainingOutput(
  evidence: SizeRuleContext,
  data: Record<string, unknown>,
  currentReason: string,
): Record<string, unknown> {
  if (currentReason) throw new Error(currentReason)
  const reply = typeof data.reply === 'string' ? data.reply : ''
  const reason = sizeFinalTextReason(evidence, reply)
  if (reason) throw new Error(reason)
  return data
}
