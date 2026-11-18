import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'
import { enforceSizeReply } from './guard'

/**
 * Training uses the same model client guard, but the vendor then applies banned-word
 * filtering and max-length truncation. Reapply the deterministic size projection to the
 * final reply before returning it from the runtime command.
 */
export function applySizeTrainingOutput(
  evidence: SizeRuleContext,
  data: Record<string, unknown>,
  currentReason: string,
  maxChars: number,
): Record<string, unknown> {
  if (currentReason) return { ...data, reply: currentReason.slice(0, Math.max(1, maxChars)) }
  const reply = typeof data.reply === 'string' ? data.reply : ''
  const guarded = enforceSizeReply(evidence, { ...data, reply })
  return { ...data, reply: String(guarded.reply).slice(0, Math.max(1, maxChars)) }
}
