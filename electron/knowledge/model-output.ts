import { jsonrepair } from 'jsonrepair'

// This allowlist verifies a repair; jsonrepair remains the JSON parser/repair implementation.
function onlyRedundantBraces(original: string, repaired: string) {
  let target = 0,
    removed = 0,
    quoted = false,
    escaped = false
  for (let source = 0; source < original.length; source++) {
    const character = original[source]!
    if (character === repaired[target]) {
      target++
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
      } else if (character === '"') quoted = true
    } else if (!quoted && character === '}' && removed < 2) removed++
    else return false
  }
  return !quoted && target === repaired.length && removed > 0
}

export function parseKnowledgeModelOutput(raw: string): { value: unknown; repaired?: string } {
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw Error('模型返回超过解析上限')
  const text = raw.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/i.exec(text)
  const json = fenced?.[1] ?? text
  try {
    return { value: JSON.parse(json) as unknown }
  } catch (originalError) {
    const repaired = jsonrepair(json)
    // No inserted values/brackets, changed strings, truncated JSON completion or prose removal.
    if (!onlyRedundantBraces(json, repaired)) throw originalError
    return { value: JSON.parse(repaired) as unknown, repaired }
  }
}
