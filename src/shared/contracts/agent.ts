import { z } from 'zod'
import {
  agentConfigApplySchema,
  agentConfigGetSchema,
  agentConfigPreviewSchema,
} from './agent-settings'

const id = z.string().trim().min(1).max(200)
const workspace = { workspaceId: id }
const store = { ...workspace, storeId: id }
const page = {
  ...store,
  search: z.string().max(1000).default(''),
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
}
export const agentToolSchemas = {
  lingtu_status: z.object({}).strict(),
  lingtu_list_stores: z.object(workspace).strict(),
  lingtu_open_store: z.object(store).strict(),
  lingtu_summary: z.object(store).strict(),
  lingtu_list_products: z.object(page).strict(),
  lingtu_list_knowledge: z.object(page).strict(),
  lingtu_list_jobs: z.object(page).strict(),
  lingtu_read_catalog: z
    .object({
      ...store,
      search: z.string().max(1000).default(''),
      cursor: z.string().max(4000).default(''),
    })
    .strict(),
  lingtu_start_collection: z
    .object({
      ...store,
      requestId: id,
      identityVersion: id,
      scopeToken: id,
      productIds: z.array(id).min(1).max(1000),
      total: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  lingtu_save_draft: z
    .object({
      ...store,
      requestId: id,
      id: id.optional(),
      expectedRevision: z.number().int().positive().optional(),
      bindingId: id.optional(),
      question: z.string().min(1).max(4000),
      answer: z.string().min(1).max(30000),
      keywords: z.array(z.string().max(200)).max(100).default([]),
      field: z.enum(['fact', 'price', 'stock', 'activity']).default('fact'),
      sourceRefs: z
        .array(z.object({ sourceId: id, revision: z.number().int().positive() }).strict())
        .max(100)
        .default([]),
      expiresAt: z.number().int().positive().optional(),
    })
    .strict(),
  lingtu_config_schema: z.object({}).strict(),
  lingtu_get_config: agentConfigGetSchema,
  lingtu_preview_config: agentConfigPreviewSchema,
  lingtu_apply_config: agentConfigApplySchema,
} as const
export const agentCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('lingtu_status'), args: agentToolSchemas.lingtu_status }).strict(),
  z
    .object({ tool: z.literal('lingtu_list_stores'), args: agentToolSchemas.lingtu_list_stores })
    .strict(),
  z
    .object({ tool: z.literal('lingtu_open_store'), args: agentToolSchemas.lingtu_open_store })
    .strict(),
  z.object({ tool: z.literal('lingtu_summary'), args: agentToolSchemas.lingtu_summary }).strict(),
  z
    .object({
      tool: z.literal('lingtu_list_products'),
      args: agentToolSchemas.lingtu_list_products,
    })
    .strict(),
  z
    .object({
      tool: z.literal('lingtu_list_knowledge'),
      args: agentToolSchemas.lingtu_list_knowledge,
    })
    .strict(),
  z
    .object({ tool: z.literal('lingtu_list_jobs'), args: agentToolSchemas.lingtu_list_jobs })
    .strict(),
  z
    .object({ tool: z.literal('lingtu_read_catalog'), args: agentToolSchemas.lingtu_read_catalog })
    .strict(),
  z
    .object({
      tool: z.literal('lingtu_start_collection'),
      args: agentToolSchemas.lingtu_start_collection,
    })
    .strict(),
  z
    .object({ tool: z.literal('lingtu_save_draft'), args: agentToolSchemas.lingtu_save_draft })
    .strict(),
  z
    .object({
      tool: z.literal('lingtu_config_schema'),
      args: agentToolSchemas.lingtu_config_schema,
    })
    .strict(),
  z
    .object({ tool: z.literal('lingtu_get_config'), args: agentToolSchemas.lingtu_get_config })
    .strict(),
  z
    .object({
      tool: z.literal('lingtu_preview_config'),
      args: agentToolSchemas.lingtu_preview_config,
    })
    .strict(),
  z
    .object({
      tool: z.literal('lingtu_apply_config'),
      args: agentToolSchemas.lingtu_apply_config,
    })
    .strict(),
])
export const agentConnectionSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(1).max(65535),
    url: z.string().url(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((v) => v.url === `http://127.0.0.1:${v.port}/v1/tools/call`, '连接必须使用本机受限入口')
export type AgentToolName = keyof typeof agentToolSchemas
export const agentToolDescriptions: Record<AgentToolName, string> = {
  lingtu_status: '读取灵兔AI版本、当前工作区和登录状态。先调用此工具获取workspaceId；不返回凭据。',
  lingtu_list_stores: '列出当前账号已登记的店铺及连接状态，不读取其他账号。',
  lingtu_open_store: '打开已登记店铺的平台窗口；登录/验证码由用户完成，不开启AI。',
  lingtu_summary: '读取指定店铺知识库摘要。',
  lingtu_list_products: '分页查询指定店铺已有商品知识，最多100项。',
  lingtu_list_knowledge: '分页查询指定店铺知识及草稿，不发布知识。',
  lingtu_list_jobs: '分页查看指定店铺采集/学习任务状态，不返回任务内部路径或原始载荷。',
  lingtu_read_catalog:
    '读取已登录店铺的在售商品目录；返回identityVersion、scopeToken及商品ID供显式选择。不会自动采集、学习或发布。',
  lingtu_start_collection:
    '按read_catalog给出的同一目录范围，采集明确选择的商品ID。立即返回jobId；不会学习或发布。requestId必须唯一，网络结果未知时先查任务，不自动重试。',
  lingtu_save_draft:
    '保存本店知识草稿，来源标记为模型生成，保持待人工审核；不允许修改共享或其他店条目。编辑需id和expectedRevision。requestId防重复，不自动发布。',
  lingtu_config_schema:
    '列出可修改的配置分组、作用域、字段类型和范围；不含凭据、模型参数或任意命令，先调用此工具了解字段。',
  lingtu_get_config:
    '读取一个配置分组及version。回复间隔为全局；欢迎语和识图开关必须指定当前店铺storeId。不返回密钥。',
  lingtu_preview_config:
    '预览一个严格的部分配置补丁，返回当前值、修改后值和差异；不写盘、不改变任何设置。',
  lingtu_apply_config:
    '提交一个配置分组的部分修改，将get/preview返回的version原样填入expectedVersion，并提供唯一requestId。复用现有保存与版本CAS；不修改AI开关、发送审批、凭据或模型参数。结果未知时先重新读取，不自动重试。',
}
