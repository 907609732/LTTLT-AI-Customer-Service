import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { validateManagedServiceRequest } from './managed-service-request'
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
  init(): Promise<unknown>
  snapshot(): unknown
  beginLogin(): Promise<unknown>
  cancelLogin(): Promise<unknown>
  logout(): Promise<unknown>
  refresh(): Promise<unknown>
  chat(
    payload: { client_request_id: string; messages: unknown },
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
  const dataDir =
    active.mode === 'local'
      ? options.rootDir
      : path.join(
          options.rootDir,
          'managed-workspaces',
          hash(active.apiOrigin),
          workspaceUser === null ? 'pending-login' : hash(JSON.stringify(workspaceUser)),
        )
  let state = emptyManagedSession()
  let identityError = ''
  let closed = false
  const submissions = new Map<string, string>()
  const requiresRestart = () =>
    JSON.stringify(active) !== JSON.stringify(configured) ||
    (active.mode === 'managed' && state.account !== null && state.account.userId !== workspaceUser)
  const session = options.factory.createManagedSession({
    origin: active.apiOrigin,
    portalOrigin: active.portalOrigin,
    credentialFile: path.join(authDir, 'session.enc'),
    safeStorage: options.safeStorage,
    openExternal: options.transport?.openExternal ?? options.openExternal,
    fetchImpl: (url: string | URL | Request, init?: RequestInit) => {
      // Emit submission evidence only immediately before the real chat fetch, not token refresh.
      if (
        String(url) === active.apiOrigin + '/api/client/chat/completions' &&
        typeof init?.body === 'string'
      ) {
        const request = JSON.parse(init.body) as { client_request_id?: string }
        const traceId = request.client_request_id
          ? submissions.get(request.client_request_id)
          : undefined
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
  return {
    active,
    dataDir,
    partitionNamespace:
      active.mode === 'local' ? 'yunduo-local' : 'yunduo-managed-' + hash(dataDir).slice(0, 16),
    snapshot,
    ready,
    canAccessWorkspace() {
      return (
        active.mode === 'local' ||
        (!requiresRestart() &&
          !identityError &&
          state.account !== null &&
          state.account.userId === workspaceUser &&
          ['signed_in', 'offline'].includes(state.status))
      )
    },
    async init() {
      if (active.mode === 'managed') await session.init()
    },
    async execute(action: string, values: unknown) {
      if (closed) throw new Error('托管连接已关闭')
      if (action === 'save-model-source') {
        const next = validateModelSource(values)
        options.stopAi()
        writeAtomic(sourceFile, next)
        configured = next
      } else {
        z.object({}).strict().parse(values)
        if (['managed-login', 'managed-logout', 'managed-cancel-login'].includes(action))
          options.stopAi()
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
      payload: { client_request_id: string; messages: unknown },
      requestOptions: { signal?: AbortSignal; traceId?: string },
    ) {
      ready()
      if (requestOptions.traceId) submissions.set(payload.client_request_id, requestOptions.traceId)
      try {
        return await session.chat(payload, requestOptions)
      } finally {
        submissions.delete(payload.client_request_id)
      }
    },
    capabilities() {
      return state.account?.capabilities ?? {}
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
      session.dispose()
    },
  }
}
