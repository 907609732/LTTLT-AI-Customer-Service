/** 渲染层仅持有此能力接口，不接触 Electron 对象和任意 IPC 通道。 */
import type { BackendCommand, BackendEvent, BackendResult, BackendSnapshot } from './backend'
import type { SimulatorActionResult, SimulatorStatus } from './simulation'
import type { CustomPhrasesBridge } from '../customer-service/custom-phrases'
import type { SchedulerCommand, SchedulerSnapshot } from './scheduler'
import type { ManagedBusinessRequest } from './managed-business'
import type { ManagedServiceResponse } from './managed-service-error'
import type { PlatformLearningTransport } from './platform-learning'
import type { PlatformOrderRequest, PlatformOrderSnapshot } from './platform-orders'
import type { ReceptionBridge } from './platform-operations'
import type {
  AssistOpenTarget,
  AssistMainSection,
  AssistPreferencesPatch,
  AssistWindowState,
  OpenAssistConversationInput,
} from './assist'
import type {
  OpenAssistPlatformItemInput,
  PlatformItemsSnapshot,
  RefreshAssistPlatformInput,
} from './platform-items'
import type { DeveloperDebugBridge } from './developer-debug'

export interface ScreenPoint {
  screenX: number
  screenY: number
}

export interface DesktopApi extends Partial<ReceptionBridge> {
  checkForUpdates?(manual: boolean): Promise<import('./app-update').AppUpdateResult>
  managedBusinessRequest?(input: ManagedBusinessRequest): Promise<ManagedServiceResponse>
  platformLearning?: PlatformLearningTransport
  platformOrderRequest?(input: PlatformOrderRequest): Promise<PlatformOrderSnapshot>
  openManagedCheckout?(input: { workspaceId: string; url: string }): Promise<void>
  customPhrases?: CustomPhrasesBridge
  storeSyncPreview?(envelope: unknown): Promise<unknown>
  storeSyncApply?(envelope: unknown): Promise<unknown>
  storeSyncRollback?(envelope: unknown): Promise<unknown>
  storeSyncBackups?(envelope: unknown): Promise<unknown>
  schedulerSnapshot?(workspaceId?: string): Promise<SchedulerSnapshot>
  schedulerExecute?(command: SchedulerCommand): Promise<SchedulerSnapshot>
  knowledge?: import('./knowledge-client').KnowledgeBridge
  readonly isElectron: boolean
  readonly onboardingPresentation?: boolean
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  isAlwaysOnTop?(): Promise<boolean>
  setAlwaysOnTop?(pinned: boolean): Promise<boolean>
  beginMove(point: ScreenPoint): Promise<boolean>
  move(point: ScreenPoint): void
  endMove(): void
  openExternal(url: string): Promise<void>
  /** Only copies a known built-in phrase by ID; cannot read the clipboard or send messages. */
  copyGenericPhrase?(id: string): Promise<void>
  backendSnapshot?(): Promise<BackendSnapshot>
  backendExecute?(command: BackendCommand): Promise<BackendResult>
  onBackendEvent?(listener: (event: BackendEvent) => void): () => void
  setStoreZoom?(input: import('./store-zoom').StoreZoomRequest): Promise<number>
  presentStore?(
    storeId: string,
    visible: boolean,
    layout?: 'default' | 'onboarding-login',
  ): Promise<void>
  /** 本机模拟顾客服务的状态；未启动时如实返回 running=false 与失败原因。 */
  simulatorStatus?(): Promise<SimulatorStatus>
  /** 在系统浏览器打开模拟顾客页；浏览器预览版不具备此能力。 */
  openSimulatorPage?(): Promise<SimulatorActionResult>
  openAssist?(target?: AssistOpenTarget): Promise<void>
  assistState?(): Promise<AssistWindowState>
  updateAssistPreferences?(
    patch: AssistPreferencesPatch,
    workspaceId: string,
  ): Promise<AssistWindowState>
  onAssistState?(listener: (state: AssistWindowState) => void): () => void
  onAssistNavigate?(listener: (target: AssistOpenTarget) => void): () => void
  onAssistCloseRequest?(listener: () => void): () => void
  closeAssist?(): Promise<void>
  openMainSection?(section: AssistMainSection): Promise<void>
  openAssistConversation?(input: OpenAssistConversationInput): Promise<void>
  assistPlatformSnapshot?(): Promise<PlatformItemsSnapshot>
  refreshAssistPlatform?(input: RefreshAssistPlatformInput): Promise<PlatformItemsSnapshot>
  openAssistPlatformItem?(input: OpenAssistPlatformItemInput): Promise<void>
  /** 仅源码运行的回复监控窗口存在；打包版由主进程 capability gate 完全不暴露。 */
  developerDebug?: DeveloperDebugBridge
}

export interface RenderError {
  message: string
  component: string
  info: string
  stack: string
}
