import { describe, expect, it, vi } from 'vitest'
import {
  defaultWelcomeDelay,
  normalizeWelcomeSetting,
  welcomeDelayIssue,
} from '../src/shared/contracts/welcome'
import {
  createWelcomeDelayGate,
  parseWelcomeDelay,
  sampleWelcomeDelayMs,
  waitWelcomeDelay,
} from '../electron/welcome-delay'
import type { SendProposal } from '../electron/review-console'
import { SendModeAuthorizations } from '../electron/send-mode-authorizations'
import type { StoreSendModeState } from '../src/shared/contracts/review'

describe('欢迎延迟校验与默认值', () => {
  it('旧记录缺省为 1～3 秒，整数范围 1～3600 且下限不大于上限', () => {
    expect(defaultWelcomeDelay).toEqual({ delayMinSeconds: 1, delayMaxSeconds: 3 })
    expect(normalizeWelcomeSetting({ text: '欢迎', enabled: true, version: 2 })).toEqual({
      text: '欢迎',
      enabled: true,
      version: 2,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    })
    expect(parseWelcomeDelay({})).toEqual({ delayMinSeconds: 1, delayMaxSeconds: 3 })
    expect(parseWelcomeDelay({ delayMinSeconds: 7, delayMaxSeconds: 7 })).toEqual({
      delayMinSeconds: 7,
      delayMaxSeconds: 7,
    })
    expect(welcomeDelayIssue(5, 9)).toBe('')
    expect(welcomeDelayIssue(9, 5)).toContain('下限')
    expect(welcomeDelayIssue(0, 5)).toContain('1～3600')
    expect(welcomeDelayIssue(1, 3601)).toContain('1～3600')
    expect(welcomeDelayIssue(1.5, 4)).toContain('整数')
    expect(welcomeDelayIssue(undefined, 4)).toContain('整数')
  })
  it('拒绝反向、越界和非整数范围，不隐式排序或裁剪', () => {
    for (const value of [
      { delayMinSeconds: 9, delayMaxSeconds: 2 },
      { delayMinSeconds: 0, delayMaxSeconds: 3 },
      { delayMinSeconds: 1, delayMaxSeconds: 3601 },
      { delayMinSeconds: 2.5, delayMaxSeconds: 4 },
      { delayMinSeconds: '1', delayMaxSeconds: 3 },
    ])
      expect(() => parseWelcomeDelay(value)).toThrow('1～3600')
  })
})

describe('欢迎延迟一次性抽样', () => {
  it('随机边界取整、固定范围不抽随机、异常随机值夹取到范围内', () => {
    const random = vi.fn(() => 1)
    expect(sampleWelcomeDelayMs({ delayMinSeconds: 1, delayMaxSeconds: 3 }, random)).toBe(3000)
    expect(random).toHaveBeenCalledTimes(1)
    const fixed = vi.fn(() => 0)
    expect(sampleWelcomeDelayMs({ delayMinSeconds: 4, delayMaxSeconds: 4 }, fixed)).toBe(4000)
    expect(fixed).not.toHaveBeenCalled()
    expect(sampleWelcomeDelayMs({ delayMinSeconds: 1, delayMaxSeconds: 3 }, () => 5)).toBe(3000)
    expect(sampleWelcomeDelayMs({ delayMinSeconds: 1, delayMaxSeconds: 3 }, () => -1)).toBe(1000)
    expect(sampleWelcomeDelayMs({ delayMinSeconds: 1, delayMaxSeconds: 3 }, () => NaN)).toBe(1000)
    expect(sampleWelcomeDelayMs({ delayMinSeconds: 2, delayMaxSeconds: 4 }, () => 0.5)).toBe(3000)
  })
})

describe('欢迎延迟等待与取消', () => {
  const sleepFixture = () => {
    const clock = { now: 0 }
    const sleeps: number[] = []
    return {
      clock,
      sleeps,
      now: () => clock.now,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds)
        clock.now += milliseconds
      },
    }
  }
  it('按固定截止时间分块等待，完成后返回成功且不重新抽样', async () => {
    const f = sleepFixture()
    const random = vi.fn(() => 1)
    const duration = sampleWelcomeDelayMs({ delayMinSeconds: 1, delayMaxSeconds: 3 }, random)
    const current = vi.fn(() => '')
    const result = await waitWelcomeDelay({
      durationMs: duration,
      checkCurrent: current,
      now: f.now,
      sleep: f.sleep,
    })
    expect(result).toEqual({ ok: true })
    expect(random).toHaveBeenCalledTimes(1)
    expect(f.clock.now).toBe(3000)
    expect(f.sleeps.reduce((sum, value) => sum + value, 0)).toBe(3000)
    expect(f.sleeps.every((value) => value <= 100)).toBe(true)
  })
  it('会话状态改变立即取消，不等待剩余时间也不重新抽样', async () => {
    const f = sleepFixture()
    const cancelAt = 350
    const result = await waitWelcomeDelay({
      durationMs: 3000,
      checkCurrent: () => (f.clock.now >= cancelAt ? '会话已变化' : ''),
      now: f.now,
      sleep: f.sleep,
    })
    expect(result).toEqual({ ok: false, reason: '会话已变化' })
    expect(f.clock.now).toBe(400)
    expect(f.clock.now).toBeLessThan(3000)
  })
  it('页面复核变化立即取消，且中止信号在下一档内结束等待', async () => {
    const f = sleepFixture()
    const fresh = vi.fn(async () => '网页消息已变化')
    expect(
      await waitWelcomeDelay({
        durationMs: 3000,
        checkCurrent: () => '',
        verifyFresh: fresh,
        now: f.now,
        sleep: f.sleep,
      }),
    ).toEqual({ ok: false, reason: '网页消息已变化' })
    expect(fresh).toHaveBeenCalledTimes(1)
    const controller = new AbortController()
    const result = await waitWelcomeDelay({
      durationMs: 3000,
      checkCurrent: () => '',
      signal: controller.signal,
      now: f.now,
      sleep: async (milliseconds: number) => {
        f.clock.now += milliseconds
        controller.abort()
      },
    })
    expect(result.ok).toBe(false)
    expect(f.clock.now).toBe(600)
  })
})

describe('欢迎延迟发送门', () => {
  const proposal = (welcome?: { version: number }): SendProposal => ({
    storeId: 'shop',
    uid: 'buyer',
    text: '欢迎光临\n正文',
    thread: [{ from: 'buyer', content: '在吗', ts: 1 }],
    ...(welcome ? { welcome } : {}),
    isCurrent: () => true,
    getHistory: async () => ({ known: true, messages: [] }),
  })
  const fixture = (overrides: Partial<Parameters<typeof createWelcomeDelayGate>[0]> = {}) => {
    const clock = { now: 0 }
    const sleeps: number[] = []
    const welcome = {
      text: '欢迎光临',
      enabled: true,
      version: 1,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    }
    const state = {
      welcome,
      store: { online: true, aiEnabled: true },
      conversation: { fingerprint: 'same', lastFrom: 'buyer' },
    }
    const cancel = vi.fn()
    const release = vi.fn()
    const gate = createWelcomeDelayGate({
      readWelcome: () => state.welcome,
      readStore: () => state.store,
      conversation: () => state.conversation,
      cancel,
      releaseSendAuthorization: release,
      random: () => 0,
      now: () => clock.now,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds)
        clock.now += milliseconds
      },
      ...overrides,
    })
    return { gate, state, cancel, release, clock, sleeps }
  }

  it('普通回复没有欢迎元数据时不抽样、不等待，保持原发送路径', async () => {
    const f = fixture()
    const random = vi.fn(() => 0)
    const read = vi.fn()
    const gate = createWelcomeDelayGate({
      readWelcome: read,
      readStore: () => ({ online: true, aiEnabled: true }),
      conversation: () => ({ fingerprint: 'same', lastFrom: 'buyer' }),
      cancel: vi.fn(),
      random,
    })
    expect(await gate(proposal(), true)).toBe(true)
    expect(random).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(f.cancel).not.toHaveBeenCalled()
  })
  it('欢迎回复在批准后等待一次抽样延迟，配置一致才放行', async () => {
    const f = fixture()
    expect(await f.gate(proposal({ version: 1 }), true)).toBe(true)
    expect(f.clock.now).toBe(1000)
    expect(f.cancel).not.toHaveBeenCalled()
  })
  it('被拒绝或欢迎版本不一致时不等待也不放行', async () => {
    const f = fixture()
    expect(await f.gate(proposal({ version: 1 }), false)).toBe(false)
    expect(f.sleeps).toEqual([])
    f.state.welcome = { ...f.state.welcome, version: 2 }
    expect(await f.gate(proposal({ version: 1 }), true)).toBe(false)
    expect(f.sleeps).toEqual([])
    expect(f.cancel).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledWith('shop', 'buyer')
  })
  it('等待期间停用欢迎、切店停 AI、改版本或出现新消息都取消且不放行', async () => {
    for (const change of ['disabled', 'store', 'version', 'message', 'dispose'] as const) {
      const controller = new AbortController()
      let scheduled = false
      const f = fixture({
        ...(change === 'dispose' ? { signal: controller.signal } : {}),
        sleep: async (milliseconds: number) => {
          f.clock.now += milliseconds
          if (scheduled) return
          scheduled = true
          if (change === 'disabled') f.state.welcome = { ...f.state.welcome, enabled: false }
          if (change === 'store') f.state.store = { online: true, aiEnabled: false }
          if (change === 'version') f.state.welcome = { ...f.state.welcome, version: 2 }
          if (change === 'message')
            f.state.conversation = { fingerprint: 'changed', lastFrom: 'buyer' }
          if (change === 'dispose') controller.abort()
        },
      })
      const target = proposal({ version: 1 })
      expect(await f.gate(target, true)).toBe(false)
      expect(f.cancel).toHaveBeenCalledTimes(1)
      expect(f.release).toHaveBeenCalledWith('shop', 'buyer')
      // 延迟取消不会发送，也不会因新消息把旧候选改写成可重发内容。
      expect(f.clock.now).toBeLessThan(3000)
      if (change === 'message') expect(target.retryNewMessage).toBe(true)
    }
  })
  it('页面消息在等待期间变化时取消，取消释放 PDD 发送授权', async () => {
    let fresh = 0
    const f = fixture()
    const pageProposal = {
      ...proposal({ version: 1 }),
      pageReview: {
        known: true,
        page: 'p1',
        uid: 'buyer',
        messages: [{ from: 'buyer', content: '在吗' }],
      },
      getPageReview: async () => {
        fresh += 1
        return {
          known: true,
          page: 'p1',
          uid: 'buyer',
          messages: [
            { from: 'buyer', content: '在吗' },
            { from: 'buyer', content: '新问题' },
          ],
        }
      },
    }
    expect(await f.gate(pageProposal, true)).toBe(false)
    expect(fresh).toBe(1)
    expect(f.cancel).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledWith('shop', 'buyer')
    expect(pageProposal.retryNewMessage).toBe(true)
  })
  it('延迟取消时不产生新的 PDD 租约，且只释放当前店铺买家', async () => {
    const mode: StoreSendModeState = { mode: 'auto', revision: 1 }
    const authorizations = new SendModeAuthorizations(() => mode)
    const target = proposal({ version: 1 })
    const other = { ...proposal({ version: 1 }), uid: 'other' }
    expect(await authorizations.authorize(other, async () => true)).toBe(true)
    const f = fixture({
      releaseSendAuthorization: (storeId, uid) => authorizations.release(storeId, uid),
      sleep: async () => {
        // 批准后在延迟期间切回审核模式，旧自动租约必须失效。
        mode.mode = 'review'
        mode.revision = 2
      },
    })
    expect(await authorizations.authorize(target, async () => f.gate(target, true))).toBe(false)
    expect(authorizations.consume('shop', 'buyer', target.text)).toBeUndefined()
    // 其他买家的未消费租约不受本会话取消影响。
    expect(authorizations.consume('shop', 'other', other.text)?.()).toBe(false)
  })
})
