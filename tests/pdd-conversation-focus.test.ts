import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync('vendor/lingtu-runtime/desk-v1/src/injections/pdd-web-hook.js', 'utf8')
interface Page {
  window: Window & typeof globalThis
}
// Reuse the installed test environment's jsdom; only these page APIs are needed.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => Page
}
const pages: Page[] = []
afterEach(() => {
  for (const page of pages.splice(0)) page.window.close()
  vi.useRealTimers()
})
function fixture(accept: boolean) {
  vi.useFakeTimers()
  const page = new JSDOM(
    '<div id="app"><div class="chat-item-box active" data-random="old-0-reply"></div><div class="chat-item-box" data-random="buyer-0-unRead"></div></div>',
    { url: 'https://mms.pinduoduo.com/chat-merchant/index.html', runScripts: 'outside-only' },
  )
  pages.push(page)
  const { window } = page
  const state = { currentUserInfo: { userInfo: { uid: 'old' } }, chatList: [] }
  Object.assign(window.document.querySelector('#app')!, {
    __vue__: { $store: { state, getters: {} } },
  })
  const events: string[] = []
  const row = window.document.querySelector('[data-random="buyer-0-unRead"]')!
  Object.assign(row, { scrollIntoView() {} })
  for (const name of ['mousedown', 'mouseup', 'click'])
    row.addEventListener(name, () => {
      events.push(name)
      if (name === 'mousedown' && accept) state.currentUserInfo.userInfo.uid = 'buyer'
    })
  window.eval(source)
  const api = Reflect.get(window, '__pddWeb') as {
    focusConversation(uid: string): Promise<{ ok: boolean }>
  }
  return { api, events, state }
}
it('switches an unread conversation using the platform mousedown interaction before reporting success', async () => {
  const { api, events, state } = fixture(true)
  const result = api.focusConversation('buyer')
  await vi.advanceTimersByTimeAsync(600)
  expect(await result).toMatchObject({ ok: true })
  expect(events).toEqual(['mousedown', 'mouseup', 'click'])
  expect(state.currentUserInfo.userInfo.uid).toBe('buyer')
})
it('does not report success when the platform ignores the click and remains on another buyer', async () => {
  const { api } = fixture(false)
  const result = api.focusConversation('buyer')
  await vi.advanceTimersByTimeAsync(600)
  expect(await result).toMatchObject({ ok: false })
})
it('does not click another buyer whose ID merely starts with the requested ID', async () => {
  const { api, events } = fixture(true)
  expect(await api.focusConversation('buy')).toMatchObject({ ok: false })
  expect(events).toEqual([])
})
