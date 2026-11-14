import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { App, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerStoreBrowserEnvironment } from '../electron/store-browser'

describe('店铺浏览器环境统一', () => {
  it('同店聊天页和后台页使用实际内核版本、同一持久会话，不伪造版本或复制登录数据', () => {
    const app = new EventEmitter()
    const profileRoot = path.resolve('isolated-browser-profile')
    const session = {
      setUserAgent: vi.fn(),
      getStoragePath: () => path.join(profileRoot, 'Partitions', 'lingtu-yunduo-local-store-a'),
    }
    const page = () => ({
      session,
      getUserAgent: () =>
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) lingtu-ai/1.0.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36',
      setUserAgent: vi.fn(),
    })
    const stop = registerStoreBrowserEnvironment({
      app: app as unknown as App,
      namespace: 'yunduo-local',
      chromiumVersion: '150.0.7871.250',
      userDataDir: profileRoot,
    })
    const chat = page(),
      backend = page()
    app.emit('web-contents-created', {}, chat as unknown as WebContents)
    app.emit('web-contents-created', {}, backend as unknown as WebContents)
    const ua = chat.setUserAgent.mock.calls[0]?.[0] as string
    expect(ua).toContain('Chrome/150.0.7871.250')
    expect(ua).not.toContain('Electron/')
    expect(ua).not.toContain('lingtu-ai/')
    expect(backend.setUserAgent).toHaveBeenCalledWith(ua)
    expect(session.setUserAgent).toHaveBeenCalledWith(ua, 'zh-CN,zh,en-US,en')
    stop()
    expect(app.listenerCount('web-contents-created')).toBe(0)
  })
  it('不更改主界面、其他账号分区或不合法店铺分区', () => {
    const app = new EventEmitter()
    const stop = registerStoreBrowserEnvironment({
      app: app as unknown as App,
      namespace: 'managed-a',
      chromiumVersion: '150.0.7871.250',
      userDataDir: path.resolve('isolated-browser-profile'),
    })
    const profileRoot = path.resolve('isolated-browser-profile')
    for (const storagePath of [
      null,
      profileRoot,
      path.join(profileRoot, 'Partitions', 'lingtu-managed-b-store-a'),
      path.join(profileRoot, 'Partitions', 'yunduo-shop'),
      path.resolve('other-browser-profile', 'Partitions', 'lingtu-managed-a-store-a'),
    ]) {
      const page = { session: { getStoragePath: () => storagePath }, setUserAgent: vi.fn() }
      app.emit('web-contents-created', {}, page as unknown as WebContents)
      expect(page.setUserAgent).not.toHaveBeenCalled()
    }
    stop()
  })
})
