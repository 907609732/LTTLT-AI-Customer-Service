import { createRequire } from 'node:module'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import {
  createManagedController,
  type ManagedSessionFactory,
  type ManagedTransport,
} from './managed-controller'
import {
  commandSchema,
  snapshotSchema,
  resultSchema,
  emptySnapshot,
  type BackendCommand,
  type BackendEvent,
  type BackendResult,
} from '../src/shared/contracts/backend'
import { isTrustedRenderer, isAppWebContents, createWindow, loadRenderer } from './windows'
import { localVisionCapability } from './model-capabilities'
import { ReviewConsole, type SendProposal } from './review-console'
import { configureDomTextAdapter } from './dom-text-adapter'
import { createAssistedContext } from './generic-phrases'
import { createConversationThread } from './conversation-context'
import type { WorkerObservation } from './message-diagnostics'
import {
  SIM_PLATFORM_ID,
  SIM_PLATFORM_LABEL,
  type SimulatorActionResult,
  type SimulatorStatus,
} from '../src/shared/contracts/simulation'
import { SimHub } from './sim-hub'
import { emptyReview } from '../src/shared/contracts/review'
import { createSimAdapter } from './sim-adapter'
import { createSimManagerFactory } from './sim-manager'
import { createSimServer } from './sim-server'
import {
  assistCollectionUrl,
  isAllowedAssistUrl,
  createAssistPlatformHost,
  type AssistPlatform,
} from './assist-platform-host'
import { createAssistPlatformCollector } from './assist-platform-collector'
import { createAssistPlatformReader } from './assist-platform-reader'
import { pddTicketDetailId } from './assist-platform-pdd'
import { registerStoreBrowserEnvironment } from './store-browser'
import {
  openAssistPlatformItemSchema,
  refreshAssistPlatformSchema,
  type OpenAssistPlatformItemInput,
  type RefreshAssistPlatformInput,
} from '../src/shared/contracts/platform-items'

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
  /** Test-only dependency injection; production has no environment or renderer override. */
  managedTransport?: ManagedTransport
}) {
  const workspaceId = randomUUID()
  const listeners = new Set<(event: BackendEvent) => void>()
  let closed = false
  // 上游工厂可能在装配期间产生回调，引用就绪前不读取其快照。
  const backendRef: { current?: UpstreamBackend } = {}
  const managed = createManagedController({
    rootDir: options.dataDir,
    factory: loadFactory<ManagedSessionFactory>(
      'electron/managed-session.cjs',
      'createManagedSession',
    ),
    safeStorage,
    openExternal: (url) => shell.openExternal(url),
    stopAi: () => backendRef.current?.stopAi(),
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'managed:changed' })
    },
    submitted: (traceId) => review.trace({ type: 'submitted', traceId }),
    transport: options.managedTransport,
  })
  const dataDir = managed.dataDir
  const disposeBrowserEnvironment = registerStoreBrowserEnvironment({
    app,
    namespace: managed.partitionNamespace,
    chromiumVersion: process.versions.chrome,
    userDataDir: app.getPath('userData'),
  })
  const assistHost = createAssistPlatformHost({
    namespace: managed.partitionNamespace,
    getParent: options.getWindow,
    createWindow: (partition) =>
      new BrowserWindow({
        width: 1200,
        height: 850,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      }),
  })
  let logWindow: BrowserWindow | undefined
  const notifyReview = () => {
    if (!closed) for (const listener of listeners) listener({ type: 'review:changed' })
  }
  const read = () => {
    const masked = emptySnapshot()
    masked.capabilities.modelMode = managed.active.mode
    // A newly signed-in account must not see or mutate the previous account's records before restart.
    return snapshotSchema.parse({
      ...(managed.canAccessWorkspace()
        ? (backendRef.current?.snapshot() as Record<string, unknown>)
        : masked),
      workspaceId,
      managed: managed.snapshot(),
    })
  }
  const assistStores = () => {
    if (closed || !managed.canAccessWorkspace()) return []
    const raw = backendRef.current?.snapshot() as
      | { stores?: { id: string; storeName: string; platform: string; mallId?: string }[] }
      | undefined
    return (raw?.stores ?? []).map((store) => ({
      id: store.id,
      storeName: store.storeName,
      platform: store.platform,
      identityId: store.mallId || undefined,
    }))
  }
  const assistDetails = new Map<string, string>()
  const observedAssistDetails = new Map<string, string>()
  const assistCollector = createAssistPlatformCollector({
    workspaceId,
    stores: assistStores,
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'assist-platform:changed' })
    },
    read: createAssistPlatformReader({
      page: assistHost.page,
      collectionPage: assistHost.collectionPage,
      observeTicketDetail: assistHost.observeTicketDetail,
      rememberDetail: (storeId, kind, id, url) => {
        observedAssistDetails.set(`${storeId}:${kind}:${id}`, url)
        if (observedAssistDetails.size > 1000)
          observedAssistDetails.delete(observedAssistDetails.keys().next().value!)
      },
      identityScript: () =>
        loadFactory<{ buildIdentityScript(options: { timeoutMs: number }): string }>(
          'desk-v1/src/adapters/pdd-identity.js',
          'buildIdentityScript',
        ).buildIdentityScript({ timeoutMs: 5000 }),
    }),
  })
  const assistSnapshot = () => {
    const snapshot = assistCollector.snapshot()
    const published = new Set(
      snapshot.stores.flatMap((store) =>
        store.items.map((item) => `${store.storeId}:${store.kind}:${item.id}`),
      ),
    )
    for (const key of published) {
      const target = observedAssistDetails.get(key)
      if (target) {
        assistDetails.set(key, target)
        observedAssistDetails.delete(key)
      }
    }
    for (const key of assistDetails.keys()) if (!published.has(key)) assistDetails.delete(key)
    return snapshot
  }
  const review = new ReviewConsole(
    read,
    notifyReview,
    (id) => backendRef.current?.engine?.worker(id) ?? undefined,
  )
  const traceModel = (event: unknown) => {
    if (managed.active.mode === 'managed' && event && typeof event === 'object')
      return review.trace({
        ...event,
        model: managed.snapshot().session.account?.capabilities?.model || '托管模型（待授权）',
      })
    return review.trace(event)
  }
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
  // 本机模拟店铺的数据只落在本地数据目录：主进程独占读写，渲染层只经业务快照看到结果。
  const simHub = new SimHub({ file: path.join(dataDir, 'simulator-stores.json') })
  const simStores = () => {
    if (closed) return []
    return read()
      .stores.filter((store) => store.platform === SIM_PLATFORM_ID)
      .map((store) => ({ storeId: store.id, storeName: store.storeName }))
  }
  // 顾客模拟页只监听回环地址、只服务本机模拟店铺，地址里带本次运行的一次性口令。
  const simServer = createSimServer({
    hub: simHub,
    listStores: simStores,
    ensureStore(storeId: string) {
      const store = simStores().find((item) => item.storeId === storeId)
      if (!store) return false
      // 页面能在店铺关闭后继续加载，但消息只有在店铺打开（采集启动）后才会进入业务会话。
      if (!simHub.isOpen(storeId)) simHub.attach(storeId, store.storeName)
      return true
    },
    log: (message: string) => console.log(`[模拟顾客页] ${message}`),
  })
  const host = loadFactory<PlatformFactory>(
    'electron/platform-host.cjs',
    'createPlatformHost',
  ).createPlatformHost({
    dataDir,
    partitionNamespace: managed.partitionNamespace,
    allowExternalClient: true,
    getWindow: options.getWindow,
  })
  const backend = loadFactory<BackendFactory>(
    'electron/backend.cjs',
    'createBackend',
  ).createBackend({
    dataDir,
    // 项目自有平台 id 由这里注入，拼多多/抖店等真实平台的默认清单不受影响。
    extraPlatforms: [{ id: SIM_PLATFORM_ID, label: SIM_PLATFORM_LABEL }],
    adapterFactory: (store: { id: string; storeName?: string; platform: string }, deps: unknown) =>
      store.platform === SIM_PLATFORM_ID
        ? createSimAdapter(store, simHub)
        : // 必须先做文案改写再交给厂商工厂：厂商适配器表里没有 sim-local，未知平台会直接抛错。
          configureDomTextAdapter(store.platform, host.adapterFactory(store, deps)),
    managerFactory: createSimManagerFactory(
      host.managerFactory as (deps: Record<string, unknown>) => never,
      simHub,
    ),
    safeStorage,
    modelMode: managed.active.mode,
    managedChat: (
      payload: { client_request_id: string; messages: unknown },
      requestOptions: { signal?: AbortSignal; traceId?: string },
    ) => managed.chat(payload, requestOptions),
    managedReady: () => managed.ready(),
    managedCapabilities: () => managed.capabilities(),
    localVisionSupport: localVisionCapability,
    prepareModelContext: createAssistedContext(traceModel),
    resolveConversationThread: createConversationThread(() => read().conversations),
    beforeSend: (proposal: SendProposal) => {
      const decision = review.propose(proposal)
      // 有候选时主动显示确认窗；关窗不会替用户批准，也不影响继续采集日志。
      void openLogs().catch(() => notifyReview())
      return decision
    },
    onModelTrace: traceModel,
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
    start: async () => {
      await managed.init()
      await host.start()
    },
    snapshot: () =>
      snapshotSchema.parse({
        ...read(),
        review: managed.canAccessWorkspace() ? review.snapshot() : emptyReview(),
      }),
    async execute(input: BackendCommand): Promise<BackendResult> {
      if (closed) throw new Error('本地服务已关闭')
      const command = commandSchema.parse(input)
      if (command.workspaceId !== workspaceId) throw new Error('本地服务已重启，请刷新后重试')
      if (
        [
          'save-model-source',
          'managed-login',
          'managed-cancel-login',
          'managed-refresh',
          'managed-logout',
          'open-managed-admin',
        ].includes(command.action)
      )
        return managed.execute(command.action, command.values)
      if (
        !managed.canAccessWorkspace() &&
        !(command.action === 'review-reply' && command.values.approve === false)
      )
        throw new Error(
          managed.snapshot().restartRequired
            ? '账号工作区已改变，请重启软件后操作'
            : '请先登录并恢复托管账号，再操作该账号的店铺数据',
        )
      const startsAi =
        ['resume-ai', 'resume-conversation', 'start-training'].includes(command.action) ||
        (command.action === 'set-ai' && command.values.enabled !== false) ||
        (command.action === 'batch' && command.values.operation !== 'disable') ||
        (command.action === 'review-reply' && command.values.approve === true)
      if (managed.snapshot().restartRequired && startsAi)
        throw new Error('模型来源或账号已改变，请重启软件；旧候选不能继续发送')
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
      const result = resultSchema.parse(await localBackend.execute(raw))
      // 删除店铺时同步清空本机模拟数据，避免残留顾客被下一次同名店铺复用。
      if (command.action === 'remove-store' && command.storeId) simHub.forget(command.storeId)
      return result
    },
    assistPlatformSnapshot() {
      return assistSnapshot()
    },
    setAssistPlatformActive(active: boolean) {
      assistCollector.setActive(active)
      if (!active) assistHost.stopCollecting()
    },
    async refreshAssistPlatform(input: RefreshAssistPlatformInput) {
      const request = refreshAssistPlatformSchema.parse(input)
      if (closed || request.workspaceId !== workspaceId || !managed.canAccessWorkspace())
        throw new Error('店铺工作区已改变，请重新打开辅助中心')
      await assistCollector.refresh(request.storeId, request.kind)
      return assistSnapshot()
    },
    async openAssistPlatformItem(input: OpenAssistPlatformItemInput) {
      const request = openAssistPlatformItemSchema.parse(input)
      if (closed || request.workspaceId !== workspaceId || !managed.canAccessWorkspace())
        throw new Error('店铺工作区已改变，请重新打开辅助中心')
      const store = assistStores().find((item) => item.id === request.storeId)
      if (!store || !['pdd-web', 'doudian-client'].includes(store.platform))
        throw new Error('此店铺尚未接入平台后台')
      if (store.platform !== 'pdd-web') throw new Error('抖店平台工单和售后暂未接入')
      if (request.id) {
        const record = assistSnapshot().stores.find(
          (item) => item.storeId === request.storeId && item.kind === request.kind,
        )
        const row = record?.items.find((item) => item.id === request.id)
        const target = assistDetails.get(`${request.storeId}:${request.kind}:${request.id}`)
        if (
          !row ||
          record?.status !== 'success' ||
          !target ||
          request.kind !== 'ticket' ||
          pddTicketDetailId(target) !== request.id
        )
          throw new Error('此记录的详情页面不可用，请先刷新平台列表')
        const page =
          assistHost.page(store.id) ?? assistHost.collectionContents(store.id, request.kind)
        if (!page || !isAllowedAssistUrl('pdd-web', page.getURL()))
          throw new Error('平台后台已关闭，请先刷新同步后查看详情')
        const identity: unknown = await page.executeJavaScript(
          loadFactory<{
            buildIdentityScript(options: { timeoutMs: number; refresh: boolean }): string
          }>('desk-v1/src/adapters/pdd-identity.js', 'buildIdentityScript').buildIdentityScript({
            timeoutMs: 5000,
            refresh: true,
          }),
        )
        const matches =
          identity &&
          typeof identity === 'object' &&
          Reflect.get(identity, 'authenticated') === true &&
          (store.identityId
            ? Reflect.get(identity, 'mallId') === store.identityId
            : Boolean(store.storeName) && Reflect.get(identity, 'storeName') === store.storeName)
        if (!matches) {
          assistCollector.invalidateStore(
            store.id,
            '后台登录或店铺身份已改变，请核对店铺后手动刷新',
          )
          throw new Error('后台登录或店铺身份已改变，未打开旧工单详情')
        }
        if (closed || !managed.canAccessWorkspace())
          throw new Error('店铺工作区已改变，请重新打开辅助中心')
        await assistHost.open({ id: store.id, platform: 'pdd-web' }, target)
        return
      }
      await assistHost.open(
        { id: store.id, platform: store.platform as AssistPlatform },
        assistCollectionUrl(store.platform as AssistPlatform, request.kind),
        assistSnapshot().stores.some(
          (row) =>
            row.storeId === store.id &&
            row.kind === request.kind &&
            row.status === 'login_required',
        )
          ? request.kind
          : undefined,
      )
    },
    simulatorStatus(): SimulatorStatus {
      const status = simServer.status()
      return status.running ? status : { ...status, error: status.error || simHub.persistError }
    },
    async openSimulatorPage(): Promise<SimulatorActionResult> {
      if (closed) return { ok: false, message: '本地服务已关闭，请重启桌面端' }
      const stores = simStores()
      if (!stores.length)
        return {
          ok: false,
          message: '还没有本机模拟店铺，请先在“添加店铺”里选择“本机模拟店铺”。',
        }
      const target = stores.find((store) => simHub.isOpen(store.storeId)) ?? stores[0]!
      if (!simHub.isOpen(target.storeId)) {
        // 走正常业务命令打开店铺，采集链路才会随之启动，模拟顾客消息才能进入真实会话。
        try {
          await localBackend.execute({ action: 'open-store', storeId: target.storeId })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return { ok: false, message: `模拟店铺打开失败：${reason}` }
        }
      }
      const status = await simServer.start()
      if (!status.running)
        return { ok: false, message: status.error || '模拟顾客页启动失败，请稍后重试' }
      return {
        ok: true,
        message: `模拟顾客页已就绪（${target.storeName}）：${status.url}`,
      }
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
      assistCollector.dispose()
      disposeBrowserEnvironment()
      assistDetails.clear()
      observedAssistDetails.clear()
      assistHost.dispose()
      managed.dispose()
      review.dispose()
      if (logWindow && !logWindow.isDestroyed()) logWindow.destroy()
      listeners.clear()
      await simServer.dispose()
      localBackend.dispose()
      await host.close()
    },
  }
}
export type LocalRuntime = ReturnType<typeof createLocalRuntime>
