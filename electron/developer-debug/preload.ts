import {
  developerDebugChannels,
  type DeveloperDebugBridge,
  type DeveloperDebugExpandRequest,
  type DeveloperDebugExpandResult,
  type DeveloperDebugGmRequest,
  type DeveloperDebugGmResult,
  type DeveloperDebugPtyConnectRequest,
  type DeveloperDebugPtyConnectResult,
  type DeveloperDebugPtyDataEvent,
  type DeveloperDebugPtyExitEvent,
  type DeveloperDebugPtyResizeRequest,
  type DeveloperDebugPtySessionRequest,
  type DeveloperDebugPtyWriteRequest,
} from '../../src/shared/contracts/developer-debug'

interface BridgeOptions {
  requested: boolean
  probe(): boolean
  invoke(channel: string, input: unknown): Promise<unknown>
  on(channel: string, listener: (value: unknown) => void): () => void
}

/** preload 只在主进程授权本窗口后才挂载固定方法；打包版没有 capability 通道。 */
export function createDeveloperDebugBridge(
  options: BridgeOptions,
): DeveloperDebugBridge | undefined {
  if (!options.requested) return undefined
  let available = false
  try {
    available = options.probe() === true
  } catch {
    // 打包版不注册 capability handler；即使命令行被追加参数也不能开启。
    available = false
  }
  if (!available) return undefined
  const call = <T>(channel: string, input: unknown) => options.invoke(channel, input) as Promise<T>
  return Object.freeze({
    expand: (input: DeveloperDebugExpandRequest) =>
      call<DeveloperDebugExpandResult>(developerDebugChannels.expand, input),
    gm: (input: DeveloperDebugGmRequest) =>
      call<DeveloperDebugGmResult>(developerDebugChannels.gm, input),
    ptyConnect: (input: DeveloperDebugPtyConnectRequest) =>
      call<DeveloperDebugPtyConnectResult>(developerDebugChannels.ptyConnect, input),
    ptyWrite: async (input: DeveloperDebugPtyWriteRequest) => {
      await options.invoke(developerDebugChannels.ptyWrite, input)
    },
    ptyResize: async (input: DeveloperDebugPtyResizeRequest) => {
      await options.invoke(developerDebugChannels.ptyResize, input)
    },
    ptyDisconnect: async (input: DeveloperDebugPtySessionRequest) => {
      await options.invoke(developerDebugChannels.ptyDisconnect, input)
    },
    onPtyData: (listener: (event: DeveloperDebugPtyDataEvent) => void) =>
      options.on(developerDebugChannels.ptyData, (value) =>
        listener(value as DeveloperDebugPtyDataEvent),
      ),
    onPtyExit: (listener: (event: DeveloperDebugPtyExitEvent) => void) =>
      options.on(developerDebugChannels.ptyExit, (value) =>
        listener(value as DeveloperDebugPtyExitEvent),
      ),
  })
}
