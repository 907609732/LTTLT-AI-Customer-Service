import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isAppWebContents, isTrustedRenderer } from '../windows'
import {
  developerDebugChannels,
  developerDebugExpandRequestSchema,
  developerDebugGmRequestSchema,
  developerDebugPtyConnectRequestSchema,
  developerDebugPtyResizeRequestSchema,
  developerDebugPtySessionRequestSchema,
  developerDebugPtyWriteRequestSchema,
} from '../../src/shared/contracts/developer-debug'
import type { DeveloperDebugController } from './controller'

interface RuntimeWithDebug {
  developerDebug?(): DeveloperDebugController | undefined
}
let activeDispose: (() => void) | undefined
export function registerDeveloperDebugIpc(options: {
  enabled: boolean
  runtime(): RuntimeWithDebug | undefined
}): () => void {
  activeDispose?.()
  // app.isPackaged 为权威 gate：打包版不注册 capability 或任何开发通道。
  if (!options.enabled) return () => {}
  const names: string[] = []
  const controller = (): DeveloperDebugController => {
    const value = options.runtime()?.developerDebug?.()
    if (!value) throw new Error('源码调试控制器未启用')
    return value
  }
  const authorize = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isAppWebContents(event.sender.id) ||
      !isTrustedRenderer(event.senderFrame.url)
    )
      throw new Error('不允许的调试接口调用来源')
    let hash = ''
    try {
      hash = new URL(event.senderFrame.url).hash.split('?')[0] || ''
    } catch {
      throw new Error('不允许的调试接口调用来源')
    }
    if (hash !== '#/reply-monitor') throw new Error('调试接口只允许回复监控窗口')
    const value = controller()
    if (value.ownerId() !== event.sender.id) throw new Error('调试接口只允许当前回复监控窗口')
    return value
  }
  type Handler = (
    event: IpcMainInvokeEvent,
    input: unknown,
    value: DeveloperDebugController,
  ) => unknown
  const register = (name: string, handle: Handler) => {
    names.push(name)
    ipcMain.handle(name, async (event, input: unknown) => {
      const value = authorize(event)
      return handle(event, input, value)
    })
  }
  const capability = (event: IpcMainEvent) => {
    try {
      event.returnValue = Boolean(authorize(event))
    } catch {
      event.returnValue = false
    }
  }
  ipcMain.on(developerDebugChannels.capability, capability)
  register(developerDebugChannels.expand, (event, input, value) => {
    const request = developerDebugExpandRequestSchema.parse(input)
    return value.expand(event.sender.id, request)
  })
  register(developerDebugChannels.gm, (event, input, value) => {
    const request = developerDebugGmRequestSchema.parse(input)
    return value.gm(event.sender.id, request)
  })
  register(developerDebugChannels.ptyConnect, (event, input, value) => {
    const request = developerDebugPtyConnectRequestSchema.parse(input)
    return value.ptyConnect(event.sender.id, request)
  })
  register(developerDebugChannels.ptyWrite, (event, input, value) => {
    const request = developerDebugPtyWriteRequestSchema.parse(input)
    value.ptyWrite(event.sender.id, request)
  })
  register(developerDebugChannels.ptyResize, (event, input, value) => {
    const request = developerDebugPtyResizeRequestSchema.parse(input)
    value.ptyResize(event.sender.id, request)
  })
  register(developerDebugChannels.ptyDisconnect, (event, input, value) => {
    const request = developerDebugPtySessionRequestSchema.parse(input)
    return value.ptyDisconnect(event.sender.id, request)
  })
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    ipcMain.removeListener(developerDebugChannels.capability, capability)
    for (const name of names) ipcMain.removeHandler(name)
    if (activeDispose === dispose) activeDispose = undefined
  }
  activeDispose = dispose
  return dispose
}
