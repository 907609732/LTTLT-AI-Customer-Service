import { z } from 'zod'
import { reviewSnapshotSchema, emptyReview } from './review'
import { managedStateSchema, emptyManagedState } from './managed'
import { reportingSnapshotSchema } from './reporting'
import { storeSendModeSchema } from './review'
import { welcomeSettingSchema, type WelcomeSetting } from './welcome'
export { storeSendModeSchema, type StoreSendMode } from './review'
export type { WelcomeSetting } from './welcome'

export const actions = [
  'save-model-source',
  'activate-model-source',
  'managed-login',
  'managed-cancel-login',
  'managed-refresh',
  'managed-logout',
  'open-managed-admin',
  'acknowledge-model-issue',
  'add-store',
  'open-runtime-logs',
  'clear-runtime-logs',
  'open-reply-monitor',
  'set-store-send-mode',
  'review-reply',
  'set-store-group',
  'remove-store',
  'select-store',
  'open-store',
  'open-store-backend',
  'close-store',
  'restart-client',
  'set-ai',
  'pause-ai',
  'resume-ai',
  'batch',
  'refresh',
  'save-model-settings',
  'save-config',
  'list-products',
  'set-product-codes',
  'save-product',
  'remove-product',
  'preview-product-import',
  'import-products',
  'export-products',
  'search-product-knowledge',
  'list-intent-packs',
  'save-intent-pack',
  'remove-intent-pack',
  'preview-intent-import',
  'import-intent-packs',
  'export-intent-packs',
  'list-model-profiles',
  'save-model-profile',
  'bind-model-profile',
  'remove-model-profile',
  'start-training',
  'save-banned-words',
  'save-store-handoff',
  'save-automation-fallback',
  'save-welcome',
  'save-vision-settings',
  'create-work-order',
  'set-work-order-status',
  'add-work-order-note',
  'review-conversation',
  'learn-conversation-correction',
  'select-conversation',
  'focus-conversation',
  'send-reply',
  'resume-conversation',
  'save-auxiliary-draft',
] as const

/** IPC 包含当前运行实例标识，旧页面不能操作重建后的本地服务。 */
export const commandSchema = z
  .object({
    workspaceId: z.string().uuid(),
    action: z.enum(actions),
    storeId: z.string().max(64).optional(),
    conversationId: z.string().max(200).optional(),
    screenId: z.string().max(30).optional(),
    values: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
export type BackendCommand = z.infer<typeof commandSchema>

/**
 * 同一买家两次回复之间的等待节奏。随机范围只影响排队/发送时点，
 * 不是模型生成耗时保证；旧版固定秒数（config.reply.perUidMinIntervalMs）
 * 继续保留在配置文件中用于审计与回退，但不再决定新的等待时长。
 */
export const replyPacingModeSchema = z.enum(['random-1-3', 'random-2-3', 'custom', 'fixed-1'])
export type ReplyPacingMode = z.infer<typeof replyPacingModeSchema>
export const replyPacingSchema = z
  .object({
    mode: replyPacingModeSchema,
    customMinSeconds: z.number().int().min(1).max(3600),
    customMaxSeconds: z.number().int().min(1).max(3600),
  })
  // 反序范围既不能保存也不能进入快照，避免界面显示“10～1 秒随机”。
  .superRefine((value, context) => {
    if (value.customMinSeconds > value.customMaxSeconds)
      context.addIssue({ code: 'custom', message: '随机间隔下限不能大于上限' })
  })
export type ReplyPacing = z.infer<typeof replyPacingSchema>
export const defaultReplyPacing: ReplyPacing = {
  mode: 'random-1-3',
  customMinSeconds: 1,
  customMaxSeconds: 3,
}
export type Action = (typeof actions)[number]
export type CommandInput = Omit<BackendCommand, 'workspaceId' | 'values'> & {
  values?: Record<string, unknown>
}

export const storeSchema = z.object({
  id: z.string(),
  storeName: z.string(),
  platform: z.string(),
  group: z.string().default(''),
  aiEnabled: z.boolean(),
  sendMode: storeSendModeSchema.optional(),
  aiRestore: z
    .object({
      desiredEnabled: z.boolean(),
      status: z.enum(['waiting', 'restoring', 'restored', 'failed']),
      message: z.string().max(200),
    })
    .optional(),
  runtime: z.object({
    open: z.boolean().default(false),
    online: z.boolean().default(false),
    authenticated: z.boolean().nullable().optional(),
    awaitingClient: z.boolean().optional(),
    lastError: z.string().optional(),
    identityError: z.string().optional(),
    collectionError: z.string().optional(),
  }),
})
export type LocalStore = z.infer<typeof storeSchema>
export const productSchema = z.object({
  id: z.string(),
  version: z.number(),
  updatedAt: z.number(),
  storeId: z.string(),
  productId: z.string(),
  title: z.string(),
  description: z.string(),
  specifications: z.string(),
  price: z.string(),
  enabled: z.boolean(),
})
export type Product = z.infer<typeof productSchema>
export type ProductDraft = Pick<
  Product,
  'productId' | 'title' | 'description' | 'specifications' | 'price' | 'enabled'
> &
  Partial<Pick<Product, 'id' | 'version'>>
export const productsPageSchema = z.object({
  revision: z.number(),
  total: z.number(),
  items: z.array(productSchema),
})
export const importPreviewSchema = z.object({
  revision: z.number(),
  count: z.number(),
  duplicates: z.number().optional(),
  entries: z.number().optional(),
})
export const intentEntrySchema = z.object({
  question: z.string(),
  keywords: z.array(z.string()),
  answer: z.string(),
  enabled: z.boolean(),
})
export const intentSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string(),
  enabled: z.boolean(),
  storeIds: z.array(z.string()),
  productIds: z.array(z.string()),
  entries: z.array(intentEntrySchema),
  source: z.object({ type: z.string(), storeId: z.string(), uid: z.string() }).optional(),
})
export type IntentPack = z.infer<typeof intentSchema>
export const intentsSchema = z.object({ packs: z.array(intentSchema), revision: z.number() })
export const profileSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string(),
  prompt: z.string(),
  maxReplyChars: z.number(),
})
export type ModelProfile = z.infer<typeof profileSchema>
export const profilesSchema = z.object({
  revision: z.number(),
  profiles: z.array(profileSchema),
  bindings: z.record(z.string(), z.string()),
  globalPrompt: z.string(),
  globalMaxReplyChars: z.number(),
})
export const messageSchema = z.object({
  from: z.string(),
  content: z.string(),
  ts: z.number(),
  type: z.string().optional(),
  msgId: z.string().optional(),
})
export const conversationSchema = z.object({
  storeId: z.string(),
  uid: z.string(),
  name: z.string(),
  status: z.string(),
  messages: z.array(messageSchema),
  updatedAt: z.number().optional(),
})
export type Conversation = z.infer<typeof conversationSchema>
export const qualitySchema = z.object({
  id: z.string(),
  storeId: z.string(),
  uid: z.string(),
  name: z.string(),
  storeName: z.string(),
  platform: z.string(),
  status: z.enum(['pending', 'passed', 'problem']),
  note: z.string(),
  version: z.number(),
  updatedAt: z.number(),
  reviewedAt: z.number(),
  events: z.array(
    z.object({
      code: z.string(),
      buyerMessage: z.string(),
      reply: z.string(),
      delivery: z.string(),
      resolved: z.boolean(),
    }),
  ),
})
export type QualityRecord = z.infer<typeof qualitySchema>
export const workOrderSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  storeName: z.string(),
  type: z.string(),
  orderNo: z.string(),
  buyer: z.string(),
  priority: z.enum(['normal', 'urgent']),
  description: z.string(),
  status: z.enum(['pending', 'working', 'waiting', 'done']),
  createdAt: z.number(),
  updatedAt: z.number(),
  notes: z.array(z.object({ id: z.string(), text: z.string(), at: z.number() })),
})
export type WorkOrder = z.infer<typeof workOrderSchema>
export const snapshotSchema = z.object({
  reporting: reportingSnapshotSchema.nullable().default(null),
  managed: managedStateSchema.default(emptyManagedState),
  modelIssue: z
    .object({
      code: z.string(),
      message: z.string(),
      at: z.number(),
      requiresReview: z.boolean(),
      context: z
        .object({
          requestId: z.string().max(100).optional(),
          storeId: z.string().max(64).optional(),
          uid: z.string().max(200).optional(),
          storeName: z.string().max(120).optional(),
          buyerName: z.string().max(120).optional(),
        })
        .optional(),
    })
    .nullable()
    .default(null),
  review: reviewSnapshotSchema.default(emptyReview),
  workspaceId: z.string(),
  revision: z.number(),
  stores: z.array(storeSchema),
  config: z.object({
    ai: z.object({ baseUrl: z.string(), model: z.string(), systemPrompt: z.string() }),
    reply: z.object({
      // 旧版同一买家固定间隔：只作为审计/回退依据保留，不再由设置页写入。
      perUidMinIntervalMs: z.number().int().min(0).max(3600000).default(60000),
      pacing: replyPacingSchema.default(defaultReplyPacing),
      enabled: z.boolean(),
      maxReplyChars: z.number(),
      fallbackAfterMs: z.number(),
      fallbackText: z.string(),
    }),
    safety: z.object({
      handoffKeywords: z.array(z.string()),
      // 旧账号快照没有该字段，按未配置客服接管关键词处理。
      manualReplyKeywords: z.array(z.string()).default([]),
    }),
  }),
  capabilities: z.object({
    apiKeyConfigured: z.boolean(),
    modelMode: z.enum(['local', 'managed']),
    platforms: z.array(z.object({ id: z.string(), label: z.string() })),
    vision: z.object({
      supported: z.boolean(),
      model: z.string(),
      maxImages: z.number(),
      reason: z.string(),
    }),
  }),
  selection: z.object({ storeId: z.string(), conversationId: z.string() }),
  conversations: z.array(conversationSchema),
  quality: z.array(qualitySchema),
  workOrders: z.array(workOrderSchema),
  engine: z.record(
    z.string(),
    z.object({
      running: z.boolean().optional(),
      paused: z.boolean().optional(),
      replied: z.number().optional(),
      failed: z.number().optional(),
    }),
  ),
  bannedWords: z.array(z.object({ word: z.string(), replacement: z.string() })),
  handoffByStore: z.record(z.string(), z.object({ keywords: z.array(z.string()) })),
  welcomeByStore: z.record(z.string(), welcomeSettingSchema),
  visionByStore: z.record(z.string(), z.object({ enabled: z.boolean(), version: z.number() })),
  products: z.object({
    revision: z.number(),
    total: z.number(),
    byStore: z.record(z.string(), z.number()),
  }),
  auxiliary: z.object({
    drafts: z
      .array(z.object({ storeId: z.string(), uid: z.string(), text: z.string() }))
      .default([]),
  }),
})
export type ParsedBackendSnapshot = z.infer<typeof snapshotSchema>
/**
 * 解析后的快照一定带欢迎延迟默认值；类型上仍允许旧夹具省略两个字段，
 * 界面和存储边界统一用 normalizeWelcomeSetting 补齐，避免旧数据编译失败或被误读为 0 秒。
 */
export type BackendSnapshot = Omit<ParsedBackendSnapshot, 'welcomeByStore'> & {
  welcomeByStore: Record<string, WelcomeSetting>
}
export const resultSchema = z.object({
  status: z.literal('ok'),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
})
export type BackendResult = z.infer<typeof resultSchema>
export interface BackendEvent {
  type: string
  revision?: number
}
export interface BackendBridge {
  snapshot(): Promise<BackendSnapshot>
  execute(command: BackendCommand): Promise<BackendResult>
  subscribe(listener: (event: BackendEvent) => void): () => void
  presentStore(storeId: string, visible: boolean): Promise<void>
}

export function emptySnapshot(): BackendSnapshot {
  return {
    reporting: null,
    managed: emptyManagedState(),
    modelIssue: null,
    review: emptyReview(),
    workspaceId: '',
    revision: 0,
    stores: [],
    conversations: [],
    quality: [],
    workOrders: [],
    engine: {},
    config: {
      ai: { baseUrl: '', model: '', systemPrompt: '' },
      reply: {
        enabled: false,
        maxReplyChars: 200,
        fallbackAfterMs: 0,
        fallbackText: '',
        perUidMinIntervalMs: 60000,
        pacing: { ...defaultReplyPacing },
      },
      safety: { handoffKeywords: [], manualReplyKeywords: [] },
    },
    selection: { storeId: '', conversationId: '' },
    capabilities: {
      apiKeyConfigured: false,
      modelMode: 'local',
      platforms: [
        { id: 'pdd-web', label: '拼多多' },
        { id: 'doudian-client', label: '抖店客户端' },
      ],
      vision: {
        supported: false,
        model: '',
        maxImages: 4,
        reason: '请先在桌面中配置支持识图的模型',
      },
    },
    bannedWords: [],
    handoffByStore: {},
    welcomeByStore: {},
    visionByStore: {},
    products: { revision: 0, total: 0, byStore: {} },
    auxiliary: { drafts: [] },
  }
}
