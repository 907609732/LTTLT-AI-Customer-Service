import { createCollectedProductWriter } from './collected-products'
import { createPlatformProductStore } from './platform-product-store'
import { createProductSpecContext } from './product-spec-context'
import { createProductCatalog } from './product-catalog'
import { applyStoreZoom } from './store-zoom'
import { createStoreBackendOpener } from './store-backend'
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
  intentsSchema,
  productsPageSchema,
  type Product,
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
  assistBackendUrl,
  isAllowedAssistUrl,
  createAssistPlatformHost,
  type AssistPlatform,
} from './assist-platform-host'
import { createAssistPlatformCollector } from './assist-platform-collector'
import { createAssistPlatformReader } from './assist-platform-reader'
import { pddDetailId } from './assist-platform-pdd'
import { registerStoreBrowserEnvironment } from './store-browser'
import { createReportingPipeline } from './reporting-pipeline'
import { createStoreSync } from './store-sync-service'
import { createFileScheduler } from './scheduler-storage'
import { createFileReceptionAutomation } from './reception-automation-storage'
import { ReceptionOperationsService } from './reception-operation-service'
import { createPlatformLearningService } from './platform-learning-service'
import { PlatformOrderService } from './platform-order-service'
import { createPddOrderProvider } from './pdd-order-provider'
import { createPddLearningProvider } from './pdd-learning-provider'
import { createPddOperationsProvider } from './pdd-operations-provider'
import { platformLearningOpenSourceSchema } from '../src/shared/contracts/platform-learning'
import { RuntimeResourceDisposer } from './runtime-disposal'
import { PlatformWriteCoordinator } from './platform-write-coordinator'
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
  let scheduleReporting = () => {}
  let runtimeStarted = false
  let syncScheduler = () => {}
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
      syncScheduler()
      scheduleReporting()
      if (!closed) for (const listener of listeners) listener({ type: 'managed:changed' })
    },
    submitted: (traceId) => review.trace({ type: 'submitted', traceId }),
    transport: options.managedTransport,
  })
  const dataDir = managed.dataDir
  const reporting = createReportingPipeline(dataDir)
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
    scheduleReporting()
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
    timeoutMs: 60000,
    workspaceId,
    stores: assistStores,
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'assist-platform:changed' })
    },
    read: createAssistPlatformReader({
      page: assistHost.page,
      collectionPage: assistHost.collectionPage,
      refreshQuery: assistHost.refreshQuery,
      turnPage: assistHost.turnPage,
      observeAfterSaleDetail: assistHost.observeAfterSaleDetail,
      observeTicketDetail: assistHost.observeTicketDetail,
      rememberDetail: (storeId, kind, id, url) => {
        observedAssistDetails.set(`${storeId}:${kind}:${id}`, url)
        if (observedAssistDetails.size > 1000)
          observedAssistDetails.delete(observedAssistDetails.keys().next().value!)
      },
      identityScript: () =>
        loadFactory<{
          buildIdentityScript(options: { timeoutMs: number; refresh?: boolean }): string
        }>('desk-v1/src/adapters/pdd-identity.js', 'buildIdentityScript').buildIdentityScript({
          timeoutMs: 5000,
          refresh: true,
        }),
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
      // 首次绘制事件可能晚于页面加载；显式打开日志不能无限等待隐藏窗口绘制。
      if (!win.isDestroyed()) {
        win.show()
        win.focus()
      }
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
  const platformAdapters = new Map<string, unknown>()
  const operationAdapters = new Map<string, unknown>()
  const platformWrites = new PlatformWriteCoordinator()
  const platformProducts = createPlatformProductStore({
    directory: dataDir,
    assertActive: () => assertActive(),
    assertStore: (storeId) => {
      if (!providerStore(storeId)) throw Error('店铺已移除')
    },
  })
  const backend = loadFactory<BackendFactory>(
    'electron/backend.cjs',
    'createBackend',
  ).createBackend({
    dataDir,
    // 项目自有平台 id 由这里注入，拼多多/抖店等真实平台的默认清单不受影响。
    extraPlatforms: [{ id: SIM_PLATFORM_ID, label: SIM_PLATFORM_LABEL }],
    adapterFactory: (
      store: { id: string; storeName?: string; platform: string },
      deps: unknown,
    ) => {
      const adapter =
        store.platform === SIM_PLATFORM_ID
          ? createSimAdapter(store, simHub)
          : // 必须先做文案改写再交给厂商工厂：厂商适配器表里没有 sim-local，未知平台会直接抛错。
            configureDomTextAdapter(store.platform, host.adapterFactory(store, deps))
      platformAdapters.set(store.id, adapter)
      if (store.platform === 'pdd-web') {
        const coordinated = platformWrites.bind(store.id, adapter)
        operationAdapters.set(store.id, coordinated.operations)
        return coordinated.backend
      }
      return adapter
    },
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
    prepareModelContext: createProductSpecContext(
      {
        assertActive: () => assertActive(),
        getDetail: platformProducts.get,
        listProducts: async (storeId) => {
          const rows: Product[] = []
          let revision: number | undefined, total: number | undefined
          for (let offset = 0; offset <= 10000; offset += 100) {
            assertActive()
            if (!providerStore(storeId)) throw Error('店铺已移除')
            const page = productsPageSchema.parse(
              resultSchema.parse(
                await localBackend.execute({
                  action: 'list-products',
                  storeId,
                  values: { offset, limit: 100 },
                }),
              ).data,
            )
            assertActive()
            if (
              page.total > 10000 ||
              (total !== undefined && (total !== page.total || revision !== page.revision))
            )
              throw Error('商品知识读取期间已变化')
            total = page.total
            revision = page.revision
            if (page.items.some((x) => x.storeId !== storeId || rows.some((y) => y.id === x.id)))
              throw Error('商品知识分页身份或记录不一致')
            rows.push(...page.items)
            if (rows.length === total) return rows
            if (!page.items.length || rows.length > total) throw Error('商品知识分页不完整')
          }
          throw Error('商品知识超出读取上限')
        },
      },
      createAssistedContext(traceModel),
    ),
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
      scheduleReporting()
      for (const listener of listeners) listener(safeEvent)
    },
  })
  backendRef.current = backend
  const localBackend = backend
  const productCatalog = createProductCatalog({
    directory: dataDir,
    getPlatformProduct: platformProducts.get,
    execute: (command) => localBackend.execute(command),
    assertActive: () => {
      if (closed || !managed.canAccessWorkspace()) throw Error('商品知识工作区已关闭或不可访问')
    },
    assertStore: (storeId) => {
      const snapshot = snapshotSchema.parse({
        ...(localBackend.snapshot() as Record<string, unknown>),
        workspaceId,
      })
      if (!snapshot.stores.some((store) => store.id === storeId)) throw Error('店铺不存在')
    },
  })
  let reportingQueued = false
  scheduleReporting = () => {
    if (reportingQueued || closed || !managed.canAccessWorkspace()) return
    reportingQueued = true
    queueMicrotask(() => {
      reportingQueued = false
      if (closed || !managed.canAccessWorkspace()) return
      reporting.observe(snapshotSchema.parse({ ...read(), review: review.snapshot() }))
    })
  }
  const assertActive = () => {
    if (closed || !managed.canAccessWorkspace())
      throw new Error('当前账号工作区不可用，请重新登录或刷新')
  }
  const providerStore = (id: string) => {
    assertActive()
    const raw = localBackend.snapshot() as {
      stores?: {
        id: string
        storeName: string
        platform: string
        mallId?: string
        aiEnabled: boolean
      }[]
    }
    return raw.stores?.find((store) => store.id === id)
  }
  const accountId = () =>
    managed.active.mode === 'local'
      ? 'local'
      : String(managed.snapshot().session.account?.userId ?? 'signed-out')
  const openStoreBackend = createStoreBackendOpener({
    assertActive,
    getStore: providerStore,
    open: (store) => assistHost.open(store, assistBackendUrl(store.platform)),
    close: assistHost.closeStore,
  })
  const providerOptions = {
    namespace: managed.partitionNamespace,
    getStore: providerStore,
    getAdapter: (id: string) => platformAdapters.get(id),
    accountId,
    assertActive,
    identityScript: () =>
      loadFactory<{ buildIdentityScript(input: { timeoutMs: number; refresh: boolean }): string }>(
        'desk-v1/src/adapters/pdd-identity.js',
        'buildIdentityScript',
      ).buildIdentityScript({ timeoutMs: 5000, refresh: true }),
  }
  const learningProvider = createPddLearningProvider(providerOptions)
  const productWriter = createCollectedProductWriter({
    savePlatformProduct: platformProducts.upsert,
    execute: (command) => localBackend.execute(command),
    assertActive,
    assertStore: (storeId) => {
      if (!providerStore(storeId)) throw Error('店铺已移除')
    },
    assertIdentity: async (expected) => {
      assertActive()
      const actual = await learningProvider.identity(expected.storeId)
      assertActive()
      if (
        actual.accountId !== expected.accountId ||
        actual.platformStoreId !== expected.platformStoreId ||
        actual.storeId !== expected.storeId ||
        actual.platform !== expected.platform
      )
        throw Error('采集商品保存前账号或店铺身份已变化')
    },
  })
  const learning = createPlatformLearningService({
    directory: dataDir,
    workspaceId,
    port: {
      ...learningProvider,
      async identity(storeId) {
        const store = providerStore(storeId)
        if (!store) throw Error('店铺已移除')
        if (store.platform !== 'pdd-web') throw Error('此平台的主动学习采集尚未接入')
        // 重启后保留登录分区但尚未建立适配器；采集入口复用正常打开店铺流程。
        if (!platformAdapters.has(storeId)) {
          await localBackend.execute({ action: 'open-store', storeId })
          assertActive()
          if (!providerStore(storeId)) throw Error('店铺已移除')
        }
        return learningProvider.identity(storeId)
      },
      storeProducts: productWriter.write,
      assertActive,
      async listPacks() {
        assertActive()
        const result = resultSchema.parse(
          await localBackend.execute({ action: 'list-intent-packs', values: {} }),
        )
        assertActive()
        return intentsSchema.parse(result.data).packs
      },
      async savePack(pack) {
        assertActive()
        const result = resultSchema.parse(
          await localBackend.execute({ action: 'save-intent-pack', values: pack }),
        )
        assertActive()
        const id = typeof result.data.id === 'string' ? result.data.id : ''
        if (!id) throw Error('知识包未返回有效ID')
        return { id }
      },
    },
  })
  const orderProvider = createPddOrderProvider(providerOptions)
  const orders = new PlatformOrderService({ directory: dataDir, workspaceId, port: orderProvider })
  const featureParent = options.getWindow()
  const closeFeatureWindows = () => {
    learningProvider.dispose()
    orderProvider.dispose()
  }
  featureParent?.once('closed', closeFeatureWindows)
  const storeSync = createStoreSync({
    directory: path.join(dataDir, 'store-sync-backups'),
    port: {
      snapshot: read,
      assertActive,
      execute: async (command) => {
        assertActive()
        if (command.workspaceId !== workspaceId) throw new Error('工作区已改变，请刷新')
        const { workspaceId: _workspaceId, ...raw } = command
        void _workspaceId
        const result = resultSchema.parse(await localBackend.execute(raw))
        assertActive()
        return result
      },
    },
  })
  const scheduler = createFileScheduler({
    workspaceId,
    directory: dataDir,
    validateTask: (task) => {
      assertActive()
      const snapshot = read()
      if (!snapshot.stores.some((store) => store.id === task.storeId))
        throw new Error('店铺不存在或已移除')
    },
    capability: (task) => {
      if (closed || !managed.canAccessWorkspace()) return '当前账号工作区不可用'
      const snapshot = read()
      const store = snapshot.stores.find((store) => store.id === task.storeId)
      if (!store) return '店铺不存在或已移除'
      if (store.platform !== 'pdd-web') return '当前平台原生接待操作尚未接通；任务未发送'
      return ''
    },
  })
  const automation = createFileReceptionAutomation({
    directory: dataDir,
    scheduler,
    encryption: safeStorage,
  })
  const operationsProvider = createPddOperationsProvider({
    ...providerOptions,
    workspaceId,
    getAdapter: (id: string) => operationAdapters.get(id),
    withExclusive: (storeId, operation) => platformWrites.exclusive(storeId, operation),
    transferKeywords: (storeId) => {
      const snapshot = read()
      return snapshot.handoffByStore[storeId]?.keywords ?? snapshot.config.safety.handoffKeywords
    },
  })
  const operations = new ReceptionOperationsService({
    workspaceId,
    stores: () =>
      read()
        .stores.filter((store) => store.platform === 'pdd-web')
        .map((store) => store.id),
    scheduler,
    automation,
    port: operationsProvider,
    isCurrent: () => !closed && managed.canAccessWorkspace(),
  })
  syncScheduler = () => {
    if (!runtimeStarted || closed) return
    try {
      if (managed.canAccessWorkspace()) operations.start()
      else {
        operations.pause()
        orders.pause()
      }
    } catch {
      scheduler.lastError = '调度服务未能恢复，请检查磁盘或重启后刷新核对'
    }
  }
  review.sync()
  scheduleReporting()
  const disposer = new RuntimeResourceDisposer([
    () => storeSync.dispose(),
    () => operations.dispose(),
    () => platformWrites.dispose(),
    () => featureParent?.removeListener('closed', closeFeatureWindows),
    () => learning.dispose(),
    () => learningProvider.dispose(),
    () => orders.dispose(),
    () => orderProvider.dispose(),
    () => platformAdapters.clear(),
    () => operationAdapters.clear(),
    () => scheduler.dispose(),
    () => assistCollector.dispose(),
    () => disposeBrowserEnvironment(),
    () => {
      assistDetails.clear()
      observedAssistDetails.clear()
    },
    () => assistHost.dispose(),
    () => managed.dispose(),
    () => review.dispose(),
    () => {
      if (logWindow && !logWindow.isDestroyed()) logWindow.destroy()
    },
    () => listeners.clear(),
    () => simServer.dispose(),
    () => localBackend.dispose(),
    () => host.close(),
  ])
  return {
    start: async () => {
      await managed.init()
      scheduleReporting()
      await host.start()
      runtimeStarted = true
      syncScheduler()
    },
    snapshot: () =>
      snapshotSchema.parse({
        ...read(),
        review: managed.canAccessWorkspace() ? review.snapshot() : emptyReview(),
        reporting: managed.canAccessWorkspace()
          ? reporting.snapshot(assistCollector.snapshot())
          : null,
      }),
    dataDirectory() {
      assertActive()
      return dataDir
    },
    storeSync() {
      assertActive()
      return storeSync
    },
    scheduler() {
      assertActive()
      return scheduler
    },
    platformLearning() {
      assertActive()
      return learning
    },
    async openPlatformLearningSource(input: unknown) {
      const value = platformLearningOpenSourceSchema.parse(input)
      assertActive()
      if (value.workspaceId !== workspaceId) throw Error('工作区已变化')
      await learningProvider.reveal(value.storeId, value.source)
      assertActive()
    },
    platformOrders() {
      assertActive()
      return orders
    },
    receptionOperations() {
      assertActive()
      return operations
    },
    serviceRequest(
      endpoint: string,
      input?: { method?: string; body?: unknown; signal?: AbortSignal },
    ) {
      assertActive()
      return managed.serviceRequest(endpoint, input)
    },
    async execute(input: BackendCommand): Promise<BackendResult> {
      if (closed) throw new Error('本地服务已关闭')
      if (storeSync.isBusy()) throw new Error('正在跨店同步或回滚，请等待完成后再修改工作区')
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
      if (command.action === 'open-store-backend') return openStoreBackend(command.storeId)
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
      if (command.action === 'list-products') {
        return {
          status: 'ok' as const,
          message: '',
          data: { ...(await productCatalog.list(command.storeId ?? '', command.values)) },
        }
      }
      if (command.action === 'set-product-codes') {
        return {
          status: 'ok' as const,
          message: '商家编码已保存，平台商品未修改。',
          data: { ...(await productCatalog.setCodes(command.storeId ?? '', command.values)) },
        }
      }
      const { workspaceId: _workspaceId, ...raw } = command
      void _workspaceId
      const result = resultSchema.parse(await localBackend.execute(raw))
      // 删除店铺时同步清空本机模拟数据，避免残留顾客被下一次同名店铺复用。
      if (command.action === 'remove-store' && command.storeId) {
        simHub.forget(command.storeId)
        assistHost.closeStore(command.storeId)
      }
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
          pddDetailId(request.kind, target) !== request.id ||
          (request.kind === 'aftersale' &&
            new URL(target).searchParams.get('orderSn') !== row.orderNo)
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
    setStoreZoom(input: { workspaceId: string; storeId: string; percent: number }) {
      if (closed || input.workspaceId !== workspaceId || !managed.canAccessWorkspace())
        throw Error('工作区已变化')
      if (
        !snapshotSchema
          .parse({ ...(localBackend.snapshot() as Record<string, unknown>), workspaceId })
          .stores.some((s) => s.id === input.storeId)
      )
        throw Error('店铺不存在')
      return applyStoreZoom(platformAdapters.get(input.storeId), input.percent)
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
      closed = true
      await disposer.dispose()
    },
  }
}
export type LocalRuntime = ReturnType<typeof createLocalRuntime>
