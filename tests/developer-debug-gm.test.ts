import { describe, expect, it, vi } from 'vitest'
import { createGmRegistry, type GmStore } from '../electron/developer-debug/gm'
import { createPopupPolicy } from '../electron/developer-debug/popup-policy'
import type { LogEntry } from '../src/shared/contracts/review'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const stores: GmStore[] = [
  {
    id: 'pdd-1',
    storeName: '拼多多测试店',
    platform: 'pdd-web',
    open: true,
    online: true,
    authenticated: true,
    aiEnabled: false,
    sendMode: 'review',
  },
  {
    id: 'sim-1',
    storeName: '模拟店',
    platform: 'sim-local',
    open: false,
    online: false,
    authenticated: null,
    aiEnabled: false,
    sendMode: 'review',
  },
]
const logs: LogEntry[] = [
  {
    id: 'log-1',
    at: 1,
    storeId: 'pdd-1',
    storeName: '拼多多测试店',
    uid: 'buyer',
    buyerName: '买家',
    kind: 'reply:error',
    text: 'Authorization: Bearer secret-token apiKey=sk-secretsecretsecret',
  },
]
function fixture() {
  const popup = {
    status: vi.fn(() => ({
      mode: 'block' as const,
      applied: false,
      url: '',
      message: '店铺页面尚未打开',
    })),
    set: vi.fn((_storeId: string, _mode: 'allow' | 'block') => ({
      mode: _mode,
      applied: true,
      url: 'https://mms.pinduoduo.com/',
      message: '',
    })),
  }
  const gm = createGmRegistry({
    workspaceId,
    appVersion: '1.0.53',
    stores: () => stores,
    logs: () => logs,
    popup,
    terminal: () => ({ connected: false, cwd: 'C:\\project', sessionId: '' }),
  })
  return { gm, popup }
}
const run = (gm: ReturnType<typeof fixture>['gm'], input: string, storeId?: string) =>
  gm.run({ workspaceId, storeId, input })

describe('GM registry', () => {
  it('help/status/stores are bounded read-only diagnostics without credentials', async () => {
    const { gm } = fixture()
    const help = await run(gm, 'help')
    expect(help.ok).toBe(true)
    for (const command of ['help', 'status', 'stores', 'logs', 'pdd-popup']) {
      expect(help.text).toContain(command)
    }
    const status = await run(gm, 'status')
    expect(status.ok).toBe(true)
    expect(status.text).toContain('v1.0.53')
    expect(status.text).toContain(workspaceId)
    expect(status.text).not.toMatch(/api[-_ ]?key|bearer|cookie|password|secret/i)
    const list = await run(gm, 'stores')
    expect(list.text).toContain('pdd-1')
    expect(list.text).toContain('拼多多测试店')
    expect(list.text).toContain('mms.pinduoduo.com')
    expect(list.text).not.toContain('secret')
  })

  it('logs accepts a bounded count syntax and redacts credential-shaped text', async () => {
    const { gm } = fixture()
    for (const input of ['logs', 'logs 1', 'logs[1]']) {
      const result = await run(gm, input)
      expect(result.ok).toBe(true)
      expect(result.text).toContain('reply:error')
      expect(result.text).not.toContain('secret-token')
      expect(result.text).not.toContain('sk-secretsecretsecret')
    }
    for (const input of ['logs 0', 'logs 101', 'logs[-1]', 'logs 3 extra']) {
      const result = await run(gm, input)
      expect(result.ok).toBe(false)
      expect(result.text).toContain('logs')
    }
    const many = await fixture().gm.run({ workspaceId, input: 'logs[100]' })
    expect(many.text.length).toBeLessThanOrEqual(12000)
  })

  it('unknown commands and malformed input fail explicitly without eval', async () => {
    const { gm } = fixture()
    for (const input of ['unknown', 'console.log(1)', '', 'status extra']) {
      const result = await run(gm, input)
      expect(result.ok).toBe(false)
      expect(result.text.length).toBeGreaterThan(0)
    }
    expect((await run(gm, 'unknown')).text).toContain('未知命令')
    expect((await run(gm, 'pdd-popup status')).text).toContain('选择店铺')
    expect((await run(gm, 'pdd-popup status', 'sim-1')).text).toContain('拼多多')
    expect((await run(gm, 'pdd-popup allow', 'missing')).text).toContain('店铺不存在')
  })

  it('pdd-popup binds the explicit store and reports the ephemeral policy', async () => {
    const { gm, popup } = fixture()
    const status = await run(gm, 'pdd-popup status', 'pdd-1')
    expect(status.ok).toBe(true)
    expect(popup.status).toHaveBeenLastCalledWith('pdd-1')
    const allow = await run(gm, 'pdd-popup allow', 'pdd-1')
    expect(allow.ok).toBe(true)
    expect(popup.set).toHaveBeenLastCalledWith('pdd-1', 'allow')
    const block = await run(gm, 'pdd-popup block', 'pdd-1')
    expect(block.ok).toBe(true)
    expect(popup.set).toHaveBeenLastCalledWith('pdd-1', 'block')
    expect((await run(gm, 'pdd-popup maybe', 'pdd-1')).ok).toBe(false)
  })
})

describe('pdd popup policy', () => {
  function webContents(url = 'https://mms.pinduoduo.com/goods') {
    return {
      id: 41,
      isDestroyed: () => false,
      getURL: () => url,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    }
  }
  const owner = {
    id: 1,
    isDestroyed: () => false,
    getURL: () => 'https://mms.pinduoduo.com/',
  }
  it('allow only permits normal web URLs in a sandboxed child', () => {
    const page = webContents()
    const policy = createPopupPolicy({
      getStoreWebContents: () => page as never,
      getOwnerWebContents: () => owner as never,
      openExternal: vi.fn(async () => {}),
    })
    policy.set('pdd-1', 'allow')
    const handler = page.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => {
      action: string
      overrideBrowserWindowOptions?: {
        webPreferences?: {
          sandbox?: boolean
          contextIsolation?: boolean
          nodeIntegration?: boolean
        }
      }
    }
    const allowed = handler({ url: 'https://example.com/help' })
    expect(allowed.action).toBe('allow')
    expect(allowed.overrideBrowserWindowOptions?.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    })
    expect(handler({ url: 'about:blank' }).action).toBe('allow')
    expect(handler({ url: 'javascript:alert(1)' }).action).toBe('deny')
    expect(handler({ url: 'file:///C:/Windows/win.ini' }).action).toBe('deny')
  })

  it('block restores the vendor default external-open + deny behavior', () => {
    const page = webContents()
    const openExternal = vi.fn(async () => {})
    const policy = createPopupPolicy({
      getStoreWebContents: () => page as never,
      getOwnerWebContents: () => owner as never,
      openExternal,
    })
    policy.set('pdd-1', 'allow')
    policy.set('pdd-1', 'block')
    const handler = page.setWindowOpenHandler.mock.calls[1]![0] as (details: { url: string }) => {
      action: string
    }
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenLastCalledWith('https://example.com')
  })

  it('re-applies the in-memory per-store policy when the store page is rebuilt', () => {
    let page = webContents()
    const policy = createPopupPolicy({
      getStoreWebContents: () => page as never,
      getOwnerWebContents: () => owner as never,
      openExternal: vi.fn(async () => {}),
    })
    policy.set('pdd-1', 'allow')
    page = webContents('https://mms.pinduoduo.com/new-page?ticket=secret#fragment')
    policy.sync('pdd-1')
    expect(page.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    const handler = page.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => {
      action: string
    }
    expect(handler({ url: 'https://example.com' }).action).toBe('allow')
    expect(policy.status('pdd-1').url).toBe('https://mms.pinduoduo.com/new-page')
  })

  it('uses the exact store WebContents, verifies the PDD host, and rejects the monitor owner', () => {
    const page = webContents()
    const policy = createPopupPolicy({
      getStoreWebContents: () => page as never,
      getOwnerWebContents: () => owner as never,
      openExternal: vi.fn(async () => {}),
    })
    expect(policy.set('pdd-1', 'allow').applied).toBe(true)
    const other = createPopupPolicy({
      getStoreWebContents: () => webContents('https://example.com/') as never,
      getOwnerWebContents: () => owner as never,
      openExternal: vi.fn(async () => {}),
    })
    expect(() => other.set('pdd-1', 'allow')).toThrow(/mms\.pinduoduo\.com/)
    const same = createPopupPolicy({
      getStoreWebContents: () => owner as never,
      getOwnerWebContents: () => owner as never,
      openExternal: vi.fn(async () => {}),
    })
    expect(() => same.set('pdd-1', 'allow')).toThrow(/监控/)
  })
})
