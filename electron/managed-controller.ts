import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { validateManagedServiceRequest } from './managed-service-request'
import {
  MANAGED_CONTEXT_POLICY_TTL_MS,
  managedContextPolicySchema,
  type ManagedContextPolicy,
} from './managed-context-policy'
import type { ManagedSummaryInput } from './managed-context'
import {
  defaultModelSource,
  emptyManagedSession,
  managedSessionSchema,
  modelSourceSchema,
  type ModelSource,
} from '../src/shared/contracts/managed'

interface SafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export interface ManagedSession {
  serviceRequest?(
    endpoint: string,
    options: { method: string; body?: unknown; signal?: AbortSignal },
  ): Promise<unknown>
  /** Fixed authenticated POST /api/client/chat/summaries; free auxiliary request bound to one reply. */
  summarize?(payload: ManagedSummaryInput, options: { signal?: AbortSignal }): Promise<unknown>
  /** Fixed authenticated GET /api/client/config; never a caller-selected URL. */
  config(options?: { signal?: AbortSignal }): Promise<unknown>
  init(): Promise<unknown>
  snapshot(): unknown
  beginLogin(): Promise<unknown>
  cancelLogin(): Promise<unknown>
  logout(): Promise<unknown>
  refresh(): Promise<unknown>
  chat(
    payload: {
      client_request_id: string
      messages: unknown
      purpose?: 'reply' | 'learning'
      policy_version?: number
      learning_source?: 'pdd_detail_text' | 'pdd_detail_image'
    },
    options: { signal?: AbortSignal },
  ): Promise<unknown>
  dispose(): void
}
export interface ManagedSessionFactory {
  createManagedSession(options: Record<string, unknown>): ManagedSession
  ManagedSessionError: new (code: string) => Error
}
export interface ManagedTransport {
  fetchImpl?: typeof fetch
  openExternal?: (url: string) => Promise<void>
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}

function readOptional(file: string): unknown {
  if (!fs.existsSync(file)) return undefined
  if (fs.statSync(file).size > 65536) throw new Error('模型来源配置过大，请检查本机配置文件')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
function writeAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}
function origin(raw: string) {
  const url = new URL(raw)
  // Explicit loopback configuration supports the user's certificate-free local server.
  const localHttp = url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port
  if (
    (url.protocol !== 'https:' && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('托管地址须为 HTTPS 来源；本机调试仅允许带端口的 http://127.0.0.1')
  return url.origin
}
export function validateModelSource(value: unknown): ModelSource {
  const source = modelSourceSchema.parse(value)
  return {
    mode: source.mode,
    apiOrigin: origin(source.apiOrigin),
    portalOrigin: origin(source.portalOrigin),
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const identitySchema = z
  .object({ userId: z.union([z.number().int().positive(), z.string().min(1).max(512)]) })
  .strict()
// Unknown transport fields (for example a client max_tokens claim) are stripped;
// only the typed purpose/revision/source may accompany the legacy chat body.
const managedChatPayloadSchema = z
  .object({
    client_request_id: z.string().min(1).max(128),
    messages: z.unknown(),
    purpose: z.enum(['reply', 'learning']).optional(),
    policy_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    learning_source: z.enum(['pdd_detail_text', 'pdd_detail_image']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.learning_source !== undefined && value.purpose !== 'learning')
      ctx.addIssue({ code: 'custom', message: '学习来源只能用于学习请求' })
    if (value.policy_version !== undefined && value.purpose === undefined)
      ctx.addIssue({ code: 'custom', message: '策略版本必须随用途一起发送' })
  })
// 摘要正文只允许不可信历史 JSON；父请求 ID 与 token 预算按服务端口径预先核对。
const managedSummarySchema = z
  .object({
    parent_request_id: z
      .string()
      .regex(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/),
    history: z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value) <= 96 * 1024, '摘要资料超过上限'),
    max_tokens: z.number().int().min(1).max(7000),
  })
  .strict()
const managedSummaryResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) }).strict()).min(1),
})

/** Reuse the pinned encrypted device/session protocol. No bearer or refresh token enters the DTO. */
export function createManagedController(options: {
  rootDir: string
  factory: ManagedSessionFactory
  safeStorage: SafeStorage
  openExternal(url: string): Promise<void>
  stopAi(): void
  changed(): void
  submitted?(traceId: string): void
  transport?: ManagedTransport
}) {
  const sourceFile = path.join(options.rootDir, 'model-source.json')
  const initial = readOptional(sourceFile)
  const active = initial === undefined ? { ...defaultModelSource } : validateModelSource(initial)
  let configured = { ...active }
  const authDir = path.join(options.rootDir, 'managed-auth', hash(active.apiOrigin))
  const identityFile = path.join(authDir, 'last-account.json')
  const identity = identitySchema.optional().parse(readOptional(identityFile))
  const workspaceUser = identity?.userId ?? null
  // 用户明确要求取消本机/托管账号的工作区隔离：所有模式和账号共用同一本机业务目录。
  // 旧 managed-workspaces/<来源>/<账号>/ 保留在磁盘上但不再读取或自动合并。
  const dataDir = options.rootDir
  let state = emptyManagedSession()
  let identityError = ''
  let closed = false
  const submissions = new Map<string, string>()
  // 摘要属于当前账号的生成流程：登出、换账号、改来源或换店时立刻取消。
  const summaries = new Set<AbortController>()
  const cancelSummaries = () => {
    for (const controller of summaries) controller.abort()
    summaries.clear()
  }
  const requiresRestart = () =>
    JSON.stringify(active) !== JSON.stringify(configured) ||
    (active.mode === 'managed' && state.account !== null && state.account.userId !== workspaceUser)
  // The policy is account/source scoped and short-lived. A logout, account
  // switch, source change or restart state invalidates it immediately.
  let policyCache: { key: string; expiresAt: number; value: ManagedContextPolicy } | null = null
  const clearPolicyCache = () => {
    policyCache = null
  }
  const policyIdentity = () => {
    if (active.mode !== 'managed' || state.status !== 'signed_in' || !state.account) return null
    if (identityError || requiresRestart()) return null
    return active.apiOrigin + '\n' + String(state.account.userId)
  }
  // 摘要与策略同属账号/来源：身份一变就取消进行中的摘要，不把旧账号摘要交给新账号。
  const summaryIdentity = () =>
    `${active.mode}\n${active.apiOrigin}\n${
      state.status === 'signed_in' && state.account ? String(state.account.userId) : ''
    }`
  let summaryKey = summaryIdentity()
  const syncSummaryIdentity = () => {
    const next = summaryIdentity()
    if (next === summaryKey) return
    summaryKey = next
    cancelSummaries()
  }
  const session = options.factory.createManagedSession({
    origin: active.apiOrigin,
    portalOrigin: active.portalOrigin,
    credentialFile: path.join(authDir, 'session.enc'),
    safeStorage: options.safeStorage,
    openExternal: options.transport?.openExternal ?? options.openExternal,
    fetchImpl: (url: string | URL | Request, init?: RequestInit) => {
      // Emit submission evidence only immediately before the real chat fetch, not token refresh.
      if (
        ['/api/client/chat/completions', '/api/client/chat/summaries'].some(
          (path) => String(url) === active.apiOrigin + path,
        ) &&
        typeof init?.body === 'string'
      ) {
        const request = JSON.parse(init.body) as {
          client_request_id?: string
          parent_request_id?: string
        }
        const requestId = request.client_request_id ?? request.parent_request_id
        const traceId = requestId ? submissions.get(requestId) : undefined
        if (traceId) options.submitted?.(traceId)
      }
      return (options.transport?.fetchImpl ?? globalThis.fetch)(url, init)
    },
    ...(options.transport?.setTimeout ? { setTimeout: options.transport.setTimeout } : {}),
    ...(options.transport?.clearTimeout ? { clearTimeout: options.transport.clearTimeout } : {}),
    onChange(value: unknown) {
      if (closed) return
      state = managedSessionSchema.parse(value)
      if (state.status === 'signed_in' && state.account) {
        try {
          writeAtomic(identityFile, { userId: state.account.userId })
          identityError = ''
        } catch {
          identityError = '无法保存托管账号工作区标识，请检查本机目录权限后重试'
        }
      }
      if (policyCache && policyCache.key !== policyIdentity()) clearPolicyCache()
      syncSummaryIdentity()
      if (
        active.mode === 'managed' &&
        (state.status !== 'signed_in' || requiresRestart() || identityError)
      )
        options.stopAi()
      options.changed()
    },
  })
  const snapshot = () => ({
    active,
    configured,
    restartRequired: requiresRestart(),
    session: { ...state, message: identityError || state.message },
  })
  function requireAccount() {
    if (closed) throw new Error('托管连接已关闭')
    if (requiresRestart()) throw new Error('模型来源或账号已更改，请重启软件后使用 AI')
    if (identityError) throw new Error(identityError)
    if (state.status !== 'signed_in' || !state.account || workspaceUser !== state.account.userId)
      throw new options.factory.ManagedSessionError('session_expired')
  }
  function ready() {
    requireAccount()
    if (!state.account) throw new options.factory.ManagedSessionError('session_expired')
    if (state.account.trial.expiresAt <= Date.now() / 1000)
      throw new options.factory.ManagedSessionError('trial_expired')
    if (state.account.trial.remaining < 1)
      throw new options.factory.ManagedSessionError('trial_exhausted')
  }
  /**
   * Policy reads stay optional for the legacy reception path. Learning passes
   * strict=true so an old server, malformed projection or account switch fails
   * before the learning job can mark a paid request as submitted.
   */
  async function loadContextPolicy(
    strict: boolean,
    signal?: AbortSignal,
  ): Promise<ManagedContextPolicy | null> {
    if (closed) {
      if (!strict) return null
      throw new Error('托管连接已关闭；学习请求未发送')
    }
    if (signal?.aborted) throw new Error('知识任务已取消')
    const key = policyIdentity()
    if (!key) {
      clearPolicyCache()
      if (!strict) return null
      if (active.mode !== 'managed') throw new Error('当前不是托管模式；学习请求未发送')
      if (requiresRestart())
        throw new Error('模型来源或账号已更改，请重启软件后使用；学习请求未发送')
      if (identityError) throw new Error(`${identityError}；学习请求未发送`)
      throw new options.factory.ManagedSessionError('session_expired')
    }
    // Reception may reuse the short projection cache, but learning must read the
    // current revision immediately before its pre-submit checkpoint.
    if (!strict && policyCache?.key === key && policyCache.expiresAt > Date.now())
      return policyCache.value
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
    try {
      requireAccount()
      const raw = await session.config({ signal: requestSignal })
      // The account and source may change while the config request is in
      // flight; recheck both and discard any late projection.
      requireAccount()
      if (closed || policyIdentity() !== key || requiresRestart()) {
        clearPolicyCache()
        if (strict) throw new Error('托管账号或模型来源已变化；学习请求未发送，请重新读取策略')
        return null
      }
      const parsed = managedContextPolicySchema.safeParse(raw)
      if (!parsed.success) {
        // Old servers omit the policy fields; a damaged projection is never
        // replaced by an invented enabled policy.
        clearPolicyCache()
        if (strict)
          throw new Error(
            '当前托管服务未提供可校验的商品详情学习策略（可能为旧版服务端）；学习请求未发送，需要服务端支持后再试。',
          )
        return null
      }
      policyCache = {
        key,
        expiresAt: Date.now() + MANAGED_CONTEXT_POLICY_TTL_MS,
        value: parsed.data,
      }
      return parsed.data
    } catch (cause) {
      clearPolicyCache()
      if (!strict) return null
      if (signal?.aborted) throw new Error('知识任务已取消')
      if (
        cause instanceof Error &&
        (cause.message.startsWith('当前托管服务未提供') ||
          cause.message.includes('账号或模型来源已变化') ||
          cause.message.includes('账号已更改') ||
          cause.message.includes('托管连接已关闭'))
      )
        throw cause
      const message = cause instanceof Error ? cause.message : String(cause)
      const code = cause instanceof Error ? Reflect.get(cause, 'code') : undefined
      const error = new Error(
        code === 'canceled'
          ? '托管账号已切换或登出；学习请求未发送'
          : `托管学习策略读取失败：${message}；学习请求未发送，不会改用普通回复。`,
      )
      if (typeof code === 'string') Object.assign(error, { code })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    active,
    dataDir,
    // 单一分区命名保留已有本机店铺的登录态；托管登录不再创建另一套平台会话。
    partitionNamespace: 'yunduo-local',
    snapshot,
    ready,
    canAccessWorkspace() {
      // 业务数据属于本机工作区，登录只决定托管 AI、团队与计费资格，不再隐藏店铺。
      return !closed
    },
    async init() {
      if (active.mode === 'managed') await session.init()
    },
    async execute(action: string, values: unknown) {
      if (closed) throw new Error('托管连接已关闭')
      // 登录/登出/改来源都会改变免费摘要的归属，先取消进行中的摘要请求。
      if (
        ['save-model-source', 'managed-login', 'managed-logout', 'managed-cancel-login'].includes(
          action,
        )
      )
        cancelSummaries()
      if (action === 'save-model-source') {
        const next = validateModelSource(values)
        options.stopAi()
        clearPolicyCache()
        writeAtomic(sourceFile, next)
        configured = next
      } else {
        z.object({}).strict().parse(values)
        if (['managed-login', 'managed-logout', 'managed-cancel-login'].includes(action))
          options.stopAi()
        if (['managed-logout', 'managed-cancel-login'].includes(action)) clearPolicyCache()
        if (action === 'managed-logout') await session.logout()
        else if (action === 'managed-cancel-login') await session.cancelLogin()
        else {
          if (requiresRestart()) throw new Error('请先重启软件，使模型来源和账号工作区生效')
          if (action === 'managed-login') await session.beginLogin()
          else if (action === 'managed-refresh') {
            if (state.status === 'signed_out') await session.init()
            else await session.refresh()
          } else if (action === 'open-managed-admin')
            await options.openExternal(active.portalOrigin + '/lingtu/admin')
          else throw new Error('不支持的托管操作')
        }
      }
      options.changed()
      return {
        status: 'ok' as const,
        message: requiresRestart()
          ? '设置或账号已保存，请重启软件后生效；AI 保持关闭。'
          : action === 'open-managed-admin'
            ? '管理后台已在浏览器打开。'
            : '托管状态已更新；不会自动开启 AI。',
        data: {},
      }
    },
    async chat(
      payload: {
        client_request_id: string
        messages: unknown
        purpose?: 'reply' | 'learning'
        policy_version?: number
        learning_source?: 'pdd_detail_text' | 'pdd_detail_image'
      },
      requestOptions: { signal?: AbortSignal; traceId?: string },
    ) {
      ready()
      const request = managedChatPayloadSchema.parse(payload)
      if (requestOptions.traceId) submissions.set(request.client_request_id, requestOptions.traceId)
      try {
        return await session.chat(request, requestOptions)
      } finally {
        submissions.delete(request.client_request_id)
      }
    },
    capabilities() {
      return state.account?.capabilities ?? {}
    },
    /**
     * 免费托管摘要：仅转发不可信历史 JSON 与 token 预算，不携带系统规则或客户端 max_tokens
     * 之外的声明。请求受 60 秒上限、外部取消信号与账号/来源变化约束。
     */
    async summarize(
      payload: ManagedSummaryInput,
      traceId?: string,
      signal?: AbortSignal,
    ): Promise<string> {
      ready()
      if (!session.summarize) throw new Error('托管服务暂不支持内部摘要，请更新服务端和客户端')
      const request = managedSummarySchema.parse(payload)
      const controller = new AbortController()
      summaries.add(controller)
      const timer = setTimeout(() => controller.abort(), 60000)
      if (traceId) submissions.set(request.parent_request_id, traceId)
      try {
        const raw = await session.summarize(request, {
          signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        })
        // 账号或来源可能在请求期间变化：迟到的摘要不再交给压缩器复用。
        requireAccount()
        return managedSummaryResponseSchema.parse(raw).choices[0]!.message.content
      } finally {
        clearTimeout(timer)
        summaries.delete(controller)
        submissions.delete(request.parent_request_id)
      }
    },
    async learningPolicy(input: {
      learningSource: 'pdd_detail_text' | 'pdd_detail_image'
      withImages: boolean
      signal?: AbortSignal
    }): Promise<{ policyVersion: number; maxTokens: number; maxCallsPerProduct: number }> {
      ready()
      const policy = await loadContextPolicy(true, input.signal)
      if (!policy)
        throw new Error(
          '当前托管服务未提供商品详情学习策略；学习请求未发送，需要服务端支持后再试。',
        )
      if (!policy.learning.enabled)
        throw new Error('当前托管账号未开通商品详情学习；学习请求未发送')
      if (!policy.learning.allowed_sources.includes(input.learningSource))
        throw new Error('当前学习策略未允许该商品详情来源；学习请求未发送')
      if (input.withImages && !policy.learning.vision_enabled)
        throw new Error('当前学习策略未允许图片学习；学习请求未发送')
      if (input.withImages && state.account?.capabilities?.vision !== true)
        throw new Error('当前托管账号未提供图片学习能力；学习请求未发送')
      requireAccount()
      return {
        policyVersion: policy.policy_version,
        maxTokens: policy.learning.max_output_tokens,
        maxCallsPerProduct: policy.learning.max_calls_per_product,
      }
    },
    async contextPolicy(): Promise<ManagedContextPolicy | null> {
      return loadContextPolicy(false)
    },
    async serviceRequest(
      endpoint: string,
      input: { method?: string; body?: unknown; signal?: AbortSignal } = {},
    ) {
      const { signal, ...parameters } = input
      const request = validateManagedServiceRequest(endpoint, parameters)
      requireAccount()
      if (!session.serviceRequest) throw new Error('当前托管会话不支持团队或计费业务，请更新客户端')
      const result = await session.serviceRequest(request.endpoint, {
        method: request.method,
        body: request.body,
        signal,
      })
      requireAccount()
      return result
    },
    dispose() {
      closed = true
      cancelSummaries()
      clearPolicyCache()
      session.dispose()
    },
  }
}
