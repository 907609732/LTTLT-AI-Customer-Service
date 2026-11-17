import { z } from 'zod'

/**
 * 源码运行专属的调试桥。打包版既不注册这些通道，也不向 preload 暴露
 * `DesktopApi.developerDebug`；这里只定义窄请求，不提供 eval/exec 网关。
 */
export const developerDebugChannels = {
  capability: 'developer-debug:capability',
  expand: 'developer-debug:expand',
  gm: 'developer-debug:gm',
  ptyConnect: 'developer-debug:pty-connect',
  ptyWrite: 'developer-debug:pty-write',
  ptyResize: 'developer-debug:pty-resize',
  ptyDisconnect: 'developer-debug:pty-disconnect',
  ptyData: 'developer-debug:pty-data',
  ptyExit: 'developer-debug:pty-exit',
} as const

const workspaceIdSchema = z.string().uuid()
export const developerDebugExpandRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, expanded: z.boolean() })
  .strict()
export type DeveloperDebugExpandRequest = z.infer<typeof developerDebugExpandRequestSchema>
export interface DeveloperDebugExpandResult {
  expanded: boolean
  width: number
  height: number
}

export const developerDebugGmRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    storeId: z.string().min(1).max(64).optional(),
    input: z.string().trim().min(1).max(500),
  })
  .strict()
export type DeveloperDebugGmRequest = z.infer<typeof developerDebugGmRequestSchema>
export interface DeveloperDebugGmResult {
  ok: boolean
  text: string
}

export const developerDebugPtyConnectRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(500),
  })
  .strict()
export type DeveloperDebugPtyConnectRequest = z.infer<typeof developerDebugPtyConnectRequestSchema>
export interface DeveloperDebugPtyConnectResult {
  sessionId: string
  cwd: string
  reconnected: boolean
  buffer: string
}

export const developerDebugPtyWriteRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    sessionId: z.string().uuid(),
    data: z.string().max(64 * 1024),
  })
  .strict()
export type DeveloperDebugPtyWriteRequest = z.infer<typeof developerDebugPtyWriteRequestSchema>

export const developerDebugPtyResizeRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    sessionId: z.string().uuid(),
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(500),
  })
  .strict()
export type DeveloperDebugPtyResizeRequest = z.infer<typeof developerDebugPtyResizeRequestSchema>

export const developerDebugPtySessionRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, sessionId: z.string().uuid() })
  .strict()
export type DeveloperDebugPtySessionRequest = z.infer<typeof developerDebugPtySessionRequestSchema>

export interface DeveloperDebugPtyDataEvent {
  sessionId: string
  data: string
}
export interface DeveloperDebugPtyExitEvent {
  sessionId: string
  exitCode?: number
  signal?: number
}

/** 渲染层只看到固定方法；不接触 node-pty、任意 IPC 通道或 Electron 对象。 */
export interface DeveloperDebugBridge {
  expand(input: DeveloperDebugExpandRequest): Promise<DeveloperDebugExpandResult>
  gm(input: DeveloperDebugGmRequest): Promise<DeveloperDebugGmResult>
  ptyConnect(input: DeveloperDebugPtyConnectRequest): Promise<DeveloperDebugPtyConnectResult>
  ptyWrite(input: DeveloperDebugPtyWriteRequest): Promise<void>
  ptyResize(input: DeveloperDebugPtyResizeRequest): Promise<void>
  ptyDisconnect(input: DeveloperDebugPtySessionRequest): Promise<void>
  onPtyData(listener: (event: DeveloperDebugPtyDataEvent) => void): () => void
  onPtyExit(listener: (event: DeveloperDebugPtyExitEvent) => void): () => void
}
