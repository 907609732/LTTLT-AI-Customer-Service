import type { BackendSnapshot, IntentPack } from '@/shared/contracts/backend'
import { reportingSnapshotSchema } from '@/shared/contracts/reporting'

export type DashboardPeriod = 'today' | 'yesterday' | 'week' | 'month'
export const dashboardPeriods: { key: DashboardPeriod; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'week', label: '近7天' },
  { key: 'month', label: '近30天' },
]
export const dashboardScope =
  '仅统计当前工作区已采集记录：最多200个会话、每会话100条消息，非完整经营报表；模拟店铺单独标记。'

/** 日历边界使用本地时区，昨天不包含今天；区间右端不包含。 */
export function periodBounds(period: DashboardPeriod, now: number): [number, number] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  if (period === 'yesterday') start.setDate(start.getDate() - 1)
  else {
    start.setDate(start.getDate() - (period === 'week' ? 6 : period === 'month' ? 29 : 0))
    end.setDate(end.getDate() + 1)
  }
  return [start.getTime(), end.getTime()]
}

function quota(snapshot: BackendSnapshot, now: number) {
  if (
    snapshot.managed.restartRequired ||
    snapshot.managed.active.mode !== snapshot.capabilities.modelMode
  )
    return { value: '—', note: '模型来源切换待重启，额度暂不可用' }
  if (snapshot.managed.active.mode === 'local')
    return { value: '不适用', note: '本机 Key · 费用由模型服务商结算' }
  const session = snapshot.managed.session
  const trial = session.account?.trial
  // 托管契约的 session/trial 到期时间均为 Unix 秒，快照消息时间为毫秒。
  if (session.status !== 'signed_in' || !session.expiresAt || session.expiresAt <= now / 1000)
    return { value: '—', note: '托管账号未登录或会话失效，需重新验证' }
  if (!trial || trial.expiresAt <= now / 1000)
    return { value: '—', note: '托管试用已到期，暂无有效额度' }
  return { value: String(trial.remaining), note: '托管试用剩余额度 · 以账号服务返回为准' }
}

/** 快照是有界本机记录，不用引擎累计值冒充完整日统计。 */
export function buildDashboard(
  snapshot: BackendSnapshot,
  packs: IntentPack[] | null,
  period: DashboardPeriod,
  now: number,
) {
  const stores = snapshot.stores
  const storeIds = new Set(stores.map((s) => s.id))
  const conversations = snapshot.conversations.filter((c) => storeIds.has(c.storeId))
  const pending = conversations.filter((c) => c.status === 'pending')
  const isOverdue = (conversation: (typeof conversations)[number]) => {
    const times = conversation.messages
      .filter((m) => m.from === 'buyer' && Number.isFinite(m.ts) && m.ts > 0)
      .map((m) => m.ts)
    const latest = Math.max(0, ...times)
    return conversation.status === 'pending' && latest > 0 && latest <= now && now - latest > 180000
  }
  const enabledPacks = packs?.filter(
    (p) => p.enabled && p.entries.some((e) => e.enabled && e.question.trim() && e.answer.trim()),
  )
  const coveredIds = enabledPacks
    ? new Set(
        stores
          .filter((s) =>
            enabledPacks.some((p) => p.storeIds.includes(s.id) && !p.productIds.length),
          )
          .map((s) => s.id),
      )
    : null
  const productOnly = enabledPacks
    ? stores.filter(
        (s) =>
          !coveredIds?.has(s.id) &&
          enabledPacks.some((p) => p.storeIds.includes(s.id) && p.productIds.length > 0),
      ).length
    : null
  const [start, end] = periodBounds(period, now)
  const reporting = reportingSnapshotSchema.safeParse(Reflect.get(snapshot, 'reporting'))
  const report = reporting.success ? reporting.data[period] : null
  const realStores = stores.filter((store) => store.platform !== 'sim-local')
  const aftersaleSources = reporting.success
    ? reporting.data.aftersales.filter((source) =>
        realStores.some(
          (store) => store.id === source.storeId && store.platform === source.platform,
        ),
      )
    : []
  const aftersaleComplete =
    realStores.length > 0 &&
    realStores.every((store) =>
      aftersaleSources.some(
        (source) => source.storeId === store.id && source.complete && source.total !== null,
      ),
    )
  let buyerMessages = 0,
    sellerMessages = 0,
    activeConversations = 0
  for (const conversation of conversations) {
    const messages = conversation.messages.filter(
      (m) => Number.isFinite(m.ts) && m.ts > 0 && m.ts >= start && m.ts < end && m.ts <= now,
    )
    buyerMessages += messages.filter((m) => m.from === 'buyer').length
    sellerMessages += messages.filter((m) => m.from === 'seller').length
    if (messages.some((m) => m.from === 'buyer' || m.from === 'seller')) activeConversations++
  }
  const backlog = stores
    .map((s) => {
      const rows = conversations.filter((c) => c.storeId === s.id)
      return {
        storeId: s.id,
        name: s.storeName,
        simulated: s.platform === 'sim-local',
        pending: rows.filter((c) => c.status === 'pending').length,
        overdue: rows.filter(isOverdue).length,
        handoff: rows.filter((c) => c.status === 'handoff').length,
      }
    })
    .filter((s) => s.pending + s.handoff > 0)
    .sort((a, b) => b.overdue - a.overdue || b.pending - a.pending)
  return {
    total: stores.length,
    online: stores.filter((s) => s.runtime.online).length,
    offline: stores.filter((s) => !s.runtime.online).length,
    aiOnline: stores.filter((s) => s.runtime.online && s.aiEnabled).length,
    aiOffline: stores.filter((s) => !s.runtime.online && s.aiEnabled).length,
    simulated: stores.filter((s) => s.platform === 'sim-local').length,
    pending: pending.length,
    overdue: conversations.filter(isOverdue).length,
    handoff: conversations.filter((c) => c.status === 'handoff').length,
    workOrders: snapshot.workOrders.filter((w) => storeIds.has(w.storeId) && w.status !== 'done')
      .length,
    covered: coveredIds?.size ?? null,
    uncovered: coveredIds ? stores.length - coveredIds.size : null,
    productOnly,
    welcomeMissing: stores.filter(
      (s) => !snapshot.welcomeByStore[s.id]?.enabled || !snapshot.welcomeByStore[s.id]?.text.trim(),
    ).length,
    quota: quota(snapshot, now),
    backlog,
    targets: {
      pending: pending[0]?.storeId,
      overdue: conversations.find(isOverdue)?.storeId,
      handoff: conversations.find((c) => c.status === 'handoff')?.storeId,
      workorder: snapshot.workOrders.find((w) => storeIds.has(w.storeId) && w.status !== 'done')
        ?.storeId,
      offline: stores.find((s) => !s.runtime.online)?.id,
      intent: coveredIds ? stores.find((s) => !coveredIds.has(s.id))?.id : undefined,
      welcome: stores.find(
        (s) =>
          !snapshot.welcomeByStore[s.id]?.enabled || !snapshot.welcomeByStore[s.id]?.text.trim(),
      )?.id,
    },
    products: snapshot.products.total,
    report,
    aftersales: {
      total: aftersaleComplete
        ? aftersaleSources.reduce((sum, source) => sum + (source.total ?? 0), 0)
        : null,
      sources: aftersaleSources,
      complete: aftersaleComplete,
      scopeNote:
        aftersaleSources.length > 0 &&
        aftersaleSources.every((source) => source.queryWindow === 'last-3-months')
          ? '近3个月内待商家处理'
          : '待商家处理（查询时段未提供）',
    },
    period: { buyerMessages, sellerMessages, activeConversations },
  }
}
export type DashboardSummary = ReturnType<typeof buildDashboard>

/** 只导出汇总，不携带买家名称、正文、账号资料或凭据。 */
export function dashboardExport(summary: DashboardSummary, period: DashboardPeriod, now: number) {
  return {
    exportedAt: new Date(now).toISOString(),
    period: dashboardPeriods.find((p) => p.key === period)?.label,
    scope: dashboardScope,
    live: {
      pending: summary.pending,
      overdue: summary.overdue,
      handoff: summary.handoff,
      workOrders: summary.workOrders,
    },
    stores: {
      total: summary.total,
      online: summary.online,
      aiOnline: summary.aiOnline,
      simulated: summary.simulated,
      intentCovered: summary.covered,
      welcomeMissing: summary.welcomeMissing,
    },
    periodRecords: summary.period,
    observedEvents: summary.report,
    platformBusiness: {
      orders: { status: 'unavailable', count: null, revenue: null, reason: '未接入平台订单接口' },
      aftersales: summary.aftersales,
    },
    quota: summary.quota,
    unavailable: [
      ...(summary.aftersales.complete ? [] : ['平台售后']),
      '完整周期 AI 回复统计',
      '平台订单与营收',
    ],
  }
}
