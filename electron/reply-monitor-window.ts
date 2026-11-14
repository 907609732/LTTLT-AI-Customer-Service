import type { BrowserWindow, Rectangle } from 'electron'

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

  function bounds(parent: BrowserWindow): Rectangle {
    const area = parent.getContentBounds()
    const width = Math.min(340, area.width)
    const height = Math.min(300, area.height)
    return {
      x: area.x + Math.min(12, Math.max(0, area.width - width)),
      y: area.y + Math.max(0, area.height - height - 12),
      width,
      height,
    }
  }
  async function open() {
    if (disposed) return
    if (opening) return opening
    const parent = options.getParent()
    if (!parent || parent.isDestroyed()) return
    if (window && !window.isDestroyed()) {
      window.setBounds(bounds(parent))
      if (!parent.isMinimized() && parent.isVisible()) window.showInactive()
      return
    }
    const child = options.create(parent)
    window = child
    let ready = false
    const follow = () => {
      if (child.isDestroyed() || parent.isDestroyed()) return
      child.setBounds(bounds(parent))
      if (!ready || parent.isMinimized() || !parent.isVisible()) child.hide()
      else child.showInactive()
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
    }
    child.once('closed', () => {
      detach()
      if (window === child) window = undefined
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
    dispose() {
      disposed = true
      detach()
      if (window && !window.isDestroyed()) window.destroy()
      window = undefined
    },
  }
}
