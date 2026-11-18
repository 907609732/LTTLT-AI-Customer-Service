import { z } from 'zod'
import { replyPacingModeSchema } from './backend'
import { defaultWelcomeDelay, welcomeDelayLimits } from './welcome'

/**
 * Only the three approved configuration groups are reachable through the agent
 * interface. Model credentials, prompts, AI enable/send modes and debug
 * commands intentionally have no schema here.
 */
const id = z.string().trim().min(1).max(200)
const seconds = z
  .number()
  .int()
  .min(welcomeDelayLimits.minSeconds)
  .max(welcomeDelayLimits.maxSeconds)
const nonEmpty = (value: object) => Object.keys(value).length > 0

export const agentConfigGroups = ['reply-pacing', 'welcome', 'vision'] as const
export const agentConfigGroupSchema = z.enum(agentConfigGroups)
export type AgentConfigGroup = z.infer<typeof agentConfigGroupSchema>

export const replyPacingConfigPatchSchema = z
  .object({
    mode: replyPacingModeSchema.optional(),
    customMinSeconds: z.number().int().min(1).max(3600).optional(),
    customMaxSeconds: z.number().int().min(1).max(3600).optional(),
  })
  .strict()
  .refine(nonEmpty, { message: '至少提供一个要修改的字段' })
export type ReplyPacingConfigPatch = z.infer<typeof replyPacingConfigPatchSchema>

export const welcomeConfigPatchSchema = z
  .object({
    text: z.string().trim().max(200).optional(),
    enabled: z.boolean().optional(),
    delayMinSeconds: seconds.optional(),
    delayMaxSeconds: seconds.optional(),
  })
  .strict()
  .refine(nonEmpty, { message: '至少提供一个要修改的字段' })
export type WelcomeConfigPatch = z.infer<typeof welcomeConfigPatchSchema>

export const visionConfigPatchSchema = z
  .object({ enabled: z.boolean() })
  .strict()
  .refine(nonEmpty, { message: '至少提供一个要修改的字段' })
export type VisionConfigPatch = z.infer<typeof visionConfigPatchSchema>

const replyPacingScope = {
  workspaceId: id,
  group: z.literal('reply-pacing'),
}
const welcomeScope = {
  workspaceId: id,
  group: z.literal('welcome'),
  storeId: id,
}
const visionScope = {
  workspaceId: id,
  group: z.literal('vision'),
  storeId: id,
}

export const agentConfigGetSchema = z.discriminatedUnion('group', [
  z.object(replyPacingScope).strict(),
  z.object(welcomeScope).strict(),
  z.object(visionScope).strict(),
])
export const agentConfigPreviewSchema = z.discriminatedUnion('group', [
  z.object({ ...replyPacingScope, patch: replyPacingConfigPatchSchema }).strict(),
  z.object({ ...welcomeScope, patch: welcomeConfigPatchSchema }).strict(),
  z.object({ ...visionScope, patch: visionConfigPatchSchema }).strict(),
])
export const agentConfigApplySchema = z.discriminatedUnion('group', [
  z
    .object({
      ...replyPacingScope,
      requestId: id,
      expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
      patch: replyPacingConfigPatchSchema,
    })
    .strict(),
  z
    .object({
      ...welcomeScope,
      requestId: id,
      expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
      patch: welcomeConfigPatchSchema,
    })
    .strict(),
  z
    .object({
      ...visionScope,
      requestId: id,
      expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
      patch: visionConfigPatchSchema,
    })
    .strict(),
])

export interface AgentConfigFieldDescription {
  type: 'boolean' | 'enum' | 'integer' | 'string'
  values?: readonly string[]
  min?: number
  max?: number
  maxLength?: number
  default?: string | number
  note?: string
}

/** Static discovery payload; field values always come from lingtu_get_config. */
export const agentConfigDescription = {
  groups: [
    {
      group: 'reply-pacing',
      scope: 'global',
      fields: {
        mode: {
          type: 'enum',
          values: replyPacingModeSchema.options,
          default: 'random-1-3',
        },
        customMinSeconds: { type: 'integer', min: 1, max: 3600 },
        customMaxSeconds: { type: 'integer', min: 1, max: 3600 },
      },
      note: '只影响同一买家的排队节奏，不是模型生成耗时；AI开关和发送审批不变。',
    },
    {
      group: 'welcome',
      scope: 'store',
      fields: {
        text: { type: 'string', maxLength: 200 },
        enabled: { type: 'boolean', default: false },
        delayMinSeconds: {
          type: 'integer',
          min: welcomeDelayLimits.minSeconds,
          max: welcomeDelayLimits.maxSeconds,
          default: defaultWelcomeDelay.delayMinSeconds,
        },
        delayMaxSeconds: {
          type: 'integer',
          min: welcomeDelayLimits.minSeconds,
          max: welcomeDelayLimits.maxSeconds,
          default: defaultWelcomeDelay.delayMaxSeconds,
        },
      },
      note: '缺失记录按文字为空、关闭、1～3秒延迟读取；启用前必须有欢迎文字。',
    },
    {
      group: 'vision',
      scope: 'store',
      fields: { enabled: { type: 'boolean', default: false } },
      note: '只开放识图开关；不保证当前模型支持图片，保存仍由原生能力检查拒绝。',
    },
  ] as const,
  versioning:
    'get/preview返回version，apply必须原样带回expectedVersion；界面同时保存会使版本变化并被拒绝。requestId重复提交同样参数返回原结果。',
} as const
