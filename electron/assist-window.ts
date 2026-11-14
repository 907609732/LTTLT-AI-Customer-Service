import type { BrowserWindow, Rectangle } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  assistPreferencesPatchSchema,
  assistPreferencesSchema,
  defaultAssistPreferences,
  type AssistWindowState,
} from '../src/shared/contracts/assist'

export interface AssistWorkspace {
  id: string
  /** Stable verified identity supplied only by the main process, never renderer input. */
  identity: string
}
export function dockAssistBounds(parent: Rectangle, area: Rectangle, height: number): Rectangle {
  const width = 300
  const size = Math.max(1, Math.min(Math.round(height), area.height))
  const right = parent.x + parent.width
  const preferred = right + width <= area.x + area.width ? right : parent.x - width
  return {
    x: Math.max(area.x, Math.min(preferred, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(parent.y, area.y + area.height - size)),
    width,
    height: size,
  }
}

/** Owns only the auxiliary window and preferences; never opens/stops a store or changes AI. */
export function createAssistWindowManager(options: {
  rootDir: string
  getPrimary(): BrowserWindow | undefined
  getWorkspace(): AssistWorkspace
  create(): BrowserWindow
  load(win: BrowserWindow): Promise<void>
  workArea(parent: BrowserWindow): Rectangle
  changed?(state: AssistWindowState): void
  opened?(): void
  closed?(): void
}) {
  let win: BrowserWindow | undefined
  let opening: Promise<void> | undefined
  let primary: BrowserWindow | undefined
  let applyingBounds = false
  let workspace = options.getWorkspace()
  let preferences = defaultAssistPreferences()
  let loaded = false
  let disposed = false
  const listeners = new Set<() => void>()
  const file = () =>
    path.join(
      options.rootDir,
      'assist-preferences',
      createHash('sha256').update(workspace.identity).digest('hex') + '.json',
    )
  function readPreferences() {
    preferences = defaultAssistPreferences()
    const target = file()
    if (!fs.existsSync(target)) return
    if (fs.statSync(target).size > 8192) throw new Error('辅助中心偏好配置过大，请检查本机文件')
    preferences = assistPreferencesSchema.parse(JSON.parse(fs.readFileSync(target, 'utf8')))
  }
  function persist() {
    const target = file()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temporary = target + '.' + randomUUID() + '.tmp'
    try {
      fs.writeFileSync(temporary, JSON.stringify(preferences), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, target)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }
  const state = (caller?: BrowserWindow): AssistWindowState => ({
    ...preferences,
    alertKinds: [...preferences.alertKinds],
    workspaceId: workspace.id,
    open: Boolean(win && !win.isDestroyed()),
    isAssistWindow: Boolean(caller && caller === win),
  })
  function broadcast() {
    if (win && !win.isDestroyed()) win.webContents.send('assist:state-changed', state(win))
    options.changed?.(state())
  }
  function detachPrimary() {
    for (const off of listeners) off()
    listeners.clear()
    primary = undefined
  }
  function position() {
    if (!win || win.isDestroyed() || !preferences.docked || !primary || primary.isDestroyed())
      return
    const bounds = dockAssistBounds(
      primary.getBounds(),
      options.workArea(primary),
      win.getBounds().height,
    )
    applyingBounds = true
    try {
      win.setBounds(bounds)
    } finally {
      applyingBounds = false
    }
  }
  function destroy() {
    const previous = win
    win = undefined
    opening = undefined
    detachPrimary()
    if (previous && !previous.isDestroyed()) previous.destroy()
    if (previous) {
      options.closed?.()
      broadcast()
    }
  }
  function syncWorkspace() {
    const next = options.getWorkspace()
    if (next.id === workspace.id && next.identity === workspace.identity) {
      if (!loaded) {
        readPreferences()
        loaded = true
      }
      return
    }
    workspace = next
    loaded = false
    readPreferences()
    loaded = true
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(preferences.pinned)
    position()
    broadcast()
  }
  function requireOwn(caller: BrowserWindow) {
    syncWorkspace()
    if (!win || win.isDestroyed() || caller !== win) throw new Error('此操作仅供辅助中心窗口使用')
  }
  return {
    state(caller?: BrowserWindow) {
      syncWorkspace()
      return state(caller)
    },
    get window() {
      return win
    },
    syncWorkspace,
    async open() {
      if (disposed) throw new Error('辅助中心服务已关闭')
      syncWorkspace()
      if (opening) return opening
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        position()
        return
      }
      primary = options.getPrimary()
      if (!primary || primary.isDestroyed()) throw new Error('主工作台尚未就绪')
      const parent = primary
      const next = options.create()
      win = next
      next.setAlwaysOnTop(preferences.pinned)
      next.on('close', (event) => {
        event.preventDefault()
        if (!next.webContents.isDestroyed()) next.webContents.send('assist:request-close')
      })
      next.once('closed', () => {
        if (win !== next) return
        win = undefined
        opening = undefined
        detachPrimary()
        options.closed?.()
        broadcast()
      })
      next.on('will-move', () => {
        if (applyingBounds || !preferences.docked) return
        preferences.docked = false
        persist()
        broadcast()
      })
      next.on('resize', position)
      const close = () => destroy()
      parent.on('move', position)
      parent.on('resize', position)
      parent.once('closed', close)
      listeners.add(() => parent.removeListener('move', position))
      listeners.add(() => parent.removeListener('resize', position))
      listeners.add(() => parent.removeListener('closed', close))
      const area = options.workArea(parent)
      next.setBounds(dockAssistBounds(parent.getBounds(), area, Math.min(900, area.height)))
      const request: Promise<void> = options
        .load(next)
        .then(() => {
          if (disposed || win !== next || next.isDestroyed()) return
          position()
          next.show()
          next.focus()
          broadcast()
          options.opened?.()
        })
        .catch((error) => {
          if (win === next) destroy()
          throw error
        })
        .finally(() => {
          if (opening === request) opening = undefined
        })
      opening = request
      return request
    },
    update(caller: BrowserWindow, input: unknown) {
      requireOwn(caller)
      const patch = assistPreferencesPatchSchema.parse(input)
      const previous = preferences
      preferences = assistPreferencesSchema.parse({ ...preferences, ...patch })
      try {
        persist()
      } catch (error) {
        preferences = previous
        throw error
      }
      caller.setAlwaysOnTop(preferences.pinned)
      position()
      broadcast()
      return state(caller)
    },
    detachForDrag(caller: BrowserWindow) {
      if (caller === win && preferences.docked) this.update(caller, { docked: false })
    },
    close(caller: BrowserWindow) {
      requireOwn(caller)
      destroy()
    },
    dispose() {
      disposed = true
      destroy()
    },
  }
}
export type AssistWindowManager = ReturnType<typeof createAssistWindowManager>
