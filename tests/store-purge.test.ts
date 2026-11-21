import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import {
  parseRemoveStoreValues,
  sanitizeVendorStoreData,
  StorePurgeJournal,
  storeRegistered,
  resumeStorePurges,
  type StorePurgePorts,
} from '../electron/store-purge'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-purge-'))
  dirs.push(dir)
  return dir
}
const write = (dir: string, name: string, value: unknown) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
}
const read = (dir: string, name: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

it('strips only store A from mixed vendor files and leaves global/other-store/backups intact', () => {
  const dir = fixture()
  write(dir, 'stores.json', {
    stores: [
      { id: 'a', storeName: 'A' },
      { id: 'b', storeName: 'B' },
    ],
  })
  write(dir, 'conversations.json', [
    { storeId: 'a', uid: 'u1', messages: [] },
    { storeId: 'b', uid: 'u2', messages: [] },
  ])
  write(dir, 'store-handoff.json', {
    version: 1,
    stores: { a: { keywords: ['a'] }, b: { keywords: ['b'] } },
  })
  write(dir, 'store-welcome.json', {
    version: 2,
    stores: { a: { text: 'A', enabled: true }, b: { text: 'B', enabled: true } },
    seen: [
      { storeId: 'a', uid: 'u1', firstTs: 1, eligible: true, attempted: false },
      { storeId: 'b', uid: 'u2', firstTs: 1, eligible: true, attempted: false },
    ],
  })
  write(dir, 'store-vision.json', {
    version: 1,
    stores: { a: { enabled: true, version: 1 }, b: {} },
  })
  write(dir, 'model-profiles.json', {
    version: 1,
    revision: 1,
    profiles: [{ id: 'p', name: 'P' }],
    bindings: { a: 'p', b: 'p' },
  })
  write(dir, 'work-orders.json', {
    version: 1,
    orders: [
      { storeId: 'a', id: 'a1' },
      { storeId: 'b', id: 'b1' },
    ],
  })
  write(dir, 'conversation-quality.json', {
    version: 1,
    rows: [
      { storeId: 'a', uid: 'u1' },
      { storeId: 'b', uid: 'u2' },
    ],
  })
  write(dir, 'auxiliary-state.json', {
    version: 1,
    screen: 'UX26',
    selected: { storeId: 'a', uid: 'u1' },
    drafts: [
      { storeId: 'a', uid: 'u1', text: 'a' },
      { storeId: 'b', uid: 'u2', text: 'b' },
    ],
    hidden: [{ storeId: 'a', uid: 'u1', updatedAt: 1 }],
    scroll: { UX26: 4 },
    workOrderId: 'a1',
    workOrderSelection: 0,
    filterStore: 'a',
  })
  write(dir, 'product-knowledge.json', {
    version: 1,
    revision: 1,
    items: [
      { storeId: 'a', productId: 'a1' },
      { storeId: 'b', productId: 'b1' },
    ],
  })
  write(dir, 'intent-knowledge.json', {
    version: 1,
    revision: 1,
    packs: [
      { id: 'both', storeIds: ['a', 'b'] },
      { id: 'a-only', storeIds: ['a'] },
      { id: 'b-only', storeIds: ['b'] },
    ],
  })
  write(dir, 'platform-learning.json', {
    version: 1,
    tasks: [
      { id: 'a-task', identity: { storeId: 'a' } },
      { id: 'b-task', identity: { storeId: 'b' } },
    ],
    candidates: [
      { id: 'a-candidate', identity: { storeId: 'a' } },
      { id: 'b-candidate', identity: { storeId: 'b' } },
    ],
  })
  write(dir, 'simulator-stores.json', {
    version: 1,
    stores: { a: { storeName: 'A' }, b: { storeName: 'B' } },
  })
  write(dir, 'secrets.json', { encrypted: true })
  write(dir, 'config.json', { ai: { model: 'global' } })
  write(dir, 'store-sync-backups/00000000-0000-4000-8000-000000000000.json', {})
  write(dir, `removed-stores/${encodeURIComponent('a')}.json`, { store: { id: 'a' } })
  write(dir, `removed-stores/${encodeURIComponent('b')}.json`, { store: { id: 'b' } })
  write(dir, `custom-phrases/${hash('a')}.json`, { rows: [] })
  write(dir, `custom-phrases/${hash('b')}.json`, { rows: [] })
  write(dir, `platform-orders/${hash('a')}.json`, { report: { storeId: 'a' } })
  write(dir, `platform-orders/${hash('b')}.json`, { report: { storeId: 'b' } })
  write(dir, `platform-products/${hash('a')}.json`, { items: [] })
  write(dir, `platform-products/${hash('b')}.json`, { items: [] })

  sanitizeVendorStoreData(dir, 'a')

  expect(read(dir, 'stores.json').stores).toEqual([{ id: 'b', storeName: 'B' }])
  expect(read(dir, 'conversations.json')).toEqual([{ storeId: 'b', uid: 'u2', messages: [] }])
  expect(read(dir, 'store-handoff.json').stores).toEqual({ b: { keywords: ['b'] } })
  expect(read(dir, 'store-welcome.json').stores).toEqual({ b: { text: 'B', enabled: true } })
  expect(read(dir, 'store-welcome.json').seen).toEqual([
    { storeId: 'b', uid: 'u2', firstTs: 1, eligible: true, attempted: false },
  ])
  expect(read(dir, 'store-vision.json').stores).toEqual({ b: {} })
  expect(read(dir, 'model-profiles.json').bindings).toEqual({ b: 'p' })
  expect(read(dir, 'work-orders.json').orders).toEqual([{ storeId: 'b', id: 'b1' }])
  expect(read(dir, 'conversation-quality.json').rows).toEqual([{ storeId: 'b', uid: 'u2' }])
  expect(read(dir, 'auxiliary-state.json')).toMatchObject({
    selected: null,
    drafts: [{ storeId: 'b', uid: 'u2', text: 'b' }],
    hidden: [],
    filterStore: '',
    workOrderId: '',
  })
  expect(read(dir, 'product-knowledge.json').items).toEqual([{ storeId: 'b', productId: 'b1' }])
  expect(read(dir, 'intent-knowledge.json').packs).toEqual([
    { id: 'both', storeIds: ['b'] },
    { id: 'b-only', storeIds: ['b'] },
  ])
  expect(read(dir, 'platform-learning.json').tasks).toEqual([
    { id: 'b-task', identity: { storeId: 'b' } },
  ])
  expect(read(dir, 'platform-learning.json').candidates).toEqual([
    { id: 'b-candidate', identity: { storeId: 'b' } },
  ])
  expect(read(dir, 'simulator-stores.json').stores).toEqual({ b: { storeName: 'B' } })
  expect(read(dir, 'secrets.json')).toEqual({ encrypted: true })
  expect(read(dir, 'config.json')).toEqual({ ai: { model: 'global' } })
  expect(fs.existsSync(path.join(dir, `removed-stores/${encodeURIComponent('a')}.json`))).toBe(
    false,
  )
  expect(fs.existsSync(path.join(dir, `removed-stores/${encodeURIComponent('b')}.json`))).toBe(true)
  expect(fs.existsSync(path.join(dir, `custom-phrases/${hash('a')}.json`))).toBe(false)
  expect(fs.existsSync(path.join(dir, `custom-phrases/${hash('b')}.json`))).toBe(true)
  expect(fs.existsSync(path.join(dir, `platform-orders/${hash('a')}.json`))).toBe(false)
  expect(fs.existsSync(path.join(dir, `platform-orders/${hash('b')}.json`))).toBe(true)
  expect(fs.existsSync(path.join(dir, `platform-products/${hash('a')}.json`))).toBe(false)
  expect(fs.existsSync(path.join(dir, `platform-products/${hash('b')}.json`))).toBe(true)
  expect(
    fs.existsSync(
      path.join(dir, 'store-sync-backups', '00000000-0000-4000-8000-000000000000.json'),
    ),
  ).toBe(true)
})

it('refuses purge without explicit confirmation and rejects non-boolean purge', () => {
  expect(() => parseRemoveStoreValues({})).toThrow(/确认/)
  expect(() => parseRemoveStoreValues({ confirmed: true, purge: 'yes' })).toThrow(/无效/)
  expect(parseRemoveStoreValues({ confirmed: true })).toEqual({ purge: false })
  expect(parseRemoveStoreValues({ confirmed: true, purge: true })).toEqual({ purge: true })
})

it('does not purge a planned journal while the store still exists; resumes after vendor removal', async () => {
  const dir = fixture()
  write(dir, 'stores.json', { stores: [{ id: 'a' }, { id: 'b' }] })
  const journal = StorePurgeJournal.begin(dir, 'a')
  expect(journal.removalConfirmed).toBe(false)
  expect(storeRegistered(dir, 'a')).toBe(true)
  let purged = 0
  const ports = {
    dataDir: dir,
    knowledge: {
      async purgeStore() {
        purged++
        return {}
      },
    },
  } satisfies StorePurgePorts
  await resumeStorePurges(ports)
  expect(purged).toBe(0)
  expect(StorePurgeJournal.all(dir)).toHaveLength(0)

  write(dir, 'stores.json', { stores: [{ id: 'b' }] })
  const next = StorePurgeJournal.begin(dir, 'a')
  next.confirmRemoval()
  await resumeStorePurges(ports)
  expect(purged).toBe(1)
  expect(StorePurgeJournal.all(dir)[0]?.state).toBe('completed')
})

it('does not sanitize or purge a restored store that reuses the old id', async () => {
  const dir = fixture()
  write(dir, 'stores.json', { stores: [{ id: 'a' }, { id: 'b' }] })
  write(dir, `removed-stores/${encodeURIComponent('a')}.json`, { store: { id: 'a' } })
  const journal = StorePurgeJournal.begin(dir, 'a')
  journal.confirmRemoval()
  journal.complete()
  await resumeStorePurges({
    dataDir: dir,
    knowledge: {
      async purgeStore() {
        throw new Error('must not purge')
      },
    },
  })
  expect(fs.existsSync(path.join(dir, `removed-stores/${encodeURIComponent('a')}.json`))).toBe(true)
  expect(StorePurgeJournal.all(dir)).toHaveLength(0)
})

it('keeps failed purge state and retries the remaining idempotent steps', async () => {
  const dir = fixture()
  write(dir, 'stores.json', { stores: [{ id: 'b' }] })
  const journal = StorePurgeJournal.begin(dir, 'a')
  journal.confirmRemoval()
  let fail = true
  let attempts = 0
  const ports = {
    dataDir: dir,
    knowledge: {
      async purgeStore() {
        attempts++
        if (fail) throw new Error('disk busy')
        return {}
      },
    },
  } satisfies StorePurgePorts
  await expect(
    import('../electron/store-purge').then(({ executeStorePurge }) =>
      executeStorePurge(journal, ports),
    ),
  ).rejects.toThrow(/未全部删除/)
  expect(StorePurgeJournal.all(dir)[0]?.state).toBe('failed')
  fail = false
  await resumeStorePurges(ports)
  expect(attempts).toBe(2)
  expect(StorePurgeJournal.all(dir)[0]?.state).toBe('completed')
})
