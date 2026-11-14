import { z } from 'zod'

const id = z.string().trim().min(1).max(128)
const at = z.number().int().nonnegative()
const text = z.string().trim().min(1).max(2000)
const mediaUrl = z.url().startsWith('https://').max(4096)
const platformMediaAssetSchema = z
  .object({
    id: id.optional(),
    name: z.string().min(1).max(200),
    kind: z.literal('video'),
    url: mediaUrl,
    sizeBytes: z.number().int().positive(),
  })
  .strict()
export const automationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome-text'), text }).strict(),
  z.object({ kind: z.literal('welcome-image'), url: mediaUrl }).strict(),
  z.object({ kind: z.literal('welcome-video'), url: mediaUrl }).strict(),
  z.object({ kind: z.literal('transfer'), agentId: id }).strict(),
  z.object({ kind: z.literal('payment-reminder'), text, orderId: id }).strict(),
])
export type AutomationAction = z.infer<typeof automationActionSchema>
export type PlatformOperationKind = AutomationAction['kind']

/** A rule is an action template; the order number can only come from a trusted event. */
export const receptionRuleActionSchema = z.union([
  z.object({ kind: z.literal('welcome-text'), text }).strict(),
  z.object({ kind: z.literal('welcome-image'), url: mediaUrl }).strict(),
  z.object({ kind: z.literal('welcome-video'), url: mediaUrl }).strict(),
  z.object({ kind: z.literal('transfer'), agentId: id }).strict(),
  z.object({ kind: z.literal('payment-reminder'), text }).strict(),
])
export const receptionRuleSchema = z
  .object({
    id,
    storeId: id,
    enabled: z.boolean(),
    trigger: z.enum(['visitor', 'unpaid-order', 'transfer-request']),
    actions: z.array(receptionRuleActionSchema).min(1).max(5),
    revision: z.number().int().positive().default(1),
  })
  .strict()
  .superRefine((rule, context) => {
    const allowed =
      rule.trigger === 'visitor'
        ? ['welcome-text', 'welcome-image', 'welcome-video']
        : rule.trigger === 'unpaid-order'
          ? ['payment-reminder']
          : ['transfer']
    if (rule.actions.some((action) => !allowed.includes(action.kind)))
      context.addIssue({ code: 'custom', message: '规则动作与触发来源不匹配' })
    if (
      rule.actions.filter((a) => a.kind === 'welcome-text').length > 1 ||
      rule.actions.filter((a) => a.kind === 'welcome-image' || a.kind === 'welcome-video').length >
        4
    )
      context.addIssue({ code: 'custom', message: '欢迎语最多一条文字、四条媒体，各自逐条批准' })
  })
export type ReceptionRule = z.infer<typeof receptionRuleSchema>

const eventBase = { id, storeId: id, uid: id, observedAt: at }
export const receptionEventSchema = z.discriminatedUnion('type', [
  z
    .object({ ...eventBase, type: z.literal('visitor'), sessionId: id, messageCount: z.literal(0) })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('unpaid-order'),
      orderId: id,
      status: z.literal('unpaid'),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('transfer-request'),
      availableAgentIds: z.array(id).max(1000),
    })
    .strict(),
])
export type ReceptionEvent = z.infer<typeof receptionEventSchema>

export const operationTargetSchema = z
  .object({
    storeId: id,
    storeName: z.string().min(1).max(200),
    uid: id,
    buyerName: z.string().min(1).max(200),
    accountId: id,
    pageId: id,
  })
  .strict()
export const operationEvidenceSchema = z
  .object({
    id,
    observedAt: at,
    description: z.string().min(1).max(500),
  })
  .strict()
export type OperationEvidence = z.infer<typeof operationEvidenceSchema>
export const preparedPlatformOperationSchema = z
  .object({
    runId: id,
    action: automationActionSchema,
    target: operationTargetSchema,
    basis: z
      .object({
        accountId: id,
        pageId: id,
        conversationRevision: id,
        storeRevision: id,
      })
      .strict(),
    preparedAt: at,
    expiresAt: at,
    media: z
      .object({
        mimeType: z.string().min(1).max(100),
        sizeBytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    orderLabel: z.string().max(300).optional(),
    agentName: z.string().max(200).optional(),
    operationLabel: z.string().max(1000).optional(),
    evidence: z.array(operationEvidenceSchema).min(1).max(20),
  })
  .strict()
export type PreparedPlatformOperation = z.infer<typeof preparedPlatformOperationSchema>

/** Canonical operation run schema, re-exported by scheduler without a runtime cycle. */
export const platformOperationRunSchema = z
  .object({
    id,
    taskId: id,
    storeId: id,
    uid: id,
    occurrence: at,
    action: automationActionSchema,
    state: z.enum([
      'pending',
      'blocked',
      'executing',
      'confirmed',
      'failed',
      'uncertain',
      'invalidated',
      'cancelled',
      'expired',
    ]),
    reason: z.string().max(300),
    createdAt: at,
    expiresAt: at,
    prepared: preparedPlatformOperationSchema.optional(),
    approvalId: id.optional(),
    completedAt: at.optional(),
    evidence: operationEvidenceSchema.optional(),
    eventKey: id.optional(),
  })
  .strict()

export interface PlatformOperationStoreFacts {
  storeId: string
  storeName: string
  accountId: string
  observedAt: number
  capabilities: { kind: PlatformOperationKind; available: boolean; reason: string }[]
  buyers: { uid: string; name: string }[]
  orders: { orderId: string; uid: string; label: string; status: 'unpaid' | 'paid' | 'closed' }[]
  agents: { agentId: string; name: string; online: boolean | null; canTransfer?: boolean }[]
  mediaAssets?: z.infer<typeof platformMediaAssetSchema>[]
  error?: string
}
export interface PlatformOperationScope {
  workspaceId: string
  storeId: string
}
export interface PreparePlatformOperationInput extends PlatformOperationScope {
  runId: string
  uid: string
  action: AutomationAction
}
export type PlatformOperationPreparation =
  | { status: 'ready'; prepared: PreparedPlatformOperation }
  | { status: 'blocked'; reason: string }
export type PlatformOperationValidation =
  | { status: 'valid' }
  | { status: 'invalid' | 'unavailable'; reason: string }
export type PlatformOperationResult = {
  status: 'confirmed' | 'failed' | 'uncertain'
  reason: string
  evidence?: OperationEvidence
}
/** Main-process port. read/observe/prepare/revalidate/inspect must never write to a platform.
 * execute must check isCurrent immediately before every write and bind the seller echo to
 * the same account/page/buyer and exact content; ambiguous outcomes are never retryable. */
export interface PlatformOperationsPort {
  read(scope: PlatformOperationScope): Promise<PlatformOperationStoreFacts>
  observe(scope: PlatformOperationScope): Promise<ReceptionEvent[]>
  prepare(input: PreparePlatformOperationInput): Promise<PlatformOperationPreparation>
  revalidate(prepared: PreparedPlatformOperation): Promise<PlatformOperationValidation>
  execute(
    prepared: PreparedPlatformOperation,
    options: { isCurrent(): boolean },
  ): Promise<PlatformOperationResult>
  inspect?(prepared: PreparedPlatformOperation): Promise<PlatformOperationResult>
}

export const receptionCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save-rule'), workspaceId: id, rule: receptionRuleSchema }).strict(),
  z
    .object({
      type: z.literal('remove-rule'),
      workspaceId: id,
      id,
      revision: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal('prepare'), workspaceId: id, id }).strict(),
  z.object({ type: z.literal('approve'), workspaceId: id, id, approvalId: id }).strict(),
  z.object({ type: z.literal('cancel'), workspaceId: id, id }).strict(),
  z.object({ type: z.literal('inspect'), workspaceId: id, id }).strict(),
  z.object({ type: z.literal('refresh'), workspaceId: id }).strict(),
])
export type ReceptionCommand = z.infer<typeof receptionCommandSchema>
export interface ReceptionSnapshot {
  workspaceId: string
  rules: ReceptionRule[]
  facts: PlatformOperationStoreFacts[]
  runs: import('./scheduler').SchedulerRun[]
  error?: string
}
export const receptionSnapshotSchema = z
  .object({
    workspaceId: id,
    rules: z.array(receptionRuleSchema).max(100),
    runs: z.array(platformOperationRunSchema).max(500),
    facts: z
      .array(
        z
          .object({
            storeId: id,
            storeName: z.string().max(200),
            accountId: z.string().max(128),
            observedAt: at,
            capabilities: z
              .array(
                z
                  .object({
                    kind: z.enum([
                      'welcome-text',
                      'welcome-image',
                      'welcome-video',
                      'payment-reminder',
                      'transfer',
                    ]),
                    available: z.boolean(),
                    reason: z.string().max(1000),
                  })
                  .strict(),
              )
              .max(5),
            buyers: z.array(z.object({ uid: id, name: z.string().max(200) }).strict()).max(1000),
            orders: z
              .array(
                z
                  .object({
                    orderId: id,
                    uid: id,
                    label: z.string().max(300),
                    status: z.enum(['unpaid', 'paid', 'closed']),
                  })
                  .strict(),
              )
              .max(1000),
            agents: z
              .array(
                z
                  .object({
                    agentId: id,
                    name: z.string().max(200),
                    online: z.boolean().nullable(),
                    canTransfer: z.boolean().optional(),
                  })
                  .strict(),
              )
              .max(1000),
            mediaAssets: z.array(platformMediaAssetSchema).max(100).optional(),
            error: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(200),
    error: z.string().max(500).optional(),
  })
  .strict()
export function parseReceptionSnapshot(input: unknown): ReceptionSnapshot {
  return receptionSnapshotSchema.parse(input)
}
export interface ReceptionBridge {
  receptionSnapshot(workspaceId: string): Promise<ReceptionSnapshot>
  receptionExecute(command: ReceptionCommand): Promise<ReceptionSnapshot>
}
