import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createStoreBackendOpener } from '../electron/store-backend'
import { assistBackendUrl, createAssistPlatformHost } from '../electron/assist-platform-host'
import { commandSchema } from '../src/shared/contracts/backend'

function fixture(platform = 'pdd-web') {
  let active = true
  let store: { id: string; platform: string } | undefined = { id: 'shop-a', platform }
  const open = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn()
  const run = createStoreBackendOpener({
    assertActive: () => {
      if (!active) throw Error('工作区已改变')
    },
    getStore: (id) => (id === store?.id ? store : undefined),
    open,
    close,
  })
  return { run, open, close, revoke: () => (active = false), remove: () => (store = undefined) }
}

describe('店铺后台固定入口', () => {
  it('共用业务命令校验，平台首页只能由主进程映射', () => {
    expect(
      commandSchema.parse({
        workspaceId: '00000000-0000-4000-8000-000000000000',
        action: 'open-store-backend',
        storeId: 'shop-a',
      }).action,
    ).toBe('open-store-backend')
    expect(assistBackendUrl('pdd-web')).toBe('https://mms.pinduoduo.com/')
    expect(assistBackendUrl('doudian-client')).toBe('https://fxg.jinritemai.com/')
  })
  it('只打开指定店铺后台，不宣称登录完成', async () => {
    const f = fixture()
    const result = await f.run('shop-a')
    expect(f.open).toHaveBeenCalledTimes(1)
    expect(f.open).toHaveBeenCalledWith({ id: 'shop-a', platform: 'pdd-web' })
    expect(result.message).toContain('核对店铺身份')
  })
  it('抖店明确使用独立后台登录', async () => {
    expect((await fixture('doudian-client').run('shop-a')).message).toContain('独立登录')
  })
  it('拒绝空店铺、其他店铺、模拟店及未接通平台', async () => {
    for (const id of ['', undefined, 'other-shop']) {
      const f = fixture()
      await expect(f.run(id)).rejects.toThrow('店铺')
      expect(f.open).not.toHaveBeenCalled()
    }
    for (const platform of ['sim-local', 'unknown']) {
      const f = fixture(platform)
      await expect(f.run('shop-a')).rejects.toThrow('尚未接入')
      expect(f.open).not.toHaveBeenCalled()
    }
  })
  it('当前工作区失效时不打开页面', async () => {
    const f = fixture()
    f.revoke()
    await expect(f.run('shop-a')).rejects.toThrow('工作区已改变')
    expect(f.open).not.toHaveBeenCalled()
  })
  it('打开失败原样报告，不伪造成功', async () => {
    const f = fixture()
    f.open.mockRejectedValue(Error('network failed'))
    await expect(f.run('shop-a')).rejects.toThrow('network failed')
  })
  it.each(['revoke', 'remove'] as const)(
    '加载期间 %s 则关闭旧窗口并拒绝晚到成功',
    async (change) => {
      const f = fixture()
      f.open.mockImplementation(async () => f[change]())
      await expect(f.run('shop-a')).rejects.toThrow()
      expect(f.close).toHaveBeenCalledWith('shop-a')
    },
  )
  it('复用后台窗口时返回固定首页，关闭单店不会销毁其他店铺窗口', async () => {
    const windows: {
      destroy: ReturnType<typeof vi.fn>
      loadURL: ReturnType<typeof vi.fn>
      url: string
    }[] = []
    const partitions: string[] = []
    const host = createAssistPlatformHost({
      namespace: 'local-test',
      createWindow(partition) {
        partitions.push(partition)
        const win = {
          url: '',
          destroy: vi.fn(),
          loadURL: vi.fn(async (url: string) => {
            win.url = url
          }),
          isDestroyed: () => false,
          show() {},
          focus() {},
          setTitle() {},
          once() {},
          on() {},
          webContents: { getURL: () => win.url, setWindowOpenHandler() {}, on() {} },
        }
        windows.push(win)
        return win as unknown as BrowserWindow
      },
    })
    try {
      await host.open(
        { id: 'shop-a', platform: 'pdd-web' },
        'https://mms.pinduoduo.com/aftersales/aftersale_list',
      )
      await host.open({ id: 'shop-b', platform: 'pdd-web' }, assistBackendUrl('pdd-web'))
      await host.open({ id: 'shop-a', platform: 'pdd-web' }, assistBackendUrl('pdd-web'))
      expect(windows).toHaveLength(2)
      expect(windows[0].url).toBe('https://mms.pinduoduo.com/')
      expect(partitions).toEqual([
        'persist:lingtu-local-test-shop-a',
        'persist:lingtu-local-test-shop-b',
      ])
      host.closeStore('shop-a')
      expect(windows[0].destroy).toHaveBeenCalledTimes(1)
      expect(windows[1].destroy).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  })
})
