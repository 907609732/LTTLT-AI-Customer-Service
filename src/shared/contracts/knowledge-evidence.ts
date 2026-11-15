import { z } from 'zod'
export const visualLocatorSchema = z
  .object({
    page: z.number().int().positive().optional(),
    image: z.number().int().positive().optional(),
    tile: z.number().int().positive().optional(),
  })
  .strict()
const provenance = { imageAssetId: z.string().min(1).max(200), locator: visualLocatorSchema }
export const knowledgeVisualEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('image-text'),
      ...provenance,
      quote: z.string().trim().min(1).max(30000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('visual-relationship'),
      ...provenance,
      relation: z.enum([
        'above',
        'below',
        'left-of',
        'right-of',
        'inside',
        'connected-to',
        'arrow-to',
      ]),
      from: z.string().trim().min(1).max(1000),
      to: z.string().trim().min(1).max(1000),
      observation: z.string().trim().min(1).max(30000),
    })
    .strict(),
])
export type KnowledgeVisualEvidence = z.infer<typeof knowledgeVisualEvidenceSchema>
