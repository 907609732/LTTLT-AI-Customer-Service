import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  XianyuPageBridge,
  type XianyuBridgeLogger,
  type XianyuBridgeTransportError,
} from '../electron/xianyu/bridge-client'

// The transport only needs a source string to inject; the real bridge is executed
// by tests/xianyu-bridge-guards.test.ts. Point the build-time path at the source
// tree so this test does not depend on dist-electron when running from source.
vi.mock('node:path', () => {
  const join = () => `${process.cwd()}/vendor/xianyu-bridge/bridge.js`
  return { default: { join }, join }
})

const logger: XianyuBridgeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

const bridges: XianyuPageBridge[] = []

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose()
})

interface FakeContents {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  isDestroyed(): boolean
  getURL(): string
  focus(): void
  on(event: string, listener: () => void): void
  once(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
}

function fakeContents(execute: (code: string) => Promise<unknown>): WebContents {
  const contents: FakeContents = {
    executeJavaScript: execute,
    isDestroyed: () => false,
    getURL: () => 'https://www.goofish.com/im',
    focus() {},
    on() {},
    once() {},
    removeListener() {},
  }
  return contents as unknown as WebContents
}

function createBridge(execute: (code: string) => Promise<unknown>): XianyuPageBridge {
  const bridge = new XianyuPageBridge(fakeContents(execute), logger)
  bridges.push(bridge)
  return bridge
}

function transportCode(error: unknown): string | undefined {
  return (error as XianyuBridgeTransportError | undefined)?.code
}

describe('闲鱼页面桥接传输取消', () => {
  it('入口即失效时不向页面注入或执行任何操作', async () => {
    const executed: string[] = []
    const bridge = createBridge(async (code) => {
      executed.push(code)
      return undefined
    })
    const error = await bridge
      .invoke('write', { text: 'AI 回复' }, 1_000, { isCurrent: () => false })
      .catch((caught: unknown) => caught)
    expect(transportCode(error)).toBe('bridge_rejected')
    expect(executed).toHaveLength(0)
  })

  it('异步注入期间授权失效时不再执行页面写操作', async () => {
    let current = true
    const executed: string[] = []
    const bridge = createBridge(async (code) => {
      executed.push(code)
      if (code.includes('bridge.handle(')) {
        throw new Error('授权失效后的页面操作不应到达 bridge.handle')
      }
      if (code.includes('var bridge = window.__shanhui')) {
        return { shim: true, bridge: true }
      }
      // 注入脚本正在执行时，商家刚好停止 AI。
      current = false
      return undefined
    })
    const error = await bridge
      .invoke('write', { text: 'AI 回复' }, 1_000, { isCurrent: () => current })
      .catch((caught: unknown) => caught)
    expect(transportCode(error)).toBe('bridge_rejected')
    expect(executed.some((code) => code.includes('bridge.handle('))).toBe(false)
    expect(executed.length).toBeGreaterThan(0)
  })

  it('授权仍有效时注入后正常执行并解析页面回包', async () => {
    const executed: string[] = []
    const bridge = createBridge(async (code) => {
      executed.push(code)
      if (code.includes('bridge.handle(')) {
        const id = Number(/api\.pending\[(\d+)\]/.exec(code)?.[1] ?? 0)
        return { kind: 'reply', id, ok: true, data: '{"clicked":true}' }
      }
      if (code.includes('var bridge = window.__shanhui')) {
        return { shim: true, bridge: true }
      }
      return undefined
    })
    await expect(
      bridge.invoke('write', { text: 'AI 回复' }, 1_000, { isCurrent: () => true }),
    ).resolves.toEqual({ clicked: true })
    expect(executed.some((code) => code.includes('bridge.handle('))).toBe(true)
  })
})
