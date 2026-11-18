import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'

export type BannedRule = { word: string; replacement: string }
export type FinalOptions = {
  canonical?: string
  bannedWords?: BannedRule[]
  /** Trusted, already-filtered welcome text for this send, including exact version. */
  greeting?: string
}

export function filterBannedText(text: string, rules: BannedRule[]): string {
  return vendorFilter(text, rules).trim()
}

function vendorFilter(text: string, rules: BannedRule[]): string {
  const relative = 'vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js'
  const roots = [
    ...(typeof __dirname === 'string'
      ? [path.join(__dirname, '..'), path.join(__dirname, '..', '..')]
      : []),
    process.cwd(),
  ]
  const root = roots.find((candidate) => fs.existsSync(path.join(candidate, relative)))
  if (!root) throw new Error('无法载入本机禁用词过滤器')
  const require = createRequire(path.join(root, 'package.json'))
  const { filterBannedWords } = require(path.join(root, relative)) as {
    filterBannedWords(value: string, rules: BannedRule[]): string
  }
  return filterBannedWords(text, rules)
}

/**
 * Protect only the labels we deliberately selected. The real vendor filter still
 * sees and removes ordinary banned words; a banned label is replaced in the final
 * text, not in this comparison copy, so any label rewrite becomes a prefix mismatch.
 */
function expectedAfterVendorFilter(canonical: string, labels: string[], rules: BannedRule[]) {
  const placeholders = new Map<string, string>()
  let protectedText = canonical
  ;[...labels]
    .sort((left, right) => right.length - left.length)
    .forEach((label, index) => {
      const placeholder = `\uE000${index}\uE001`
      placeholders.set(placeholder, label)
      protectedText = protectedText.split(label).join(placeholder)
    })
  let filtered = vendorFilter(protectedText, rules)
  for (const [placeholder, label] of placeholders)
    filtered = filtered.split(placeholder).join(label)
  return filtered.trim()
}

function reasonForExpected(text: string, expected: string): string {
  // A shop's maxReplyChars may truncate the final text; a full match or any prefix
  // is safe. Any label rewrite/deletion that leaves a suffix is not a prefix.
  if (expected && text && expected.startsWith(text)) return ''
  return '最终回复在禁用词或长度处理后与已选尺码不一致，未采用；请重新生成'
}

/**
 * Validate the vendor's final text without rewriting it. When the pre-filter
 * deterministic reply is available, protect its selected labels, run the real
 * vendor filter, then accept only the expected text or a truncation prefix.
 * This catches arbitrary replacements (2XL, 3XL, 加大码, custom labels) without
 * enumerating words, while allowing ordinary banned-word deletion and shop-length
 * truncation. The legacy fallback is only for callers without captured evidence.
 */
export function sizeFinalTextReason(
  evidence: SizeRuleContext,
  text: string,
  options: FinalOptions = {},
): string {
  if (!evidence.selectionRequested && !evidence.tableQueryRequested) return ''
  if (evidence.bindingStatus !== 'valid') return ''
  if (!evidence.selectionRequested) return ''
  if (!options.canonical) return '缺少本次尺码生成证据，旧候选已失效；请重新生成'
  const expected = expectedAfterVendorFilter(
    options.canonical,
    evidence.eligibleLabels,
    options.bannedWords ?? [],
  )
  let actual = text.trim()
  const greeting = options.greeting?.trim() ?? ''
  if (greeting && actual.startsWith(`${greeting}\n`))
    actual = actual.slice(greeting.length + 1).trim()
  return reasonForExpected(actual, expected)
}
