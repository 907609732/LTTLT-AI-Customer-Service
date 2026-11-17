import { z } from 'zod'

/** The server's context policy bounds, mirrored so a malformed projection cannot widen local behavior. */
const retrievalBudget = z.number().int().min(256).max(4096)
const learningOutputTokens = z.number().int().min(512).max(4096)
const callsPerProduct = z.number().int().min(1).max(20)

const retrievalOrder = z
  .array(z.enum(['binding', 'store', 'canonical', 'template']))
  .length(4)
  .refine(
    (order) =>
      order[0] === 'binding' &&
      order[3] === 'template' &&
      new Set(order).size === 4 &&
      order.slice(1, 3).every((stage) => stage === 'store' || stage === 'canonical'),
    '检索顺序必须为 binding、store/canonical、template',
  )

const learningSource = z.enum(['pdd_detail_text', 'pdd_detail_image'])

/**
 * Strict safe projection returned by GET /api/client/config. The admin prompt,
 * provider routing and credentials are intentionally absent; `.strict()` means
 * a hidden `system_prompt` or any unknown server field fails closed instead of
 * being silently accepted into a renderer/main-process DTO.
 */
export const managedContextPolicySchema = z
  .object({
    default_model: z.string().max(128),
    models: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            name: z.string().max(256),
          })
          .strict(),
      )
      .max(200),
    max_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    policy_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    runtime_context: z
      .object({
        enabled: z.boolean(),
        retrieval_budget: retrievalBudget,
        retrieval_order: retrievalOrder,
      })
      .strict(),
    learning: z
      .object({
        enabled: z.boolean(),
        // Vision only means policy permits image learning; the account capability
        // and the server still decide whether a learning request may run.
        vision_enabled: z.boolean(),
        allowed_sources: z
          .array(learningSource)
          .max(2)
          .refine((sources) => new Set(sources).size === sources.length, '学习来源不能重复'),
        max_calls_per_product: callsPerProduct,
        max_output_tokens: learningOutputTokens,
        requires_review: z.literal(true),
        video_mode: z.literal('disabled'),
        asr_mode: z.literal('disabled'),
      })
      .strict(),
  })
  .strict()

export type ManagedContextPolicy = z.infer<typeof managedContextPolicySchema>

/** Cache bound to one active apiOrigin and signed-in account for at most 60 seconds. */
export const MANAGED_CONTEXT_POLICY_TTL_MS = 60_000
