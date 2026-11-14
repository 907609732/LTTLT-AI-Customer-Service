import { afterEach, describe, expect, it, vi } from 'vitest'
import { SendModeAuthorizations } from '../electron/send-mode-authorizations'
import type { SendProposal } from '../electron/review-console'
import type { StoreSendModeState } from '../src/shared/contracts/review'

afterEach(() => vi.useRealTimers())
function setup(initial: StoreSendModeState = { mode: 'auto', revision: 1 }) {
  let mode = initial
  let current = true
  const authorizations = new SendModeAuthorizations(() => mode)
  const proposal: SendProposal = {
    storeId: 'shop',
    uid: 'buyer',
    text: '合成回复',
    thread: [],
    isCurrent: () => current,
    getHistory: async () => ({ known: true, messages: [] }),
  }
  return {
    authorizations,
    proposal,
    setMode: (value: StoreSendModeState) => {
      mode = value
    },
    stop: () => {
      current = false
    },
  }
}
describe('回复发送模式授权租约', () => {
  it('只有明确获批候选提供一次性且精确匹配店铺、买家和正文的许可', async () => {
    const { authorizations, proposal } = setup({ mode: 'review', revision: 0 })
    expect(await authorizations.authorize(proposal, async () => false)).toBe(false)
    expect(authorizations.consume('shop', 'buyer', proposal.text)).toBeUndefined()
    expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
    expect(authorizations.consume('other', 'buyer', proposal.text)).toBeUndefined()
    expect(authorizations.consume('shop', 'other', proposal.text)).toBeUndefined()
    expect(authorizations.consume('shop', 'buyer', 'different')).toBeUndefined()
    const guard = authorizations.consume('shop', 'buyer', proposal.text)
    expect(guard?.()).toBe(true)
    expect(guard?.()).toBe(true)
    expect(authorizations.consume('shop', 'buyer', proposal.text)).toBeUndefined()
  })
  it('自动批准后进入队列或逐字输入时切回审核立即撤销，切回自动也不恢复', async () => {
    const { authorizations, proposal, setMode } = setup()
    expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
    const guard = authorizations.consume('shop', 'buyer', proposal.text)
    expect(guard?.()).toBe(true)
    setMode({ mode: 'review', revision: 2 })
    expect(guard?.()).toBe(false)
    expect(proposal.isCurrent()).toBe(false)
    setMode({ mode: 'auto', revision: 3 })
    expect(guard?.()).toBe(false)
  })
  it('批准期间切模式也不能生成许可', async () => {
    const { authorizations, proposal, setMode } = setup()
    expect(
      await authorizations.authorize(proposal, async () => {
        setMode({ mode: 'review', revision: 2 })
        return true
      }),
    ).toBe(false)
    expect(authorizations.consume('shop', 'buyer', proposal.text)).toBeUndefined()
  })
  it('尚未开始输入的自动回复在队列等待期间改模式后也被拒绝', async () => {
    const { authorizations, proposal, setMode } = setup()
    expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
    setMode({ mode: 'review', revision: 2 })
    setMode({ mode: 'auto', revision: 3 })
    expect(authorizations.consume('shop', 'buyer', proposal.text)?.()).toBe(false)
  })
  it('相同候选的新批准先完成后，晚到的旧批准不能覆盖许可', async () => {
    const { authorizations, proposal } = setup()
    let release!: (approved: boolean) => void
    const older = authorizations.authorize(
      { ...proposal },
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    expect(await authorizations.authorize({ ...proposal }, async () => true)).toBe(true)
    release(true)
    expect(await older).toBe(false)
    expect(authorizations.consume('shop', 'buyer', proposal.text)?.()).toBe(true)
  })
  it('决定异常不生成许可，关闭服务后未消费许可仍明确拒绝', async () => {
    const { authorizations, proposal } = setup()
    await expect(
      authorizations.authorize(proposal, async () => {
        throw Error('failed')
      }),
    ).rejects.toThrow('failed')
    expect(authorizations.consume('shop', 'buyer', proposal.text)).toBeUndefined()
    expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
    authorizations.dispose()
    expect(authorizations.consume('shop', 'buyer', proposal.text)?.()).toBe(false)
  })
  it('审核候选显式批准后仍可发送，切自动本身不产生许可', async () => {
    const { authorizations, proposal, setMode } = setup({ mode: 'review', revision: 0 })
    expect(
      await authorizations.authorize(proposal, async () => {
        setMode({ mode: 'auto', revision: 1 })
        return true
      }),
    ).toBe(true)
    expect(authorizations.consume('shop', 'buyer', proposal.text)?.()).toBe(true)
    expect(authorizations.consume('shop', 'buyer', proposal.text)).toBeUndefined()
  })
  it('停 AI、到期或关闭服务均撤销已经交给输入过程的 guard', async () => {
    for (const reason of ['stop', 'expiry', 'dispose']) {
      const { authorizations, proposal, stop } = setup()
      expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
      const guard = authorizations.consume('shop', 'buyer', proposal.text)
      if (reason === 'stop') stop()
      if (reason === 'dispose') authorizations.dispose()
      if (reason === 'expiry') {
        vi.useFakeTimers()
        vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
      }
      expect(guard?.()).toBe(false)
      vi.useRealTimers()
    }
  })
  it('正文与适配器相同去除首尾空白后匹配，换行内文仍需完全相同', async () => {
    const { authorizations, proposal, setMode } = setup()
    proposal.text = '  合成\n回复\n '
    expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
    expect(authorizations.consume('shop', 'buyer', '合成 回复')).toBeUndefined()
    setMode({ mode: 'review', revision: 2 })
    expect(authorizations.consume('shop', 'buyer', '合成\n回复')?.()).toBe(false)
  })
  it('worker明确结束后释放本会话未消费许可，保留其他买家与其他店铺', async () => {
    const { authorizations, proposal } = setup()
    for (const row of [proposal, { ...proposal, uid: 'other' }, { ...proposal, storeId: 'other' }])
      expect(await authorizations.authorize(row, async () => true)).toBe(true)
    authorizations.release('shop', 'buyer')
    expect(authorizations.consume('shop', 'buyer', proposal.text)).toBeUndefined()
    expect(authorizations.consume('shop', 'other', proposal.text)?.()).toBe(true)
    expect(authorizations.consume('other', 'buyer', proposal.text)?.()).toBe(true)
  })
  it('100条未消费许可后拒绝新候选，不逐出许可导致发送回退', async () => {
    const { authorizations, proposal } = setup()
    for (let index = 0; index < 100; index++) {
      const candidate = { ...proposal, text: String(index) }
      expect(await authorizations.authorize(candidate, async () => true)).toBe(true)
    }
    const decision = vi.fn(async () => true)
    expect(await authorizations.authorize({ ...proposal, text: '100' }, decision)).toBe(false)
    expect(decision).not.toHaveBeenCalled()
    expect(authorizations.consume('shop', 'buyer', '1')?.()).toBe(true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
    expect(authorizations.consume('shop', 'buyer', '99')?.()).toBe(false)
  })
})
