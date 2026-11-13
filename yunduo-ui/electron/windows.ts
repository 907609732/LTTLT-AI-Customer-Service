import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isExternalUrl } from './policy'

export const rendererPath = path.join(__dirname, '..', 'dist', 'index.html')
const appWebContents = new Set<number>()
export const isAppWebContents = (id: number): boolean => appWebContents.has(id)

export function getDevUrl(): string | undefined {
  const raw = process.env.VITE_DEV_SERVER_URL
  if (!raw) return undefined
  const url = new URL(raw)
  if (url.origin !== 'http://127.0.0.1:5173' || url.pathname !== '/' || url.search || url.hash)
    throw new Error('开发服务器必须使用 http://127.0.0.1:5173')
  return url.href
}

export function isTrustedRenderer(url: string, devUrl = getDevUrl()): boolean {
  try {
    const current = new URL(url)
    if (devUrl) return current.origin === new URL(devUrl).origin
    current.hash = ''
    current.search = ''
    return current.href === pathToFileURL(rendererPath).href
  } catch {
    return false
  }
}

/** 生产启动与冒烟复用同一窗口及导航策略。 */
export function createWindow(options: { smoke?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1160,
    minHeight: 720,
    frame: false,
    show: false,
    backgroundColor: '#f4f6fb',
    title: '云朵客服',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      backgroundThrottling: false,
      offscreen: options.smoke ?? false,
    },
  })
  const id = win.webContents.id
  appWebContents.add(id)
  win.webContents.once('destroyed', () => appWebContents.delete(id))
  if (!options.smoke) win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url).catch(console.error)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRenderer(url)) event.preventDefault()
  })
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  return win
}

export async function loadRenderer(win: BrowserWindow, route?: string): Promise<void> {
  const devUrl = getDevUrl()
  if (devUrl) {
    const url = new URL(devUrl)
    if (route) url.hash = route
    await win.loadURL(url.href)
  } else await win.loadFile(rendererPath, route ? { hash: route } : undefined)
}
