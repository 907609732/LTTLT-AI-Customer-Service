import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import type {
  DeveloperDebugPtyDataEvent,
  DeveloperDebugPtyExitEvent,
} from '../../src/shared/contracts/developer-debug'

export interface PtyExit {
  exitCode: number
  signal?: number
}
export interface PtyProcess {
  pid: number
  onData(listener: (data: string) => void): void
  onExit(listener: (event: PtyExit) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}
export interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string
      cols: number
      rows: number
      cwd: string
      env: NodeJS.ProcessEnv
      useConpty?: boolean
    },
  ): PtyProcess
}
interface TerminalOptions {
  cwd(): string
  loadPty?(): Promise<PtyModule>
  killProcessTree?(pid: number): Promise<void>
  onData(event: DeveloperDebugPtyDataEvent): void
  onExit(event: DeveloperDebugPtyExitEvent): void
}
interface ConnectInput {
  ownerId: number
  workspaceId: string
  cols: number
  rows: number
}
interface Session {
  id: string
  ownerId: number
  workspaceId: string
  pty: PtyProcess
  buffer: string
  disposed: boolean
  exited: boolean
  exit: Promise<void>
  resolveExit(): void
  cleanup?: Promise<void>
}
const BUFFER_LIMIT = 64 * 1024
const validSize = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 500 && Number.isSafeInteger(value)
const size = (cols: number, rows: number) => {
  if (!validSize(cols) || !validSize(rows)) throw new Error('终端尺寸必须是 1～500 的整数（列/行）')
  return { cols, rows }
}
const appendBounded = (buffer: string, data: string) => {
  const next = buffer + data
  return next.length > BUFFER_LIMIT ? next.slice(-BUFFER_LIMIT) : next
}

/** 终端会话只在点击连接后启动；所有输出、输入和尺寸都绑定 owner 与工作区。 */
export function createTerminalHost(options: TerminalOptions) {
  let session: Session | undefined
  let loading: Promise<DeveloperDebugPtyConnectResult> | undefined
  let loadingOwner: Pick<ConnectInput, 'ownerId' | 'workspaceId'> | undefined
  let generation = 0
  let disposed = false
  const cleanups = new Set<Promise<void>>()
  const loadDefault = async (): Promise<PtyModule> => {
    // node-pty 是 devDependency 且被 esbuild 标记 external；只有源码版点击连接时加载。
    const require = createRequire(path.join(__dirname, 'main.cjs'))
    return require('node-pty') as PtyModule
  }
  const defaultKillTree = async (pid: number) => {
    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        child.once('error', reject)
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`结束终端进程树失败（taskkill ${code}）`)),
        )
      })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      /* Process group may already be gone. */
    }
  }
  const kill = (target: Session): Promise<void> => {
    if (target.cleanup) return target.cleanup
    if (target.exited) return Promise.resolve()
    target.disposed = true
    if (session?.id === target.id) session = undefined
    const cleanup = (async () => {
      try {
        // Keep the root alive until taskkill has enumerated and ended its descendants.
        await (options.killProcessTree ?? defaultKillTree)(target.pty.pid)
      } catch (error) {
        // Best effort fallback, but never claim that tree termination succeeded.
        if (!target.exited) {
          try {
            target.pty.kill()
          } catch {
            /* Root may have exited concurrently. */
          }
        }
        throw error
      }
      // node-pty releases ConPTY during its natural exit path. Calling kill after
      // taskkill races its console-list helper against an already dead console.
      if (!target.exited) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            target.exit,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('终端进程树已终止，但等待 PTY 退出超时')),
                5000,
              )
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }
    })()
    target.cleanup = cleanup
    cleanups.add(cleanup)
    void cleanup.then(
      () => cleanups.delete(cleanup),
      () => {
        /* Retain failure for dispose/exit to observe. */
      },
    )
    return cleanup
  }
  const assertSession = (ownerId: number, workspaceId: string, sessionId: string) => {
    if (!session || session.id !== sessionId) throw new Error('终端会话不存在或已结束，请重新连接')
    if (session.ownerId !== ownerId) throw new Error('终端会话不属于当前监控窗口')
    if (session.workspaceId !== workspaceId) throw new Error('终端会话工作区已变化，请重新连接')
    return session
  }

  const connectInternal = async (input: ConnectInput, lease: number) => {
    const { cols, rows } = size(input.cols, input.rows)
    if (session) {
      if (session.ownerId === input.ownerId && session.workspaceId === input.workspaceId) {
        session.pty.resize(cols, rows)
        return {
          sessionId: session.id,
          cwd: options.cwd(),
          reconnected: true,
          buffer: session.buffer,
        }
      }
      await kill(session)
    }
    if (cleanups.size) await Promise.all([...cleanups])
    const loader = options.loadPty ?? loadDefault
    let ptyModule: PtyModule
    try {
      ptyModule = await loader()
    } catch (error) {
      throw new Error(
        `终端启动失败：${error instanceof Error ? error.message : String(error)}；未降级为单行命令模拟。`,
      )
    }
    if (disposed || lease !== generation) throw new Error('终端连接已取消')
    const cwd = options.cwd()
    let pty: PtyProcess
    try {
      pty = ptyModule.spawn(process.env.ComSpec || 'cmd.exe', [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env },
      })
    } catch (error) {
      throw new Error(
        `终端启动失败：${error instanceof Error ? error.message : String(error)}；未降级为单行命令模拟。`,
      )
    }
    let resolveExit!: () => void
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const next: Session = {
      id: randomUUID(),
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      pty,
      buffer: '',
      disposed: false,
      exited: false,
      exit,
      resolveExit,
    }
    session = next
    pty.onData((data) => {
      if (session?.id !== next.id || next.disposed) return
      next.buffer = appendBounded(next.buffer, data)
      options.onData({ sessionId: next.id, data })
    })
    pty.onExit((event) => {
      next.exited = true
      next.resolveExit()
      if (session?.id !== next.id || next.disposed) return
      next.disposed = true
      session = undefined
      options.onExit({ sessionId: next.id, exitCode: event.exitCode, signal: event.signal })
    })
    return { sessionId: next.id, cwd, reconnected: false, buffer: '' }
  }

  return {
    connect(input: ConnectInput): Promise<DeveloperDebugPtyConnectResult> {
      if (disposed) return Promise.reject(new Error('终端宿主已关闭'))
      // 同一 owner 的并发点击只能创建一个 shell。
      if (loading) {
        if (
          loadingOwner?.ownerId !== input.ownerId ||
          loadingOwner.workspaceId !== input.workspaceId
        )
          return Promise.reject(new Error('终端正在为其他窗口或工作区连接'))
        return loading
      }
      loadingOwner = { ownerId: input.ownerId, workspaceId: input.workspaceId }
      loading = connectInternal(input, generation).finally(() => {
        loading = undefined
        loadingOwner = undefined
      })
      return loading
    },
    write(input: { ownerId: number; workspaceId: string; sessionId: string; data: string }) {
      const target = assertSession(input.ownerId, input.workspaceId, input.sessionId)
      if (input.data.length > 64 * 1024) throw new Error('单次输入不能超过 64KB')
      target.pty.write(input.data)
    },
    resize(input: {
      ownerId: number
      workspaceId: string
      sessionId: string
      cols: number
      rows: number
    }) {
      const { cols, rows } = size(input.cols, input.rows)
      const target = assertSession(input.ownerId, input.workspaceId, input.sessionId)
      target.pty.resize(cols, rows)
    },
    async disconnect(input: { ownerId: number; workspaceId: string; sessionId: string }) {
      const target = assertSession(input.ownerId, input.workspaceId, input.sessionId)
      await kill(target)
    },
    status() {
      return session
        ? { connected: true, cwd: options.cwd(), sessionId: session.id }
        : { connected: false, cwd: options.cwd(), sessionId: '' }
    },
    dispose() {
      disposed = true
      generation++
      if (session) void kill(session)
      return Promise.all([...cleanups]).then(() => {})
    },
  }
}
export type TerminalHost = ReturnType<typeof createTerminalHost>
export type DeveloperDebugPtyConnectResult = {
  sessionId: string
  cwd: string
  reconnected: boolean
  buffer: string
}
