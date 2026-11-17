import type { BrowserWindow, Rectangle } from 'electron'

const COMPACT = { width: 340, height: 300 }
const EXPANDED = { width: 960, height: 620 }
const MARGIN = 12
export interface ReplyMonitorSize {
  expanded: boolean
  width: number
  height: number
}

/** A child of the workbench, never a global always-on-top dialog or a send authority. */
export function createReplyMonitorWindow(options: {
  getParent(): BrowserWindow | undefined
  create(parent: BrowserWindow): BrowserWindow
  load(win: BrowserWindow): Promise<void>
}) {
  let window: BrowserWindow | undefined
  let opening: Promise<void> | undefined
  let detach = () => {}
  let disposed = false
  let expanded = false
  let expandedSize = { ...EXPANDED }
  let applying = false

  function bounds(parent: BrowserWindow): Rectangle {
    const area = parent.getContentBounds()
    const desired = expanded
      ? {
          width: Math.max(COMPACT.width, Math.min(expandedSize.width, area.width - MARGIN * 2)),
          height: Math.max(COMPACT.height, Math.min(expandedSize.height, area.height - MARGIN * 2)),
        }
      : {
          width: Math.min(COMPACT.width, area.width),
          height: Math.min(COMPACT.height, area.height),
        }
    return {
      x: area.x + Math.min(MARGIN, Math.max(0, area.width - desired.width)),
      y: area.y + Math.max(0, area.height - desired.height - MARGIN),
      width: desired.width,
      height: desired.height,
    }
  }
  function applyMode(child: BrowserWindow, parent: BrowserWindow) {
    child.setResizable(expanded)
    child.setMinimumSize(COMPACT.width, COMPACT.height)
    child.setMaximumSize(
      expanded ? Math.max(COMPACT.width, EXPANDED.width) : COMPACT.width,
      expanded ? Math.max(COMPACT.height, EXPANDED.height) : COMPACT.height,
    )
    applying = true
    child.setBounds(bounds(parent))
    queueMicrotask(() => {
      applying = false
    })
  }
  function currentSize(child?: BrowserWindow): ReplyMonitorSize {
    const parent = options.getParent()
    if (child && parent && !child.isDestroyed() && !parent.isDestroyed()) {
      const value = bounds(parent)
      return { expanded, width: value.width, height: value.height }
    }
    return {
      expanded,
      width: expanded ? EXPANDED.width : COMPACT.width,
      height: expanded ? EXPANDED.height : COMPACT.height,
    }
  }

  async function open() {
    if (disposed) return
    if (opening) return opening
    const parent = options.getParent()
    if (!parent || parent.isDestroyed()) return
    if (window && !window.isDestroyed()) {
      applyMode(window, parent)
      if (!parent.isMinimized() && parent.isVisible()) window.showInactive()
      return
    }
    const child = options.create(parent)
    window = child
    let ready = false
    applyMode(child, parent)
    const follow = () => {
      if (child.isDestroyed() || parent.isDestroyed()) return
      applyMode(child, parent)
      if (!ready || parent.isMinimized() || !parent.isVisible()) child.hide()
      else child.showInactive()
    }
    // 用户手动调整展开尺寸后，父窗移动/自动回复事件不能重置它。
    const rememberSize = () => {
      if (!expanded || applying) return
      const current = child.getBounds()
      if (
        current.width >= COMPACT.width &&
        current.height >= COMPACT.height &&
        current.width <= EXPANDED.width &&
        current.height <= EXPANDED.height
      )
        expandedSize = { width: current.width, height: current.height }
    }
    const close = () => {
      if (!child.isDestroyed()) child.destroy()
    }
    parent.on('move', follow)
    parent.on('resize', follow)
    parent.on('maximize', follow)
    parent.on('unmaximize', follow)
    parent.on('restore', follow)
    parent.on('minimize', follow)
    parent.on('show', follow)
    parent.on('hide', follow)
    parent.once('closed', close)
    child.on('resize', rememberSize)
    detach = () => {
      parent.removeListener('move', follow)
      parent.removeListener('resize', follow)
      parent.removeListener('maximize', follow)
      parent.removeListener('unmaximize', follow)
      parent.removeListener('restore', follow)
      parent.removeListener('minimize', follow)
      parent.removeListener('show', follow)
      parent.removeListener('hide', follow)
      parent.removeListener('closed', close)
      child.removeListener('resize', rememberSize)
    }
    child.once('closed', () => {
      detach()
      if (window === child) {
        window = undefined
        // 关闭即结束调试会话；下次打开回到紧凑监控，不沿用旧展开尺寸。
        expanded = false
        expandedSize = { ...EXPANDED }
      }
    })
    opening = options
      .load(child)
      .then(() => {
        if (!disposed && !child.isDestroyed() && !parent.isDestroyed()) {
          ready = true
          follow()
        }
      })
      .catch((error: unknown) => {
        close()
        throw error
      })
      .finally(() => {
        opening = undefined
      })
    return opening
  }
  return {
    open,
    setExpanded(value: boolean): ReplyMonitorSize {
      expanded = value
      const child = window
      const parent = options.getParent()
      if (child && !child.isDestroyed() && parent && !parent.isDestroyed()) {
        applyMode(child, parent)
        if (!parent.isMinimized() && parent.isVisible()) child.showInactive()
      }
      return currentSize(child)
    },
    isExpanded: () => expanded,
    window: () => window,
    dispose() {
      disposed = true
      detach()
      if (window && !window.isDestroyed()) window.destroy()
      window = undefined
    },
  }
}
