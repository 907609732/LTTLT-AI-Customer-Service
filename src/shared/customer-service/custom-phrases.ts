import { z } from 'zod'

export const phraseScopeSchema = z
  .object({
    workspaceId: z.string().min(1).max(128),
    storeId: z.string().min(1).max(128),
  })
  .strict()
export const phraseDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    scene: z.string().trim().min(1).max(40),
    reply: z.string().trim().min(1).max(4000),
  })
  .strict()
export const customPhraseSchema = phraseDraftSchema.extend({ id: z.string().uuid() })
export const phraseLibrarySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    rows: z.array(customPhraseSchema).max(500),
  })
  .strict()
  .refine(
    (value) => new Set(value.rows.map((row) => row.id)).size === value.rows.length,
    '话术 ID 重复',
  )
export const phraseSaveSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    id: z.string().uuid().optional(),
    draft: phraseDraftSchema,
  })
  .strict()
export const phraseRemoveSchema = z
  .object({ revision: z.number().int().nonnegative(), id: z.string().uuid() })
  .strict()
export const phraseImportSchema = z
  .object({ revision: z.number().int().nonnegative(), text: z.string().max(2_000_000) })
  .strict()
export const phraseCopySchema = z.object({ id: z.string().uuid() }).strict()
export type PhraseScope = z.infer<typeof phraseScopeSchema>
export type PhraseDraft = z.infer<typeof phraseDraftSchema>
export type CustomPhrase = z.infer<typeof customPhraseSchema>
export type PhraseLibrary = z.infer<typeof phraseLibrarySchema>
export type PhraseSave = z.infer<typeof phraseSaveSchema>
export type PhraseRemove = z.infer<typeof phraseRemoveSchema>
export type PhraseImport = z.infer<typeof phraseImportSchema>

const exportSchema = z
  .object({ version: z.literal(1), phrases: z.array(phraseDraftSchema).max(500) })
  .strict()
export function parsePhraseImport(text: string): PhraseDraft[] {
  if (text.length > 2_000_000) throw new Error('导入内容超过 2 MB 限制')
  try {
    return exportSchema.parse(JSON.parse(text.replace(/^\uFEFF/, ''))).phrases
  } catch {
    throw new Error(
      '话术 JSON 格式错误：需要 version: 1 和 phrases，每条包含 title、scene、reply（最多 500 条）',
    )
  }
}
export function serializePhraseExport(rows: readonly CustomPhrase[]): string {
  return JSON.stringify(
    exportSchema.parse({
      version: 1,
      phrases: rows.map(({ title, scene, reply }) => ({ title, scene, reply })),
    }),
    null,
    2,
  )
}

/** Narrow capability: only persisted IDs can be copied, with no send or arbitrary file access. */
export interface CustomPhrasesBridge {
  list(scope: PhraseScope): Promise<PhraseLibrary>
  save(scope: PhraseScope, input: PhraseSave): Promise<PhraseLibrary>
  remove(scope: PhraseScope, input: PhraseRemove): Promise<PhraseLibrary>
  import(scope: PhraseScope, input: PhraseImport): Promise<PhraseLibrary>
  copy(scope: PhraseScope, input: { id: string }): Promise<void>
}
