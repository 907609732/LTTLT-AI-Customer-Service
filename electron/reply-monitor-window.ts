import type { BrowserWindow, Rectangle } from 'electron'

const COMPACT = { width: 340, height: 300 }
const EXPANDED = { width: 960, height: 620 }
const MARGIN = 12
export interface ReplyMonitorSize {
  expanded: boolean
  width: number
  height: number
}

function sameRect(a: Rectangle, b: Rectangle) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
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
  /** 用户在普通模式拖出的高度。父窗夹取和程序 setBounds 都不得改写它。 */
  let compactHeight = COMPACT.height

  function compactMetrics(area: Rectangle) {
    const maxHeight = Math.max(1, area.height - MARGIN * 2)
    return {
      width: Math.min(COMPACT.width, area.width),
      maxHeight,
      height: Math.min(Math.max(COMPACT.height, compactHeight), maxHeight),
    }
  }
  function bounds(parent: BrowserWindow): Rectangle {
    const area = parent.getContentBounds()
    if (!expanded) {
      const { width, height } = compactMetrics(area)
      return {
        x: area.x + Math.min(MARGIN, Math.max(0, area.width - width)),
        y: area.y + Math.max(0, area.height - height - MARGIN),
        width,
        height,
      }
    }
    const desired = {
      width: Math.max(COMPACT.width, Math.min(expandedSize.width, area.width - MARGIN * 2)),
      height: Math.max(COMPACT.height, Math.min(expandedSize.height, area.height - MARGIN * 2)),
    }
    return {
      x: area.x + Math.min(MARGIN, Math.max(0, area.width - desired.width)),
      y: area.y + Math.max(0, area.height - desired.height - MARGIN),
      width: desired.width,
      height: desired.height,
    }
  }
  function applyMode(child: BrowserWindow, parent: BrowserWindow) {
    // 两种模式都保留系统原生边缘缩放；普通模式只放开高度，宽度恒为 340。
    child.setResizable(true)
    if (expanded) {
      child.setMinimumSize(COMPACT.width, COMPACT.height)
      child.setMaximumSize(
        Math.max(COMPACT.width, EXPANDED.width),
        Math.max(COMPACT.height, EXPANDED.height),
      )
    } else {
      const maxHeight = compactMetrics(parent.getContentBounds()).maxHeight
      const minimumHeight = Math.min(COMPACT.height, maxHeight)
      child.setMinimumSize(COMPACT.width, minimumHeight)
      child.setMaximumSize(COMPACT.width, Math.max(minimumHeight, maxHeight))
    }
    child.setBounds(bounds(parent))
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
      height: expanded ? EXPANDED.height : compactHeight,
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
    const rememberResize = (_event: unknown, proposed: Rectangle) => {
      if (child.isDestroyed() || parent.isDestroyed()) return
      if (expanded) {
        if (
          proposed.width >= COMPACT.width &&
          proposed.height >= COMPACT.height &&
          proposed.width <= EXPANDED.width &&
          proposed.height <= EXPANDED.height
        )
          expandedSize = { width: proposed.width, height: proposed.height }
        return
      }
      const maxHeight = compactMetrics(parent.getContentBounds()).maxHeight
      const height = Math.min(Math.max(COMPACT.height, proposed.height), maxHeight)
      // A lateral resize or a drag at the current limit must not discard the saved height.
      if (height !== child.getBounds().height) compactHeight = height
    }
    const anchorCompact = () => {
      if (expanded || child.isDestroyed() || parent.isDestroyed()) return
      const next = bounds(parent)
      if (!sameRect(child.getBounds(), next)) child.setBounds(next)
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
    // Electron emits will-resize for native drags, never for setBounds.
    child.on('will-resize', rememberResize)
    child.on('resized', anchorCompact)
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
      child.removeListener('will-resize', rememberResize)
      child.removeListener('resized', anchorCompact)
    }
    child.once('closed', () => {
      detach()
      if (window === child) {
        window = undefined
        // 关闭即结束调试会话；下次打开回到紧凑监控，但仍保留本次运行拖出的高度。
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
