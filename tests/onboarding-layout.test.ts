import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
it('真实平台布局为引导留顶，退出恢复，短窗不产生负尺寸，隐藏时原生页不可见', () => {
  const setBounds = vi.fn(),
    setVisible = vi.fn()
  const entries = new Map([['shop-a', { view: { setBounds, setVisible } }]])
  type Entries = typeof entries
  let layout: (views: Entries) => void = () => {}
  let height = 720
  const window = {
    isDestroyed: () => false,
    getContentSize: () => [1280, height],
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  class Manager {
    constructor(options: { layoutViews: typeof layout }) {
      layout = options.layoutViews
    }
    open() {
      return Promise.resolve()
    }
    relayout() {
      layout(entries)
    }
  }
  const module = { exports: {} }
  runInNewContext(readFileSync('vendor/lingtu-runtime/electron/platform-host.cjs', 'utf8'), {
    module,
    require: (id: string) =>
      id === 'node:path'
        ? path
        : id.includes('shop-window')
          ? { ShopWindowManager: Manager }
          : id.includes('client-launcher')
            ? { ClientLauncher: class {} }
            : {},
  })
  const { createPlatformHost } = module.exports as {
    createPlatformHost(options: { dataDir: string; getWindow: () => typeof window }): {
      managerFactory(deps: Record<string, unknown>): unknown
      setPresentation(input: { storeId: string; visible: boolean; layout?: string }): void
    }
  }
  const host = createPlatformHost({ dataDir: '.', getWindow: () => window })
  host.managerFactory({ logger: { child: () => ({}) } })
  host.setPresentation({ storeId: 'shop-a', visible: true, layout: 'onboarding-login' })
  expect(setBounds).toHaveBeenLastCalledWith({ x: 300, y: 216, width: 980, height: 504 })
  host.setPresentation({ storeId: 'shop-a', visible: true })
  expect(setBounds).toHaveBeenLastCalledWith({ x: 300, y: 72, width: 980, height: 648 })
  height = 100
  host.setPresentation({ storeId: 'shop-a', visible: true, layout: 'onboarding-login' })
  expect(setVisible).toHaveBeenLastCalledWith(false)
  host.setPresentation({ storeId: 'shop-a', visible: false })
  expect(setVisible).toHaveBeenLastCalledWith(false)
})
