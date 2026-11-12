/** 渲染层仅持有此能力接口，不接触 Electron 对象和任意 IPC 通道。 */
import type { BackendCommand, BackendEvent, BackendResult, BackendSnapshot } from './backend'

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
  backendSnapshot?(): Promise<BackendSnapshot>
  backendExecute?(command: BackendCommand): Promise<BackendResult>
  onBackendEvent?(listener: (event: BackendEvent) => void): () => void
  presentStore?(storeId: string, visible: boolean): Promise<void>
}

export interface RenderError {
  message: string
  component: string
  info: string
  stack: string
}
