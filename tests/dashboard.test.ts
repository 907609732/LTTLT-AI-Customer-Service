import { describe, expect, it } from 'vitest'
import { emptySnapshot, type IntentPack, type LocalStore } from '../src/shared/contracts/backend'
import { buildDashboard, dashboardExport, periodBounds } from '../src/modules/shops/dashboard'

const now = new Date(2026, 10, 14, 12).getTime()
const store = (id: string, online = false, platform = 'pdd-web'): LocalStore => ({
  id,
  storeName: id,
  platform,
  group: '',
  aiEnabled: true,
  runtime: { online, open: online },
})
const pack = (values: Partial<IntentPack> = {}): IntentPack => ({
  id: 'p',
  version: 1,
  name: '知识',
  enabled: true,
  storeIds: ['a'],
  productIds: [],
  entries: [{ question: '问题', keywords: [], answer: '回答', enabled: true }],
  ...values,
})
function fixture() {
  const snapshot = emptySnapshot()
  snapshot.workspaceId = 'ready'
  snapshot.stores = [store('a', true), store('b'), store('sim', true, 'sim-local')]
  return snapshot
}
describe('dashboard real aggregates', () => {
  it('counts current stores and pending/handoff without treating unknown or future times as overdue', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      {
        storeId: 'a',
        uid: '1',
        name: 'private buyer',
        status: 'pending',
        messages: [{ from: 'buyer', content: 'private body', ts: now - 181000 }],
      },
      {
        storeId: 'a',
        uid: '2',
        name: '',
        status: 'pending',
        messages: [{ from: 'buyer', content: '', ts: now - 180000 }],
      },
      { storeId: 'b', uid: '3', name: '', status: 'handoff', messages: [] },
      {
        storeId: 'a',
        uid: '4',
        name: '',
        status: 'pending',
        messages: [{ from: 'buyer', content: '', ts: now + 1 }],
      },
      {
        storeId: 'a',
        uid: '5',
        name: '',
        status: 'pending',
        messages: [{ from: 'buyer', content: '', ts: 0 }],
      },
      {
        storeId: 'deleted',
        uid: '6',
        name: '',
        status: 'pending',
        messages: [{ from: 'buyer', content: '', ts: now - 999999 }],
      },
    ]
    const result = buildDashboard(snapshot, [pack()], 'today', now)
    expect(result.pending).toBe(4)
    expect(result.overdue).toBe(1)
    expect(result.handoff).toBe(1)
    expect(result.online).toBe(2)
    expect(result.aiOnline).toBe(2)
    expect(result.aiOffline).toBe(1)
    expect(result.simulated).toBe(1)
    expect(result.backlog.map((x) => x.storeId)).toEqual(['a', 'b'])
    expect(JSON.stringify(dashboardExport(result, 'today', now))).not.toMatch(
      /private body|private buyer/,
    )
  })
  it('coverage follows explicit store bindings and distinguishes product-only packs and failed reads', () => {
    const snapshot = fixture()
    const result = buildDashboard(
      snapshot,
      [
        pack({ storeIds: [] }),
        pack({ id: 'b', storeIds: ['b'], productIds: ['sku'] }),
        pack({ id: 'a', enabled: false }),
        pack({ id: 's', storeIds: ['sim'] }),
      ],
      'today',
      now,
    )
    expect(result.covered).toBe(1)
    expect(result.productOnly).toBe(1)
    expect(result.uncovered).toBe(2)
    expect(buildDashboard(snapshot, null, 'today', now).covered).toBeNull()
    expect(buildDashboard(snapshot, [pack({ entries: [] })], 'today', now).covered).toBe(0)
  })
  it('counts current open work orders and welcome configuration only for active stores', () => {
    const snapshot = fixture()
    const order = {
      id: '1',
      storeId: 'a',
      storeName: 'a',
      type: '售后',
      orderNo: '',
      buyer: '',
      priority: 'normal' as const,
      description: '',
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
      notes: [],
    }
    snapshot.workOrders = [
      order,
      { ...order, id: '2', storeId: 'deleted' },
      { ...order, id: '3', status: 'done' },
    ]
    snapshot.welcomeByStore = {
      a: { text: '欢迎', enabled: true, version: 1 },
      b: { text: '  ', enabled: true, version: 1 },
    }
    const result = buildDashboard(snapshot, [], 'today', now)
    expect(result.workOrders).toBe(1)
    expect(result.welcomeMissing).toBe(2)
    expect(result.offline).toBe(1)
  })
  it('filters local calendar periods without changing live metrics or claiming complete AI totals', () => {
    const snapshot = fixture()
    const midnight = new Date(2026, 10, 14).getTime()
    snapshot.conversations = [
      {
        storeId: 'a',
        uid: '1',
        name: '',
        status: 'pending',
        messages: [
          { from: 'buyer', content: '', ts: midnight },
          { from: 'seller', content: '', ts: midnight - 1 },
          { from: 'system', content: '', ts: now - 1 },
          { from: 'buyer', content: '', ts: now + 1 },
        ],
      },
    ]
    const today = buildDashboard(snapshot, [], 'today', now)
    const yesterday = buildDashboard(snapshot, [], 'yesterday', now)
    expect(today.period.buyerMessages).toBe(1)
    expect(today.period.sellerMessages).toBe(0)
    expect(yesterday.period.sellerMessages).toBe(1)
    expect(today.pending).toBe(yesterday.pending)
    expect(periodBounds('week', now)[0]).toBe(new Date(2026, 10, 8).getTime())
    expect(periodBounds('month', now)[0]).toBe(new Date(2026, 9, 16).getTime())
  })
  it('shows trial balance only for a current managed session and unexpired trial', () => {
    const snapshot = fixture()
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('不适用')
    snapshot.managed.active.mode = 'managed'
    snapshot.capabilities.modelMode = 'managed'
    snapshot.managed.session.status = 'signed_in'
    snapshot.managed.session.expiresAt = now / 1000 + 1000
    snapshot.managed.session.account = {
      userId: 1,
      displayName: '用户',
      trial: { remaining: 4, used: 1, reserved: 0, limit: 5, expiresAt: now / 1000 + 1000 },
    }
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('4')
    snapshot.managed.restartRequired = true
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('—')
    snapshot.managed.restartRequired = false
    snapshot.capabilities.modelMode = 'local'
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('—')
    snapshot.capabilities.modelMode = 'managed'
    snapshot.managed.session.expiresAt = now / 1000
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('—')
    snapshot.managed.session.expiresAt = now / 1000 + 1000
    snapshot.managed.session.status = 'offline'
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('—')
    snapshot.managed.session.status = 'signed_in'
    snapshot.managed.session.account.trial.expiresAt = now / 1000
    expect(buildDashboard(snapshot, [], 'today', now).quota.value).toBe('—')
  })
})
