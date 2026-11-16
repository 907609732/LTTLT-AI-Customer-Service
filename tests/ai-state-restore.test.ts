import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { StoreAiPreferences } from '../electron/store-ai-preferences'
import { AiStateRestore, type AiRestoreStore } from '../electron/ai-state-restore'
import { StoreSendModes } from '../electron/store-send-modes'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-ai-state-'))
  dirs.push(dir)
  return dir
}
function fixture() {
  const dir = directory(),
    preferences = new StoreAiPreferences(dir)
  const stores: AiRestoreStore[] = [
    {
      id: 'store-a',
      platform: 'pdd-web',
      mallId: 'mall',
      customerServiceId: 'agent',
      aiEnabled: false,
      runtime: { open: true, online: true, authenticated: true },
    },
  ]
  let verifier = async (): Promise<typeof identity | undefined> => ({ ...identity })
  let allowed = true,
    issue = false
  const calls: { action: string; storeId?: string; values?: Record<string, unknown> }[] = []
  let effect: ((command: (typeof calls)[number]) => Promise<unknown>) | undefined
  const restore = new AiStateRestore({
    preferences,
    verifyIdentity: () => verifier(),
    stores: () => stores,
    allowed: () => allowed,
    modelBlocked: () => issue,
    execute: async (command) => {
      calls.push(command)
      if (effect) return effect(command)
      if (command.action === 'set-ai')
        stores.find((s) => s.id === command.storeId)!.aiEnabled = command.values?.enabled === true
      return { status: 'ok', message: '', data: {} }
    },
    changed: () => {},
  })
  return {
    dir,
    preferences,
    stores,
    restore,
    calls,
    verify: (value: typeof verifier) => {
      verifier = value
    },
    allow: (v: boolean) => {
      allowed = v
      restore.accessChanged()
    },
    issue: () => {
      issue = true
    },
    effect: (v: typeof effect) => {
      effect = v
    },
  }
}
const identity = { platform: 'pdd-web', mallId: 'mall', customerServiceId: 'agent' }
it('persists explicit choices atomically and isolates accounts without changing send modes; corrupt and missing stay off', () => {
  const dir = directory(),
    p = new StoreAiPreferences(dir),
    modes = new StoreSendModes(dir)
  expect(p.read('store-a')).toBeUndefined()
  modes.set('store-a', 'auto')
  p.enable('store-a', identity)
  expect(new StoreAiPreferences(dir).read('store-a')).toEqual(identity)
  expect(new StoreAiPreferences(path.join(dir, 'other')).read('store-a')).toBeUndefined()
  p.disable('store-a')
  expect(new StoreAiPreferences(dir).read('store-a')).toBeUndefined()
  expect(new StoreSendModes(dir).read('store-a').mode).toBe('auto')
  fs.writeFileSync(path.join(dir, 'store-ai-preferences.json'), '{broken')
  expect(new StoreAiPreferences(dir).read('store-a')).toBeUndefined()
})
it('records only successful actual explicit enables; batch partial outcomes do not invent intent', async () => {
  const f = fixture()
  await f.restore.userExecute({ action: 'set-ai', storeId: 'store-a', values: { enabled: true } })
  expect(f.preferences.read('store-a')).toEqual(identity)
  await f.restore.userExecute({ action: 'set-ai', storeId: 'store-a', values: { enabled: false } })
  expect(f.preferences.read('store-a')).toBeUndefined()
  f.stores.push({ ...f.stores[0]!, id: 'store-b', aiEnabled: false })
  f.effect(async () => {
    f.stores[0]!.aiEnabled = true
    return {
      status: 'ok',
      data: {
        results: [
          { id: 'store-a', ok: true },
          { id: 'store-b', ok: false },
        ],
      },
    }
  })
  await f.restore.userExecute({ action: 'batch', values: { operation: 'enable' } })
  expect(f.preferences.read('store-a')).toEqual(identity)
  expect(f.preferences.read('store-b')).toBeUndefined()
})
it('opens remembered stores only, waits for verified same identity login and restores once through set-ai', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.stores[0]!.runtime = { open: false, online: false, authenticated: null }
  await f.restore.start()
  expect(f.calls.map((c) => c.action)).toEqual(['open-store'])
  expect(f.restore.state('store-a')?.status).toBe('waiting')
  Object.assign(f.stores[0]!.runtime, { open: true, online: true, authenticated: true })
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.calls.filter((c) => c.action === 'set-ai' && c.values?.enabled)).toHaveLength(1)
  expect(f.stores[0]!.aiEnabled).toBe(true)
})
it('rejects mismatched or absent identities and model issues without retrying login heartbeats', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.stores[0]!.customerServiceId = 'other'
  await f.restore.start()
  expect(f.calls).toHaveLength(0)
  expect(f.restore.state('store-a')?.status).toBe('failed')
  f.stores[0]!.customerServiceId = 'agent'
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.calls).toHaveLength(0)
  const g = fixture()
  g.preferences.enable('store-a', identity)
  g.issue()
  await g.restore.start()
  expect(g.calls).toHaveLength(0)
})
it('off cancels an in-flight enable immediately and prevents late completion from persisting on', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  let release!: () => void
  f.effect(async (c) => {
    if (c.values?.enabled)
      await new Promise<void>((r) => {
        release = r
      })
    return { status: 'ok', data: {} }
  })
  const starting = f.restore.start()
  await Promise.resolve()
  await f.restore.userExecute({ action: 'set-ai', storeId: 'store-a', values: { enabled: false } })
  release()
  await starting
  expect(f.preferences.read('store-a')).toBeUndefined()
  expect(f.calls.at(-1)?.values?.enabled).toBe(false)
})
it('startup open finishing after off cannot restart AI; batch disable clears waiting intent', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.stores[0]!.runtime.open = false
  let release!: () => void
  f.effect(async (c) => {
    if (c.action === 'open-store') {
      await new Promise<void>((r) => {
        release = r
      })
      f.stores[0]!.runtime.open = true
    }
    return { status: 'ok', data: {} }
  })
  const pending = f.restore.start()
  await Promise.resolve()
  await f.restore.userExecute({ action: 'batch', values: { operation: 'disable' } })
  release()
  await pending
  expect(f.calls.some((c) => c.values?.enabled === true)).toBe(false)
  expect(f.preferences.read('store-a')).toBeUndefined()
})
it('logout and dispose invalidate in-flight starts; errors do not loop and new verified login may try again', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.effect(async () => {
    throw Error('model not ready')
  })
  await f.restore.start()
  expect(f.restore.state('store-a')?.message).toContain('恢复失败')
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.calls).toHaveLength(1)
  f.allow(false)
  f.effect(undefined)
  f.allow(true)
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.stores[0]!.aiEnabled).toBe(true)
  f.restore.dispose()
  f.stores[0]!.aiEnabled = false
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.stores[0]!.aiEnabled).toBe(false)
})
it('reentrant login events do not start twice, close/remove clear preference', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.effect(async (c) => {
    if (c.values?.enabled)
      await f.restore.event({
        type: 'shop:login_state',
        storeId: 'store-a',
        authenticated: true,
        online: true,
      })
    return { status: 'ok', data: {} }
  })
  await f.restore.start()
  expect(f.calls).toHaveLength(1)
  await f.restore.userExecute({ action: 'close-store', storeId: 'store-a' })
  expect(f.preferences.read('store-a')).toBeUndefined()
  f.preferences.enable('store-a', identity)
  await f.restore.userExecute({ action: 'remove-store', storeId: 'store-a' })
  expect(f.preferences.read('store-a')).toBeUndefined()
})

it('maintenance rebuild suppresses restoration for the instance including later login heartbeats', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  await f.restore.start({ restoreAi: false })
  await f.restore.start()
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.calls).toHaveLength(0)
  expect(f.preferences.read('store-a')).toEqual(identity)
})

it('off always stops actual AI even when saving the off choice fails', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.stores[0]!.aiEnabled = true
  vi.spyOn(f.preferences, 'disable').mockImplementation(() => {
    throw Error('disk full')
  })
  await expect(
    f.restore.userExecute({ action: 'set-ai', storeId: 'store-a', values: { enabled: false } }),
  ).rejects.toThrow('保存')
  expect(f.stores[0]!.aiEnabled).toBe(false)
  await f.restore.start()
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.stores[0]!.aiEnabled).toBe(false)
})
it('failed persistence after explicit enable rolls actual AI back off', async () => {
  const f = fixture()
  vi.spyOn(f.preferences, 'enable').mockImplementation(() => {
    throw Error('disk full')
  })
  await expect(
    f.restore.userExecute({ action: 'set-ai', storeId: 'store-a', values: { enabled: true } }),
  ).rejects.toThrow('保存')
  expect(f.stores[0]!.aiEnabled).toBe(false)
})

it('fresh identity must include matching mall and agent even when registry retains matching old IDs', async () => {
  for (const fresh of [
    undefined,
    { ...identity, mallId: 'different' },
    { ...identity, customerServiceId: '' },
  ]) {
    const f = fixture()
    f.preferences.enable('store-a', identity)
    f.verify(async () => fresh)
    await f.restore.start()
    expect(f.calls).toHaveLength(0)
  }
})
it('cancellation during fresh identity verification never reaches enable', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  let release!: (v: typeof identity) => void
  f.verify(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const starting = f.restore.start()
  await Promise.resolve()
  await f.restore.userExecute({ action: 'set-ai', storeId: 'store-a', values: { enabled: false } })
  release(identity)
  await starting
  expect(f.calls.some((c) => c.values?.enabled === true)).toBe(false)
})
it('retained registry identity with platform identity error is never restored', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  f.stores[0]!.runtime.identityError = 'identity incomplete'
  await f.restore.start()
  expect(f.calls).toHaveLength(0)
})

it('managed access returning rechecks still-open verified stores without requiring a platform heartbeat', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  await f.restore.start()
  f.allow(false)
  f.stores[0]!.aiEnabled = false
  f.allow(true)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  expect(f.stores[0]!.aiEnabled).toBe(true)
  expect(f.calls.filter((c) => c.values?.enabled === true)).toHaveLength(2)
  f.restore.accessChanged()
  for (let i = 0; i < 8; i++) await Promise.resolve()
  expect(f.calls.filter((c) => c.values?.enabled === true)).toHaveLength(2)
})

it('lifecycle stop invalidates identity verification without replaying on duplicate login heartbeat', async () => {
  const f = fixture()
  f.preferences.enable('store-a', identity)
  let release!: (v: typeof identity) => void
  f.verify(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const starting = f.restore.start()
  await Promise.resolve()
  f.restore.suspend()
  release(identity)
  await starting
  await f.restore.event({
    type: 'shop:login_state',
    storeId: 'store-a',
    authenticated: true,
    online: true,
  })
  expect(f.calls.some((c) => c.values?.enabled === true)).toBe(false)
})
