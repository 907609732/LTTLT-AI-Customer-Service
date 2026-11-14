import type { App, Session, WebContents } from 'electron'
import path from 'node:path'

/** Keep the real OS/Chromium version; remove only desktop application product tokens. */
export function storeBrowserUserAgent(original: string, chromiumVersion: string): string {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(chromiumVersion)) throw new Error('无法识别当前浏览器内核版本')
  const browser = original.match(
    /^(Mozilla\/5\.0 \([^)]+\) AppleWebKit\/[\d.]+ \(KHTML, like Gecko\)).*? Chrome\/[\d.]+.*? Safari\/([\d.]+)/,
  )
  if (!browser) throw new Error('无法识别当前浏览器环境')
  return `${browser[1]} Chrome/${chromiumVersion} Safari/${browser[2]}`
}

/** Apply one policy before first navigation to this verified workspace's store pages only. */
export function registerStoreBrowserEnvironment(options: {
  app: Pick<App, 'on' | 'removeListener'>
  namespace: string
  chromiumVersion: string
  userDataDir: string
}) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(options.namespace)) throw new Error('店铺浏览器工作区无效')
  const normalized = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const root = normalized(path.join(options.userDataDir, 'Partitions'))
  const prefix = `lingtu-${options.namespace.toLowerCase()}-`
  const sessions = new WeakSet<Session>()
  const created = (_event: Electron.Event, contents: WebContents) => {
    const storage = contents.session.getStoragePath()
    if (!storage || normalized(path.dirname(storage)) !== root) return
    const partition = path.basename(storage).toLowerCase()
    if (
      !partition.startsWith(prefix) ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(partition.slice(prefix.length))
    )
      return
    const userAgent = storeBrowserUserAgent(contents.getUserAgent(), options.chromiumVersion)
    if (!sessions.has(contents.session)) {
      contents.session.setUserAgent(userAgent, 'zh-CN,zh,en-US,en')
      sessions.add(contents.session)
    }
    // Session defaults alone do not update an already created WebContents (Electron API).
    contents.setUserAgent(userAgent)
  }
  options.app.on('web-contents-created', created)
  return () => options.app.removeListener('web-contents-created', created)
}
