import { expect, it } from 'vitest'
import { createWelcomeDelayGate, waitWelcomeDelay } from '../electron/welcome-delay'
import type { SendProposal } from '../electron/review-console'

it('final asynchronous page verification cannot approve a welcome invalidated while awaiting it', async () => {
  let now = 0
  let invalidated = false
  const result = await waitWelcomeDelay({
    durationMs: 1000,
    freshCheckEveryMs: 5000,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds
    },
    checkCurrent: () => (invalidated ? '欢迎配置已更新' : ''),
    verifyFresh: async () => {
      // The page is unchanged, but the user changed the welcome setting during the read.
      await Promise.resolve()
      invalidated = true
      return ''
    },
  })
  expect(result).toEqual({ ok: false, reason: '欢迎配置已更新' })
})

it('welcome validity remains in the proposal guard after the delay until the actual platform send', async () => {
  let now = 0
  const setting = { enabled: true, text: '欢迎', version: 1 }
  const proposal: SendProposal = {
    storeId: 'shop',
    uid: 'buyer',
    text: '欢迎\n正文',
    thread: [],
    welcome: { version: 1 },
    isCurrent: () => true,
    getHistory: async () => ({ known: true, messages: [] }),
  }
  const gate = createWelcomeDelayGate({
    readWelcome: () => setting,
    readStore: () => ({ online: true, aiEnabled: true }),
    conversation: () => ({ fingerprint: 'same', lastFrom: 'buyer' }),
    cancel: () => {},
    random: () => 0,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds
    },
  })
  expect(await gate(proposal, true)).toBe(true)
  expect(proposal.isCurrent()).toBe(true)
  setting.version += 1
  expect(proposal.isCurrent()).toBe(false)
})
