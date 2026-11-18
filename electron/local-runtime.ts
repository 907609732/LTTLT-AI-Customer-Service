import { createKnowledgePlatformProducts } from './knowledge-platform-products'
import { selectProductSpecContext } from './product-spec-context'
import { createKnowledgeCompatibilityPorts } from './knowledge-compatibility'
import { createKnowledgeRepository } from './knowledge'
import { createKnowledgeRuntime, type KnowledgeModelPort } from './knowledge-runtime'
import { createProductCatalog } from './product-catalog'
import { applyStoreZoom } from './store-zoom'
import { createStoreBackendOpener } from './store-backend'
import { createReplyMonitorWindow } from './reply-monitor-window'
import {
  createDeveloperDebugController,
  type DeveloperDebugController,
} from './developer-debug/controller'
import { AiStateRestore, type AiRestoreStore } from './ai-state-restore'
import { StoreAiPreferences } from './store-ai-preferences'
import { StoreSendModes } from './store-send-modes'
import { SendModeAuthorizations } from './send-mode-authorizations'
import { createRequire } from 'node:module'
import { ReplyPacingStore, createUidIntervalResolver } from './reply-pacing'
import { createWelcomeDelayGate } from './welcome-delay'
import { normalizeWelcomeSetting } from '../src/shared/contracts/welcome'
import { describeReplyPacing } from '../src/shared/reply-pacing'
import { MANUAL_REPLY_KEYWORDS_SCREEN, normalizeManualReplyKeywords } from './manual-reply-keywords'
import {
  ReceptionKeywordSettingsStore,
  normalizeReceptionKeywords,
  parseReceptionKeywordSaveInput,
  resolveReceptionKeywordSafety,
} from './reception-keyword-settings'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  app,
  BrowserWindow,
  safeStorage,
  shell,
  dialog,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
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
  RECEPTION_KEYWORDS_SCREEN,
  type BackendCommand,
  type BackendEvent,
  type BackendResult,
} from '../src/shared/contracts/backend'
import {
  isTrustedRenderer,
  isAppWebContents,
  createWindow,
  loadRenderer,
  appIconPath,
} from './windows'
import { localVisionCapability } from './model-capabilities'
import { listCustomModels } from './list-custom-models'
import { ReviewConsole, type SendProposal } from './review-console'
import { configureDomTextAdapter } from './dom-text-adapter'
import { createAssistedContext } from './generic-phrases'
import { createManagedContextBridge } from './managed-context'
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
import {
  createXianyuPlatformAdapter,
  XIANYU_PLATFORM_ID,
  XIANYU_PLATFORM_NAME,
  type XianyuAdapter,
} from './xianyu'
import { createSimServer } from './sim-server'
import { registerStoreBrowserEnvironment } from './store-browser'
import { createReportingPipeline } from './reporting-pipeline'
import { createStoreSync } from './store-sync-service'
import { createFileScheduler } from './scheduler-storage'
import { createFileReceptionAutomation } from './reception-automation-storage'
import { ReceptionOperationsService } from './reception-operation-service'
import { PlatformOrderService } from './platform-order-service'
import { createPddOrderProvider } from './pdd-order-provider'
import { createPddLearningProvider } from './pdd-learning-provider'
import { createPddOperationsProvider } from './pdd-operations-provider'
import { platformLearningOpenSourceSchema } from '../src/shared/contracts/platform-learning'
import { RuntimeResourceDisposer } from './runtime-disposal'
import { PlatformWriteCoordinator } from './platform-write-coordinator'
import {
  type OpenAssistPlatformItemInput,
  type RefreshAssistPlatformInput,
} from '../src/shared/contracts/platform-items'
import { createAssistRuntime } from './runtime/assist-runtime'
import {
  createKnowledgePipelineAssembly,
  type KnowledgeImageRecognizer,
} from './runtime/knowledge-pipeline-assembly'
import { createKnowledgeLearningAssembly } from './runtime/knowledge-learning-assembly'
import { createSizeRulesService } from './size-rules/service'
import { createSizeRulesAssembly } from './size-rules/runtime-assembly'
import { createVisionModelAssembly } from './vision-model-assembly'
import { createSizeContextPreparation } from './size-rules/inject'
import { installSizeReplyGuard } from './size-rules/guard'
import { createSizeCandidateGuard } from './size-rules/candidate-guard'
import { applySizeTrainingOutput } from './size-rules/training-output'
import {
  capturedSizeCanonicalReply,
  capturedSizeEvidence,
  withSizeRequest,
} from './size-rules/request-state'
import { sizeRuleActions, type SizeRuleAction } from '../src/shared/contracts/size-rules'
import {
  defaultVisionModelSnapshot,
  visionModelCommands,
  type VisionModelCommand,
} from '../src/shared/contracts/vision'

interface UpstreamBackend {
  engine?: {
    worker(storeId: string): WorkerObservation | null
    aiClient?: { reply(input: unknown): Promise<unknown> }
  }
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
/** 厂商店铺窗口管理器的只读用法：闲鱼适配器需要拿同一店铺的 WebContents。 */
interface VendorShopManager {
  webContentsOf?(storeId: string): WebContents | null
  stateOf?(storeId: string): Record<string, unknown> | undefined
  open?(storeId: string): Promise<unknown> | unknown
  close?(storeId: string): void
  closeAll?(): void
  restartClient?(storeId: string): Promise<unknown> | unknown
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
  /** Native acceptance can supply a recognizer without requiring OS language packs. */
  recognizeKnowledgeImage?: KnowledgeImageRecognizer
}) {
  const workspaceId = randomUUID()
  const listeners = new Set<(event: BackendEvent) => void>()
  let closed = false
  let scheduleReporting = () => {}
  let runtimeStarted = false
  const aiRestoreRef: { current?: AiStateRestore } = {}
  let syncScheduler = () => {}
  let suspendKnowledge = () => {}
  // 上游工厂可能在装配期间产生回调，引用就绪前不读取其快照。
  const backendRef: { current?: UpstreamBackend } = {}
  // 尺码服务需要真实商品目录，而目录又依赖后端；请求到达时再读取当前组合根实例。
  const sizeRulesRef: { current?: ReturnType<typeof createSizeRulesService> } = {}
  let sizeRulesUnavailable = ''
  const visionAssemblyRef: { current?: ReturnType<typeof createVisionModelAssembly> } = {}
  // 免费摘要绑定只属于当前托管身份；身份变化时由 changed 回调清空。
  const managedContextRef: { current?: ReturnType<typeof createManagedContextBridge> } = {}
  let managedContextIdentity = ''
  // 工厂可能在装配期间就回调 onChange，此时控制器尚未赋值，先返回空标识。
  let managedIdentity: () => string = () => ''
  const managed = createManagedController({
    rootDir: options.dataDir,
    factory: loadFactory<ManagedSessionFactory>(
      'electron/managed-session.cjs',
      'createManagedSession',
    ),
    safeStorage,
    openExternal: (url) => shell.openExternal(url),
    stopAi: () => {
      aiRestoreRef.current?.suspend()
      backendRef.current?.stopAi()
    },
    changed: () => {
      const identity = managedIdentity()
      if (identity !== managedContextIdentity) {
        managedContextIdentity = identity
        managedContextRef.current?.clear()
      }
      aiRestoreRef.current?.accessChanged()
      if (runtimeStarted) void aiRestoreRef.current?.start()
      suspendKnowledge()
      syncScheduler()
      scheduleReporting()
      if (!closed) for (const listener of listeners) listener({ type: 'managed:changed' })
    },
    submitted: (traceId) => review.trace({ type: 'submitted', traceId }),
    transport: options.managedTransport,
  })
  managedIdentity = () => {
    const snapshot = managed.snapshot()
    return `${snapshot.active.mode}\n${snapshot.active.apiOrigin}\n${
      snapshot.session.status === 'signed_in' ? String(snapshot.session.account?.userId ?? '') : ''
    }`
  }
  managedContextIdentity = managedIdentity()
  const managedContext = createManagedContextBridge((payload, traceId, signal) =>
    managed.summarize(payload, traceId, signal),
  )
  managedContextRef.current = managedContext
  const dataDir = managed.dataDir
  const { Config } = loadFactory<{
    Config: new (options: { file: string }) => {
      all(): { reply: { perUidMinIntervalMs: number } }
    }
  }>('desk-v1/src/main/config.js', 'Config')
  const pacingConfig = new Config({ file: path.join(dataDir, 'config.json') })
  // 旧版固定间隔（含 60 秒）不再改写：原值留在 config.json 供审计/回退，
  // 新的随机节奏单独保存在 reply-pacing.json，首次缺失时迁移为 1～3 秒随机。
  const replyPacing = new ReplyPacingStore(dataDir, pacingConfig.all().reply.perUidMinIntervalMs)
  // 开关与关键词原文分开保存：关闭匹配不触碰 ConfigStore 中的关键词数组。
  const keywordSettings = new ReceptionKeywordSettingsStore(dataDir)
  const knowledgeRepository = createKnowledgeRepository({ directory: dataDir, workspaceId })
  const knowledge = createKnowledgeRuntime({
    repository: knowledgeRepository,
    workspaceId,
    assertActive: () => {
      if (closed || !managed.canAccessWorkspace() || managed.snapshot().restartRequired)
        throw Error('当前账号知识库不可用，请切换工作区后重试')
    },
    stores: () => read().stores,
    chooseRestore: async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择知识库备份目录（含manifest.json）',
        properties: ['openDirectory'],
      })
      return selection.canceled ? undefined : selection.filePaths[0]
    },
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'knowledge:changed' })
    },
    // Only a signed-in managed session returns a projection; local mode, logout
    // and config failures resolve null so the reviewed legacy path stays intact.
    managedContextPolicy: () =>
      managed.active.mode === 'managed' ? managed.contextPolicy() : Promise.resolve(null),
    sizeContext: {
      resolve: (storeId, productId, question, thread) =>
        sizeRulesRef.current?.resolve(storeId, productId, question, thread) ??
        Promise.resolve(null),
      unavailable: () =>
        sizeRulesUnavailable
          ? `尺码规则不可用：${sizeRulesUnavailable}；未使用未经核对的尺码表，请恢复备份后重试。`
          : '',
    },
    resolveSku: (storeId, productId, question) => {
      const detail = platformProducts.get(storeId, productId)
      if (!detail) return ''
      const context = selectProductSpecContext({
        storeId,
        productId,
        question,
        products: [
          {
            id: productId,
            storeId,
            productId,
            title: detail.title,
            description: '',
            specifications: '',
            price: '',
            enabled: true,
            version: 1,
            updatedAt: 0,
          },
        ],
        details: [detail],
      })
      return context.status === 'selected'
        ? context.products[0]?.skus[0]?.skuId || '__unresolved__'
        : '__unresolved__'
    },
  })
  suspendKnowledge = () => {
    if (!managed.canAccessWorkspace() || managed.snapshot().restartRequired)
      knowledge.cancelCompletions()
  }
  const sendModes = new StoreSendModes(dataDir)
  const sendAuthorizations = new SendModeAuthorizations((id) => sendModes.read(id))
  let developerDebug: DeveloperDebugController | undefined
  const replyMonitor = createReplyMonitorWindow({
    getParent: options.getWindow,
    create: (parent) => {
      const win = createWindow({
        compact: true,
        parent,
        // The preload only asks for the bridge in this window; the IPC owner lease is the authority.
        developerDebug: !app.isPackaged,
      })
      developerDebug?.attach(win)
      return win
    },
    load: (win) => loadRenderer(win, '/reply-monitor'),
  })
  const reporting = createReportingPipeline(dataDir)
  const disposeBrowserEnvironment = registerStoreBrowserEnvironment({
    app,
    namespace: managed.partitionNamespace,
    chromiumVersion: process.versions.chrome,
    userDataDir: app.getPath('userData'),
  })
  let logWindow: BrowserWindow | undefined
  const notifyReview = () => {
    scheduleReporting()
    if (!closed) for (const listener of listeners) listener({ type: 'review:changed' })
  }
  const read = () => {
    const masked = emptySnapshot()
    masked.capabilities.modelMode = managed.active.mode
    // 本机与托管账号共用同一工作区；仅在本地后端尚未装配时使用空快照。
    const source = (backendRef.current ? backendRef.current.snapshot() : masked) as {
      config?: { reply?: Record<string, unknown> } & Record<string, unknown>
    } & Record<string, unknown>
    const snapshot = snapshotSchema.parse({
      ...source,
      // 随机回复节奏属于本工程配置，由主进程叠加到厂商快照上。
      config: {
        ...(source.config ?? masked.config),
        reply: {
          ...(source.config?.reply ?? masked.config.reply),
          pacing: replyPacing.snapshot(),
        },
        safety: {
          ...(source.config?.safety ?? masked.config.safety),
          handoffKeywordsEnabled: keywordSettings.snapshot().handoffEnabled,
          manualReplyKeywordsEnabled: keywordSettings.snapshot().manualReplyEnabled,
        },
      },
      workspaceId,
      managed: managed.snapshot(),
    })
    return {
      ...snapshot,
      capabilities: {
        ...snapshot.capabilities,
        visionModel: visionAssemblyRef.current?.snapshot() ?? defaultVisionModelSnapshot(),
      },
      stores: snapshot.stores.map((store) => ({
        ...store,
        sendMode: sendModes.read(store.id).mode,
        aiRestore: aiRestoreRef.current?.state(store.id),
      })),
    }
  }
  const assistStores = () => {
    if (closed) return []
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
  const assist = createAssistRuntime({
    workspaceId,
    namespace: managed.partitionNamespace,
    getParent: options.getWindow,
    stores: assistStores,
    isActive: () => !closed && managed.canAccessWorkspace(),
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'assist-platform:changed' })
    },
    createWindow: (partition) =>
      new BrowserWindow({
        width: 1200,
        height: 850,
        icon: appIconPath,
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
    identityScript: () =>
      loadFactory<{
        buildIdentityScript(options: { timeoutMs: number; refresh?: boolean }): string
      }>('desk-v1/src/adapters/pdd-identity.js', 'buildIdentityScript').buildIdentityScript({
        timeoutMs: 5000,
        refresh: true,
      }),
  })
  const review = new ReviewConsole(
    read,
    notifyReview,
    (id) => backendRef.current?.engine?.worker(id) ?? undefined,
    {
      readMode: (id) => sendModes.read(id),
      // 只按同店精确编号读取现有商品知识/平台详情，作为监控摘要的可靠来源。
      resolveProduct: (storeId, productId) => {
        let detail: ReturnType<typeof platformProducts.get> = null
        try {
          detail = platformProducts.get(storeId, productId)
        } catch {
          // 商品详情未采集或编号越界不影响回复监控的其余状态。
        }
        const binding = knowledgeRepository
          .listBindings()
          .find((row) => row.storeId === storeId && row.productId === productId)
        const canonical = binding
          ? knowledgeRepository.getCanonical(binding.canonicalId)
          : undefined
        return {
          title: detail?.title || binding?.title || canonical?.title || '',
          imageUrl: detail?.images[0],
        }
      },
    },
  )
  // 关闭本地服务时让欢迎延迟在下一档（≤100ms）结束，不能继续等待或发送。
  const welcomeDelayAbort = new AbortController()
  // Share one full snapshot only within a synchronous guard check, never across timer ticks.
  let welcomeCheckSnapshot: ReturnType<typeof read> | undefined
  const readWelcomeCheck = () => welcomeCheckSnapshot ?? read()
  const sizeCandidates = createSizeCandidateGuard({
    currentReason: (evidence) =>
      sizeRulesRef.current?.candidateCurrent(evidence) ??
      '尺码规则服务不可用，旧候选已失效；请重新生成。',
  })
  const welcomeDelayGate = createWelcomeDelayGate({
    beginRead: () => {
      welcomeCheckSnapshot = read()
    },
    readWelcome: (storeId) => {
      const setting = readWelcomeCheck().welcomeByStore[storeId]
      return setting ? normalizeWelcomeSetting(setting) : undefined
    },
    readStore: (storeId) => {
      const store = readWelcomeCheck().stores.find((row) => row.id === storeId)
      return store
        ? { online: store.runtime.online === true, aiEnabled: store.aiEnabled }
        : undefined
    },
    conversation: (storeId, uid) => {
      const messages =
        readWelcomeCheck().conversations.find((row) => row.storeId === storeId && row.uid === uid)
          ?.messages ?? []
      return {
        // 与复核窗口相同的正文口径；只比较这位买家的归档消息，不混用其他会话。
        fingerprint: JSON.stringify(
          messages.map((message) => ({
            from: message.from,
            type: message.type,
            content: message.content.replace(/\r\n?/g, '\n').normalize('NFC'),
          })),
        ),
        lastFrom: messages.at(-1)?.from ?? '',
      }
    },
    cancel: (proposal, reason) => review.cancelSending(proposal.storeId, proposal.uid, reason),
    releaseSendAuthorization: (storeId, uid) => sendAuthorizations.release(storeId, uid),
    signal: welcomeDelayAbort.signal,
  })
  const traceWithKnowledge = (event: unknown) => {
    const id = review.trace(event)
    if (id && event && typeof event === 'object') {
      const type = Reflect.get(event, 'type')
      if (type === 'request') {
        knowledge.captureTrace(id, Reflect.get(event, 'knowledge'))
        const context = Reflect.get(event, 'reviewContext')
        if (context && typeof context === 'object' && Reflect.get(context, 'purpose') === 'reply')
          sizeCandidates.capture(id, Reflect.get(event, 'messages'))
      }
      const reply = Reflect.get(event, 'reply')
      if (type === 'result' && typeof reply === 'string') sizeCandidates.captureReply(id, reply)
    }
    return id
  }
  const traceModel = (event: unknown) => {
    if (managed.active.mode === 'managed' && event && typeof event === 'object')
      return traceWithKnowledge({
        ...event,
        model: managed.snapshot().session.account?.capabilities?.model || '托管模型（待授权）',
      })
    return traceWithKnowledge(event)
  }
  const visionAssembly = createVisionModelAssembly({
    dataDir,
    safeStorage,
    assertActive: () => {
      if (closed || !managed.canAccessWorkspace() || managed.snapshot().restartRequired)
        throw Error('当前账号图片模型不可用，请切换工作区后重试')
    },
    modelSource: () => managed.active.mode,
  })
  visionAssemblyRef.current = visionAssembly
  // 压缩/改写器只构造一次，摘要与通用话术注入都经同一条 trace 记录。
  const assistedContext = createAssistedContext(traceModel)
  const sizeContext = createSizeContextPreparation(
    {
      assertActive: () => {
        if (closed) throw Error('本地服务已关闭，请重启软件')
      },
      unavailable: () =>
        sizeRulesUnavailable
          ? `尺码规则不可用：${sizeRulesUnavailable}；未使用未经核对的尺码表，请恢复备份后重试。`
          : '',
      resolve: (storeId, productId, question, thread) =>
        sizeRulesRef.current?.resolve(storeId, productId, question, thread) ??
        Promise.resolve(null),
    },
    assistedContext,
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
  const xianyuAdapters = new Map<string, XianyuAdapter>()
  let vendorManager: VendorShopManager | undefined
  const createVendorManager = host.managerFactory as (
    deps: Record<string, unknown>,
  ) => VendorShopManager
  const operationAdapters = new Map<string, unknown>()
  const platformWrites = new PlatformWriteCoordinator()
  if (!app.isPackaged) {
    developerDebug = createDeveloperDebugController({
      workspaceId,
      appVersion: app.getVersion(),
      monitor: replyMonitor,
      isWorkspaceActive: () => !closed && managed.canAccessWorkspace(),
      stores: () =>
        read().stores.map((store) => ({
          id: store.id,
          storeName: store.storeName,
          platform: store.platform,
          open: store.runtime.open,
          online: store.runtime.online,
          authenticated: store.runtime.authenticated ?? null,
          aiEnabled: store.aiEnabled,
          sendMode: store.sendMode ?? 'review',
        })),
      logs: () => review.snapshot().logs,
      getStoreWebContents: (storeId) => vendorManager?.webContentsOf?.(storeId) ?? null,
      openExternal: (url) => shell.openExternal(url),
      // Bundled main lives in dist-electron; the debug CMD starts at the source project root.
      ptyCwd: () => path.resolve(__dirname, '..'),
    })
  }
  const platformProducts = createKnowledgePlatformProducts({
    repository: knowledgeRepository,
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
    extraPlatforms: [
      { id: SIM_PLATFORM_ID, label: SIM_PLATFORM_LABEL },
      { id: XIANYU_PLATFORM_ID, label: XIANYU_PLATFORM_NAME },
    ],
    adapterFactory: (
      store: { id: string; storeName?: string; platform: string },
      deps: unknown,
    ) => {
      let adapter: unknown
      if (store.platform === SIM_PLATFORM_ID) {
        adapter = createSimAdapter(store, simHub)
      } else if (store.platform === XIANYU_PLATFORM_ID) {
        // 闲鱼页面由厂商 ShopWindowManager 按 desk-v1 的 entryUrl 建好；
        // 适配器只拿同一店铺的 WebContents 注入桥，不另开窗口。
        const xianyu = createXianyuPlatformAdapter({
          store,
          getWebContents: () => vendorManager?.webContentsOf?.(store.id) ?? null,
          logger: (deps as { logger?: unknown } | undefined)?.logger,
          // 商家在内嵌页扫码后，重跑一次厂商健康检查，把在线/登录状态写回快照。
          onAuthenticated: () => {
            const manager = vendorManager
            if (!manager?.open) return
            Promise.resolve(manager.open(store.id)).catch(() => undefined)
          },
        })
        xianyuAdapters.set(store.id, xianyu)
        adapter = xianyu
      } else {
        // 必须先做文案改写再交给厂商工厂：厂商适配器表里没有 sim-local，未知平台会直接抛错。
        adapter = configureDomTextAdapter(
          store.platform,
          host.adapterFactory(store, deps),
          undefined,
          (uid, text) => sendAuthorizations.consume(store.id, uid, text),
        )
      }
      platformAdapters.set(store.id, adapter)
      if (store.platform === 'pdd-web') {
        const coordinated = platformWrites.bind(store.id, adapter)
        operationAdapters.set(store.id, coordinated.operations)
        return coordinated.backend
      }
      return adapter
    },
    managerFactory: createSimManagerFactory(
      (deps) => {
        vendorManager = createVendorManager(deps)
        return vendorManager
      },
      simHub,
      {
        // 闲鱼适配器的 readiness 结果是登录态的唯一来源；未检查过时保持 null。
        authenticatedFor: (storeId) => xianyuAdapters.get(storeId)?.authenticated() ?? null,
        // 打开店铺后从 cookie 读登录名回填店名；页面聊天区昵称可能被打码。
        identityFor: async (storeId) => (await xianyuAdapters.get(storeId)?.identity()) ?? null,
      },
    ),
    safeStorage,
    // 每次等待按买家当前模式抽取一次间隔；厂商侧缓存同一次等待的值。
    resolveUidIntervalMs: createUidIntervalResolver(() => replyPacing.snapshot()),
    modelMode: managed.active.mode,
    managedChat: (
      payload: { client_request_id: string; messages: unknown },
      requestOptions: { signal?: AbortSignal; traceId?: string },
    ) => managed.chat(payload, requestOptions),
    // 在后端记录诊断前确定请求号，使摘要父ID、HTTP正文与失败提示保持一致。
    resolveManagedRequestId: (messages: unknown, requestId: string) =>
      managedContext.bind({ client_request_id: requestId, messages }).client_request_id,
    managedReady: () => managed.ready(),
    managedCapabilities: () => managed.capabilities(),
    localVisionSupport: localVisionCapability,
    knowledgePorts: createKnowledgeCompatibilityPorts(knowledgeRepository),
    knowledgeContext: knowledge.context,
    onKnowledgeModel: (port: KnowledgeModelPort) => {
      const basePort: KnowledgeModelPort = {
        complete: port.complete,
        // Keep bulk learning below the managed service's standard five-per-minute ceiling.
        minimumIntervalMs: () => (managed.active.mode === 'managed' ? 13000 : 0),
        identity: () =>
          JSON.stringify(
            managed.active.mode === 'managed'
              ? [
                  'managed',
                  managed.active.apiOrigin,
                  managed.snapshot().session.account?.capabilities?.model ?? 'unavailable',
                ]
              : ['local', read().config.ai.baseUrl, read().config.ai.model],
          ),
        vision: () =>
          managed.active.mode === 'managed'
            ? {
                supported: managed.snapshot().session.account?.capabilities?.vision === true,
                maxImages: Math.max(
                  0,
                  Math.min(4, managed.snapshot().session.account?.capabilities?.maxImages ?? 0),
                ),
                reason: '当前托管账号未提供图片学习能力',
              }
            : port.vision(),
      }
      knowledge.setModel(visionAssembly.wrap(basePort))
    },
    // 每次引擎读取配置时叠加开关；自定义本店关键词仍由厂商 handoff 记录优先。
    resolveKeywordSafety: (
      safety: { handoffKeywords: string[]; manualReplyKeywords: string[] },
      customKeywords: string[] | undefined,
    ) => resolveReceptionKeywordSafety(safety, customKeywords, keywordSettings.snapshot()),
    prepareModelContext: (input: Parameters<typeof assistedContext>[0]) => {
      // 托管模式把摘要交给服务端免费内部接口；本机 Key 模式仍走当前模型完成器。
      return managed.active.mode === 'managed'
        ? managedContext.prepare(sizeContext, input)
        : sizeContext(input)
    },
    resolveConversationThread: createConversationThread(() => read().conversations),
    beforeSend: (proposal: SendProposal) => {
      knowledge.guardProposal(proposal)
      sizeCandidates.attach(proposal)
      const sizeTextReason = sizeCandidates.finalTextReason(proposal, read().bannedWords)
      if (sizeTextReason) {
        review.rejectFinalText(proposal.storeId, proposal.uid, sizeTextReason)
        return false
      }
      // 统一确认门放行后才进入欢迎延迟；普通回复没有 welcome 元数据，立即返回。
      const decide = async () => {
        const approved = await review.propose(proposal)
        return approved ? welcomeDelayGate(proposal, true) : false
      }
      const decision =
        read().stores.find((store) => store.id === proposal.storeId)?.platform === 'pdd-web'
          ? sendAuthorizations.authorize(proposal, decide)
          : decide()
      // 新候选只显示不抢焦点的小监控窗，批准及自动模式均由统一发送门复核。
      void replyMonitor.open().catch(() => notifyReview())
      return decision
    },
    onModelTrace: traceModel,
    onRuntimeEvent: (event: unknown) => {
      review.event(event)
      void aiRestoreRef.current?.event(event)
      if (event && typeof event === 'object') {
        const type = Reflect.get(event, 'type')
        if (type === 'reply:review-result') {
          const storeId = Reflect.get(event, 'storeId'),
            uid = Reflect.get(event, 'uid')
          if (typeof storeId === 'string' && typeof uid === 'string')
            sendAuthorizations.release(storeId, uid)
        }
        if (type === 'reply:error') void replyMonitor.open().catch(() => notifyReview())
      }
    },
    allowExternalClient: true,
    onEvent(event: unknown) {
      if (closed || !event || typeof event !== 'object') return
      const type = Reflect.get(event, 'type')
      if (typeof type !== 'string') return
      if (type.startsWith('shop:')) developerDebug?.syncAllPopupPolicies()
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
  // 主进程串行化关键词读改写，避免两个失焦保存交错时用同一旧 expected 覆盖。
  let keywordSaveQueue: Promise<unknown> = Promise.resolve()
  function serialKeywordSave<T>(job: () => Promise<T>): Promise<T> {
    const next = keywordSaveQueue.then(job, job)
    keywordSaveQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  function notifyKeywordSettingsChanged() {
    if (!closed) for (const listener of listeners) listener({ type: 'backend:changed' })
  }
  async function saveReceptionKeywordCommand(
    rawValues: Record<string, unknown>,
  ): Promise<BackendResult> {
    const input = parseReceptionKeywordSaveInput(rawValues)
    return serialKeywordSave(async () => {
      if (closed) throw new Error('本地服务已关闭')
      if (input.mode === 'enabled') {
        const saved = keywordSettings.saveEnabled(input.kind, input.enabled, input.expectedEnabled)
        if (saved.changed) notifyKeywordSettingsChanged()
        return {
          status: 'ok' as const,
          message: '保存成功',
          data: {
            kind: input.kind,
            enabled:
              input.kind === 'handoff'
                ? saved.settings.handoffEnabled
                : saved.settings.manualReplyEnabled,
            changed: saved.changed,
          },
        }
      }
      const keywords = normalizeReceptionKeywords(input.keywords, input.kind)
      // CAS compares the exact loaded record, including legacy spaces/duplicates.
      // Normalize only the replacement; otherwise valid older lists can never be edited.
      const expected = input.expectedKeywords
      const source = localBackend.snapshot() as {
        config?: { safety?: { handoffKeywords?: string[]; manualReplyKeywords?: string[] } }
      }
      const current =
        input.kind === 'handoff'
          ? (source.config?.safety?.handoffKeywords ?? [])
          : (source.config?.safety?.manualReplyKeywords ?? [])
      if (
        current.length !== expected.length ||
        current.some((word, index) => word !== expected[index])
      )
        throw new Error(
          `${input.kind === 'handoff' ? '全局人工关键词' : '客服接管关键词'}已更新，请载入已保存关键词后再修改`,
        )
      const unchanged =
        current.length === keywords.length &&
        current.every((word, index) => word === keywords[index])
      if (!unchanged) {
        if (input.kind === 'handoff')
          await localBackend.execute({
            action: 'save-config',
            screenId: 'UX08',
            values: { handoffKeywords: keywords },
          })
        else
          await localBackend.execute({
            action: 'save-config',
            screenId: MANUAL_REPLY_KEYWORDS_SCREEN,
            values: { keywords, expectedKeywords: expected },
          })
      }
      return {
        status: 'ok' as const,
        message: '保存成功',
        data: { kind: input.kind, keywords, changed: !unchanged },
      }
    })
  }
  const aiRestore = new AiStateRestore({
    preferences: new StoreAiPreferences(dataDir),
    stores: () => {
      const raw = localBackend.snapshot() as { stores?: AiRestoreStore[] }
      return raw.stores ?? []
    },
    allowed: () =>
      !closed &&
      managed.canAccessWorkspace() &&
      !managed.snapshot().restartRequired &&
      (managed.active.mode === 'local' || managed.snapshot().session.status === 'signed_in'),
    verifyIdentity: async (id) => {
      const adapter = platformAdapters.get(id)
      if (!adapter || typeof adapter !== 'object') return undefined
      const reader: unknown = Reflect.get(adapter, 'readIdentity')
      if (typeof reader !== 'function') return undefined
      const fresh: unknown = await Reflect.apply(reader, adapter, [{ refresh: true }])
      if (
        !fresh ||
        typeof fresh !== 'object' ||
        Reflect.get(fresh, 'authenticated') !== true ||
        Reflect.get(fresh, 'identityError')
      )
        return undefined
      const mallId: unknown = Reflect.get(fresh, 'mallId'),
        customerServiceId: unknown = Reflect.get(fresh, 'customerServiceId')
      const store = (localBackend.snapshot() as { stores?: AiRestoreStore[] }).stores?.find(
        (row) => row.id === id,
      )
      if (
        !store ||
        typeof mallId !== 'string' ||
        !mallId.trim() ||
        typeof customerServiceId !== 'string' ||
        !customerServiceId.trim()
      )
        return undefined
      return { platform: store.platform, mallId, customerServiceId }
    },
    modelBlocked: () => Boolean((localBackend.snapshot() as { modelIssue?: unknown }).modelIssue),
    execute: (command) => localBackend.execute(command),
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'backend:changed' })
    },
  })
  aiRestoreRef.current = aiRestore
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
  const sizeRulesAssembly = createSizeRulesAssembly(() =>
    createSizeRulesService({
      directory: dataDir,
      assertActive: () => {
        if (closed || !managed.canAccessWorkspace()) throw Error('尺码规则工作区已关闭或不可访问')
      },
      // Uses the current real product directory; tests inject a synthetic port instead.
      checkBinding: async (binding) => {
        try {
          for (let offset = 0; offset <= 10000; offset += 200) {
            const page = await productCatalog.list(binding.storeId, {
              offset,
              limit: 200,
              query: binding.productId,
            })
            if (page.items.some((row) => row.productId === binding.productId)) return 'valid'
            if (!page.items.length || offset + 200 >= page.total) return 'missing'
          }
          return 'missing'
        } catch {
          return 'error'
        }
      },
    }),
  )
  sizeRulesRef.current = sizeRulesAssembly.service
  sizeRulesUnavailable = sizeRulesAssembly.error
  const sizeReplyClient = backend.engine?.aiClient
  if (sizeReplyClient)
    installSizeReplyGuard(sizeReplyClient, {
      resolve: (storeId, productId, question, thread) =>
        sizeRulesAssembly.resolve(storeId, productId, question, thread),
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
    if (closed) throw new Error('本地服务已关闭，请重启软件')
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
  // 平台事实归属于店铺本身；软件账号不再参与来源键，避免登录前后同一店铺被拆成两套数据。
  const accountId = () => 'local'
  const openStoreBackend = createStoreBackendOpener({
    assertActive,
    getStore: providerStore,
    open: (store) => assist.openBackend(store),
    close: assist.closeStore,
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
  const { daily: knowledgeDaily } = createKnowledgePipelineAssembly({
    workspaceId,
    repository: knowledgeRepository,
    knowledge,
    provider: learningProvider,
    assertActive,
    getStore: providerStore,
    conversations: () => read().conversations,
    dailyAvailable: () => runtimeStarted && !closed && managed.canAccessWorkspace(),
    dailyStores: () =>
      read()
        .stores.filter(
          (store) =>
            store.platform === 'pdd-web' &&
            store.runtime.authenticated === true &&
            store.runtime.open,
        )
        .map((store) => store.id),
    changed: () => {
      if (!closed) for (const listener of listeners) listener({ type: 'knowledge:changed' })
    },
    recognizeImage: options.recognizeKnowledgeImage,
  })
  const { learning } = createKnowledgeLearningAssembly({
    directory: dataDir,
    workspaceId,
    repository: knowledgeRepository,
    platformProducts,
    provider: learningProvider,
    backend: { execute: (command) => localBackend.execute(command) },
    getStore: providerStore,
    hasAdapter: (storeId) => platformAdapters.has(storeId),
    assertActive,
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
        if (['save-product', 'remove-product', 'import-products'].includes(command.action))
          throw Error('商品跨店同步请在知识库明确关联目标商品；旧复制及回滚不再改写共享知识')
        const { workspaceId: _workspaceId, ...raw } = command
        void _workspaceId
        const result = resultSchema.parse(await localBackend.execute(raw))
        assertActive()
        return result
      },
    },
  })
  const scheduler = createFileScheduler({
    timedTasksEnabled: false,
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
      return resolveReceptionKeywordSafety(
        snapshot.config.safety,
        snapshot.handoffByStore[storeId]?.keywords,
        keywordSettings.snapshot(),
      ).handoffKeywords
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
    () => managedContext.clear(),
    () => knowledgeDaily.dispose(),
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
    () => assist.disposeCollection(),
    () => disposeBrowserEnvironment(),
    () => assist.clearDetails(),
    () => assist.disposeHost(),
    () => managed.dispose(),
    () => review.dispose(),
    () => developerDebug?.dispose(),
    () => sendAuthorizations.dispose(),
    () => replyMonitor.dispose(),
    () => {
      if (logWindow && !logWindow.isDestroyed()) logWindow.destroy()
    },
    () => listeners.clear(),
    () => simServer.dispose(),
    () => knowledge.dispose(),
    () => localBackend.dispose(),
    () => knowledgeRepository.dispose(),
    () => host.close(),
  ])
  return {
    start: async (startOptions: { restoreAi?: boolean } = {}) => {
      await managed.init()
      if (closed) return
      scheduleReporting()
      await host.start()
      if (closed) return
      runtimeStarted = true
      // 不阻塞主窗口加载；每个记住的店铺独立打开，只在平台确认登录后恢复。
      void aiRestoreRef.current?.start(startOptions)
      knowledgeDaily.start()
      syncScheduler()
    },
    snapshot: () =>
      snapshotSchema.parse({
        ...read(),
        review: managed.canAccessWorkspace() ? review.snapshot() : emptyReview(),
        reporting: managed.canAccessWorkspace()
          ? reporting.snapshot(assist.collectorSnapshot())
          : null,
      }),
    dataDirectory() {
      assertActive()
      return dataDir
    },
    knowledge() {
      assertActive()
      return knowledge
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
    developerDebug() {
      return closed ? undefined : developerDebug
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
      if (command.action === 'save-config' && command.screenId === MANUAL_REPLY_KEYWORDS_SCREEN) {
        // 只采纳这两个字段，其他 safety 配置由 ConfigStore 的深合并保留。
        command.values = {
          keywords: normalizeManualReplyKeywords(command.values.keywords),
          expectedKeywords: normalizeManualReplyKeywords(command.values.expectedKeywords),
        }
      }
      if (command.workspaceId !== workspaceId) throw new Error('本地服务已重启，请刷新后重试')
      if (command.action === 'save-config' && command.screenId === RECEPTION_KEYWORDS_SCREEN)
        return saveReceptionKeywordCommand(command.values)
      if (command.action === 'save-config' && command.screenId === 'REPLY_PACING') {
        // 只写本机随机节奏文件：不碰店铺、账号、Key、AI 开关、发送审批或旧固定间隔。
        const saved = replyPacing.save({
          mode: command.values.mode,
          customMinSeconds: command.values.customMinSeconds,
          customMaxSeconds: command.values.customMaxSeconds,
          expected: command.values.expected,
        })
        notifyReview()
        return {
          status: 'ok' as const,
          message: `回复间隔已保存：${describeReplyPacing(saved)}（同一买家）；这是排队节奏，模型生成和审核耗时另计。`,
          data: { pacing: saved },
        }
      }
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
      const startsAi =
        ['resume-ai', 'resume-conversation', 'start-training'].includes(command.action) ||
        (command.action === 'set-ai' && command.values.enabled !== false) ||
        (command.action === 'batch' && command.values.operation !== 'disable') ||
        (command.action === 'review-reply' && command.values.approve === true)
      if (managed.snapshot().restartRequired && startsAi)
        throw new Error('模型来源或账号已改变，请重启软件；旧候选不能继续发送')
      if (startsAi && managed.snapshot().active.mode === 'managed') {
        const session = managed.snapshot().session
        if (!session.account || !['signed_in', 'offline'].includes(session.status))
          throw new Error('请先登录托管账号再使用 AI；本机店铺数据仍可查看和编辑')
      }
      if (command.action === 'clear-runtime-logs') {
        const cleared = review.clearLogs()
        return {
          status: 'ok',
          message: `已清除 ${cleared.logs} 条日志、${cleared.traces} 条调试记录及 ${cleared.replies} 条历史确认；待确认、发送中和运行中的请求已保留。`,
          data: cleared,
        }
      }
      if (command.action === 'open-runtime-logs') {
        await openLogs()
        return { status: 'ok' as const, message: '日志窗口已打开', data: {} }
      }
      if (command.action === 'open-reply-monitor') {
        await replyMonitor.open()
        return { status: 'ok', message: '回复监控已打开', data: {} }
      }
      if (command.action === 'set-store-send-mode') {
        const storeId = command.values.storeId
        const mode = command.values.mode
        if (typeof storeId !== 'string' || !read().stores.some((store) => store.id === storeId))
          throw new Error('店铺不存在，请刷新后重试')
        if (mode !== 'review' && mode !== 'auto') throw new Error('无效的发送模式')
        sendModes.set(storeId, mode)
        notifyReview()
        return {
          status: 'ok',
          message:
            mode === 'auto'
              ? '该店铺新回复将自动复核并发送；已有待审核回复仍需确认'
              : '该店铺已切换为审核发送',
          data: {},
        }
      }
      if (command.action === 'open-store-backend') return openStoreBackend(command.storeId)
      if (command.action === 'list-custom-models') {
        const models = await listCustomModels(command.values)
        return { status: 'ok', message: '模型列表已获取', data: { models } }
      }
      if (command.action === 'review-reply') {
        await review.decide(command.values)
        return { status: 'ok' as const, message: '确认操作已处理；以平台发送结果为准。', data: {} }
      }
      if (sizeRuleActions.includes(command.action as SizeRuleAction)) {
        const sizeAction = command.action as SizeRuleAction
        const result = await sizeRulesAssembly.execute(sizeAction, command.values)
        return { status: 'ok' as const, message: result.message, data: result.data }
      }
      if (visionModelCommands.includes(command.action as VisionModelCommand)) {
        const action = command.action as VisionModelCommand
        const data = await visionAssembly.execute(action, command.values)
        return { status: 'ok' as const, message: '', data }
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
      let result: BackendResult
      if (command.action === 'start-training') {
        let evidence: ReturnType<typeof capturedSizeEvidence>
        result = resultSchema.parse(
          await withSizeRequest(async () => {
            const value = await aiRestore.userExecute(raw)
            evidence = capturedSizeEvidence()
            return value
          }),
        )
        if (evidence) {
          const reason =
            sizeRulesRef.current?.candidateCurrent(evidence) ||
            (sizeRulesRef.current ? '' : '尺码规则服务不可用，旧结论已失效。')
          result = {
            ...result,
            data: applySizeTrainingOutput(evidence, result.data, reason, {
              canonical: capturedSizeCanonicalReply(),
              bannedWords: read().bannedWords,
            }),
          }
        }
      } else result = resultSchema.parse(await aiRestore.userExecute(raw))
      if (command.action === 'open-store' && command.storeId)
        developerDebug?.syncPopupPolicy(command.storeId)
      // 删除店铺时同步清空本机模拟数据，避免残留顾客被下一次同名店铺复用。
      if (command.action === 'remove-store' && command.storeId) {
        knowledge.removeStore(command.storeId)
        simHub.forget(command.storeId)
        assist.closeStore(command.storeId)
      }
      return result
    },
    assistPlatformSnapshot() {
      return assist.snapshot()
    },
    setAssistPlatformActive(active: boolean) {
      assist.setActive(active)
    },
    refreshAssistPlatform(input: RefreshAssistPlatformInput) {
      return assist.refresh(input)
    },
    openAssistPlatformItem(input: OpenAssistPlatformItemInput) {
      return assist.openItem(input)
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
      welcomeDelayAbort.abort()
      aiRestoreRef.current?.dispose()
      await disposer.dispose()
    },
  }
}
export type LocalRuntime = ReturnType<typeof createLocalRuntime>
