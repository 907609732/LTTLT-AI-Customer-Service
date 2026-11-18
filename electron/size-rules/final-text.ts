import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'

function mention(text: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return /^[a-z0-9]/i.test(label)
    ? new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text)
    : text.includes(label)
}

/**
 * Validate the vendor's final text without rewriting it. Banned-word replacement and
 * store/model-profile truncation happen after the model wrapper; a changed label must
 * reject the send rather than be silently reintroduced.
 */
export function sizeFinalTextReason(evidence: SizeRuleContext, text: string): string {
  if (!evidence.selectionRequested && !evidence.tableQueryRequested) return ''
  if (evidence.bindingStatus !== 'valid') return ''
  if (!evidence.selectionRequested) return ''
  const allowed = new Set(evidence.eligibleLabels)
  for (const row of evidence.rows)
    if (!allowed.has(row.label) && mention(text, row.label))
      return '最终回复在禁用词或长度处理后出现范围外尺码，未采用；请重新生成'
  const allowedLower = new Set([...allowed].map((label) => label.toLocaleLowerCase()))
  for (const match of text.matchAll(/\b[A-Z]{1,4}\b/g))
    if (!allowedLower.has(match[0].toLocaleLowerCase()))
      return '最终回复在禁用词或长度处理后出现未知尺码，未采用；请重新生成'
  for (const match of text.matchAll(/([a-z]{1,4}|\d{1,3})\s*(?:码|号)/gi))
    if (!allowed.has(match[1]!))
      return '最终回复在禁用词或长度处理后出现未知尺码，未采用；请重新生成'
  return ''
}
