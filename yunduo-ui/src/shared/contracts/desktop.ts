/** 渲染层仅持有此能力接口，不接触 Electron 对象和任意 IPC 通道。 */
import type { BackendCommand, BackendEvent, BackendResult, BackendSnapshot } from './backend'
import type { SimulatorActionResult, SimulatorStatus } from './simulation'

export interface ScreenPoint {
  screenX: number
  screenY: number
}

export interface DesktopApi {
  readonly isElectron: boolean
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  beginMove(point: ScreenPoint): Promise<boolean>
  move(point: ScreenPoint): void
  endMove(): void
  openExternal(url: string): Promise<void>
  /** Only copies a known built-in phrase by ID; cannot read the clipboard or send messages. */
  copyGenericPhrase?(id: string): Promise<void>
  backendSnapshot?(): Promise<BackendSnapshot>
  backendExecute?(command: BackendCommand): Promise<BackendResult>
  onBackendEvent?(listener: (event: BackendEvent) => void): () => void
  presentStore?(storeId: string, visible: boolean): Promise<void>
  /** 本机模拟顾客服务的状态；未启动时如实返回 running=false 与失败原因。 */
  simulatorStatus?(): Promise<SimulatorStatus>
  /** 在系统浏览器打开模拟顾客页；浏览器预览版不具备此能力。 */
  openSimulatorPage?(): Promise<SimulatorActionResult>
}

export interface RenderError {
  message: string
  component: string
  info: string
  stack: string
}
