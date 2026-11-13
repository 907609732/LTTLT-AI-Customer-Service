import { z } from 'zod'
import data from './phrases.json'

const phraseSchema = z.object({
  id: z.string().min(1),
  scene: z.string().min(1),
  intent: z.string().min(1),
  triggers: z.array(z.string().min(1)).min(1),
  reply: z.string().min(1).max(160),
  context_required: z.array(z.string()),
  avoid: z.string(),
  source_type: z.literal('editorial_generic_rewrite'),
  human_confirm_before_send: z.literal(true),
  auto_send: z.literal(false),
})
export type GenericPhrase = Readonly<z.infer<typeof phraseSchema>>

/** Only the editorial library ships with the app; raw FAQ/rule candidates never enter it. */
export const genericPhrases: readonly GenericPhrase[] = Object.freeze(
  z
    .array(phraseSchema)
    .parse(data)
    .map((row) => Object.freeze(row)),
)
export const genericScenes = Object.freeze([...new Set(genericPhrases.map((row) => row.scene))])
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const bigrams = (text: string) =>
  new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)))

/** Browsing matches labels and wording; it makes no claim about semantic intent accuracy. */
export function browseGenericPhrases(query: string, scene = ''): readonly GenericPhrase[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return genericPhrases.filter(
    (row) =>
      (!scene || row.scene === scene) &&
      terms.every((term) =>
        [row.scene, row.intent, row.reply, ...row.triggers].join(' ').toLowerCase().includes(term),
      ),
  )
}

/** Bounded literal retrieval for wording references, never store facts or a sending decision. */
export function suggestGenericPhrases(query: string): readonly GenericPhrase[] {
  const normalized = normalize(query.slice(-2000))
  if (!normalized) return []
  const terms = bigrams(normalized)
  return genericPhrases
    .map((row) => {
      let score = 0
      for (const expression of [...row.triggers, row.intent]) {
        const trigger = normalize(expression)
        const triggerTerms = bigrams(trigger)
        const overlap = [...triggerTerms].filter((term) => terms.has(term)).length
        // Short greetings require an exact message match ("好的" must not match "不好的体验").
        const exact = trigger.length <= 2 ? trigger === normalized : normalized.includes(trigger)
        if (exact) score = Math.max(score, 10 + trigger.length / 100)
        else if (overlap >= 2 && overlap / triggerTerms.size >= 0.6)
          score = Math.max(score, overlap / triggerTerms.size)
      }
      return { row, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, 3)
    .map((item) => item.row)
}
