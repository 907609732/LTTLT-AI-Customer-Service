import { createRequire } from 'node:module'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, safeStorage, type IpcMainInvokeEvent } from 'electron'
import {
  commandSchema,
  snapshotSchema,
  resultSchema,
  type BackendCommand,
  type BackendEvent,
} from '../src/shared/contracts/backend'
import { isTrustedRenderer, isAppWebContents, createWindow, loadRenderer } from './windows'
import { localVisionCapability } from './model-capabilities'
import { ReviewConsole, type SendProposal } from './review-console'
import { configureDomTextAdapter } from './dom-text-adapter'
import { createContextCompressor } from './context-compression'
import { createConversationThread } from './conversation-context'
import type { WorkerObservation } from './message-diagnostics'

interface UpstreamBackend {
  engine?: { worker(storeId: string): WorkerObservation | null }
  snapshot(): unknown
  execute(command: unknown): Promise<unknown>
  stopAi(): void
  dispose(): void
}
interface PlatformHost {
  adapterFactory: (store: { platform: string }, deps: unknown) => unknown
  managerFactory: unknown
  start(): Promise<void>
  close(): Promise<void>
  setPresentation(value: { storeId: string; visible: boolean }): void
}
type BackendFactory = { createBackend(options: Record<string, unknown>): UpstreamBackend }
type PlatformFactory = { createPlatformHost(options: Record<string, unknown>): PlatformHost }

/** 唯一的第三方入口；最小兼容注入点见来源记录，跨进程数据经过本工程契约校验。 */
function loadFactory<T>(relative: string, method: string): T {
  const loader = createRequire(path.join(__dirname, 'main.cjs'))
  const value: unknown = loader(path.join(__dirname, '..', 'vendor', 'lingtu-runtime', relative))
  if (
    !value ||
    typeof value !== 'object' ||
    !(method in value) ||
    typeof Reflect.get(value, method) !== 'function'
  )
    throw new Error('本地运行时不完整，请恢复 vendor 目录')
  return value as T
}

export function requireAppFrame(event: IpcMainInvokeEvent): BrowserWindow {
  if (
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isAppWebContents(event.sender.id) ||
    !isTrustedRenderer(event.senderFrame.url)
  )
    throw new Error('不允许的业务接口调用来源')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('应用窗口已关闭')
  return win
}

export function createLocalRuntime(options: {
  dataDir: string
  getWindow: () => BrowserWindow | undefined
}) {
  const workspaceId = randomUUID()
  const listeners = new Set<(event: BackendEvent) => void>()
  let closed = false
  // 上游工厂可能在装配期间产生回调，引用就绪前不读取其快照。
  const backendRef: { current?: UpstreamBackend } = {}
  let logWindow: BrowserWindow | undefined
  const notifyReview = () => {
    if (!closed) for (const listener of listeners) listener({ type: 'review:changed' })
  }
  const read = () =>
    snapshotSchema.parse({
      ...(backendRef.current?.snapshot() as Record<string, unknown>),
      workspaceId,
    })
  const review = new ReviewConsole(
    read,
    notifyReview,
    (id) => backendRef.current?.engine?.worker(id) ?? undefined,
  )
  async function openLogs() {
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.show()
      logWindow.focus()
      return
    }
    const win = createWindow()
    logWindow = win
    win.setAlwaysOnTop(true)
    const parent = options.getWindow()
    const closeLog = () => {
      if (!win.isDestroyed()) win.destroy()
    }
    parent?.once('closed', closeLog)
    win.once('closed', () => {
      logWindow = undefined
      parent?.removeListener('closed', closeLog)
    })
    try {
      await loadRenderer(win, '/logs')
    } catch (error) {
      closeLog()
      throw error
    }
  }
  const host = loadFactory<PlatformFactory>(
    'electron/platform-host.cjs',
    'createPlatformHost',
  ).createPlatformHost({
    dataDir: options.dataDir,
    partitionNamespace: 'yunduo-local',
    allowExternalClient: true,
    getWindow: options.getWindow,
  })
  const backend = loadFactory<BackendFactory>(
    'electron/backend.cjs',
    'createBackend',
  ).createBackend({
    dataDir: options.dataDir,
    adapterFactory: (store: { platform: string }, deps: unknown) =>
      configureDomTextAdapter(store.platform, host.adapterFactory(store, deps)),
    managerFactory: host.managerFactory,
    safeStorage,
    modelMode: 'local',
    localVisionSupport: localVisionCapability,
    prepareModelContext: createContextCompressor((event) => review.trace(event)),
    resolveConversationThread: createConversationThread(() => read().conversations),
    beforeSend: (proposal: SendProposal) => {
      const decision = review.propose(proposal)
      // 有候选时主动显示确认窗；关窗不会替用户批准，也不影响继续采集日志。
      void openLogs().catch(() => notifyReview())
      return decision
    },
    onModelTrace: (event: unknown) => review.trace(event),
    onRuntimeEvent: (event: unknown) => review.event(event),
    allowExternalClient: true,
    onEvent(event: unknown) {
      if (closed || !event || typeof event !== 'object') return
      const type = Reflect.get(event, 'type')
      if (typeof type !== 'string') return
      const revision: unknown = Reflect.get(event, 'revision')
      const safeEvent: BackendEvent = {
        type,
        ...(typeof revision === 'number' ? { revision } : {}),
      }
      if (backendRef.current) review.sync()
      for (const listener of listeners) listener(safeEvent)
    },
  })
  backendRef.current = backend
  const localBackend = backend
  review.sync()
  return {
    start: () => host.start(),
    snapshot: () => snapshotSchema.parse({ ...read(), review: review.snapshot() }),
    async execute(input: BackendCommand) {
      if (closed) throw new Error('本地服务已关闭')
      const command = commandSchema.parse(input)
      if (command.workspaceId !== workspaceId) throw new Error('本地服务已重启，请刷新后重试')
      if (command.action === 'open-runtime-logs') {
        await openLogs()
        return { status: 'ok' as const, message: '日志窗口已打开', data: {} }
      }
      if (command.action === 'review-reply') {
        await review.decide(command.values)
        return { status: 'ok' as const, message: '确认操作已处理；以平台发送结果为准。', data: {} }
      }
      // 不允许厂商底层 SecretStore 的历史明文降级进入本工程业务入口。
      if (
        command.action === 'save-model-settings' &&
        command.values.apiKey &&
        !safeStorage.isEncryptionAvailable()
      )
        throw new Error('系统加密不可用，密钥未保存')
      const { workspaceId: _workspaceId, ...raw } = command
      void _workspaceId
      return resultSchema.parse(await localBackend.execute(raw))
    },
    subscribe(listener: (event: BackendEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    presentStore(storeId: string, visible: boolean) {
      if (
        visible &&
        !snapshotSchema
          .parse({ ...(localBackend.snapshot() as Record<string, unknown>), workspaceId })
          .stores.some((s) => s.id === storeId)
      )
        throw new Error('店铺不存在')
      host.setPresentation({ storeId, visible })
    },
    async dispose() {
      if (closed) return
      closed = true
      review.dispose()
      if (logWindow && !logWindow.isDestroyed()) logWindow.destroy()
      listeners.clear()
      localBackend.dispose()
      await host.close()
    },
  }
}
export type LocalRuntime = ReturnType<typeof createLocalRuntime>
