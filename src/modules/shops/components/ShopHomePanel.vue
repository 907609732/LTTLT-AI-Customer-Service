<script setup lang="ts">
import { computed, ref } from 'vue'
import PlatformOrderPanel from './PlatformOrderPanel.vue'
import { useRouter } from 'vue-router'
import { dashboardPeriods, dashboardScope } from '../dashboard'
import { useDashboard } from '../use-dashboard'
import '../dashboard.css'

const router = useRouter()
const showingOrders = ref(false)
const {
  runtime,
  period,
  ready,
  workspaceAccessible,
  accessMessage,
  summary,
  busy,
  errors,
  intentError,
  intentReadAt,
  snapshotReadAt,
  refresh,
  exportSummary,
} = useDashboard()
const display = (value: number) => (ready.value ? String(value) : '—')
const coverage = computed(() =>
  ready.value && summary.value.covered !== null
    ? `${summary.value.covered}/${summary.value.total}`
    : '—',
)
const coverageNote = computed(() => {
  if (!ready.value) return '未连接本机数据'
  if (intentError.value) return intentReadAt.value ? '上次读取 · 刷新失败' : '读取失败 · 请重试'
  if (summary.value.covered === null) return '正在读取意图包'
  return `${summary.value.uncovered} 店未获整店覆盖${summary.value.productOnly ? `，其中 ${summary.value.productOnly} 店仅绑定部分商品` : ''}`
})
const status = computed(() => {
  if (!runtime.available) return '界面预览'
  if (!workspaceAccessible.value) return '工作区不可用'
  if (errors.value) return '部分数据读取失败'
  if (!ready.value || busy.value) return '正在读取'
  const s = summary.value
  return s.pending + s.handoff + s.workOrders + s.offline + (s.uncovered ?? 0) + s.welcomeMissing >
    0
    ? '有待办'
    : '数据已更新'
})
const updated = computed(() =>
  snapshotReadAt.value
    ? new Date(snapshotReadAt.value).toLocaleTimeString('zh-CN', { hour12: false })
    : '尚未更新',
)
const metrics = computed(() => [
  {
    key: 'pending',
    label: '待回复',
    icon: '回',
    value: display(summary.value.pending),
    note: '已采集待回会话 · 去处理',
    tone: 'green',
    panel: 'assist',
  },
  {
    key: 'overdue',
    label: '超时未回',
    icon: '超',
    value: display(summary.value.overdue),
    note: '最新买家消息超过 3 分钟',
    tone: 'gold',
    panel: 'assist',
  },
  {
    key: 'handoff',
    label: '转人工预警',
    icon: '预',
    value: display(summary.value.handoff),
    note: '本机待人工处理 · 非平台转接',
    tone: 'gold',
    panel: 'assist',
  },
  {
    key: 'workorder',
    label: '待处理工单',
    icon: '单',
    value: display(summary.value.workOrders),
    note: '未完成本机工单 · 去处理',
    tone: 'blue',
    panel: 'workorder',
  },
  {
    key: 'aftersale',
    label: '待处理售后',
    icon: '售',
    value:
      ready.value && summary.value.aftersales.total !== null
        ? String(summary.value.aftersales.total)
        : '—',
    note: summary.value.aftersales.complete
      ? `${summary.value.aftersales.scopeNote} · 非周期新增`
      : summary.value.aftersales.sources.length
        ? '部分店铺采集不完整 · 请查看辅助中心'
        : '未接入平台售后数据',
    tone: 'cyan',
    panel: '',
  },
])
const risks = computed(() => [
  {
    key: 'offline',
    label: '店铺未连接接待',
    value: display(summary.value.offline),
    action: '去登录',
    panel: 'shops',
  },
  {
    key: 'intent',
    label: '未获整店意图覆盖',
    value: ready.value && summary.value.uncovered !== null ? String(summary.value.uncovered) : '—',
    action: '去绑定',
    panel: 'intent',
  },
  {
    key: 'welcome',
    label: '进店欢迎未开启',
    value: display(summary.value.welcomeMissing),
    action: '去配置',
    panel: 'welcome',
  },
])
function navigate(panel: string) {
  if (panel === 'assist') void router.push('/float/assist')
  else if (panel) void router.push({ path: '/shop/manage', query: { panel } })
}
function processStore(storeId: string) {
  runtime.selectedStoreId = storeId
  navigate('assist')
}
function navigateMetric(key: string, panel: string) {
  const storeId = summary.value.targets[key as keyof typeof summary.value.targets]
  if (storeId) runtime.selectedStoreId = storeId
  navigate(panel)
}
</script>

<template>
  <PlatformOrderPanel v-if="showingOrders" @back="showingOrders = false" />
  <section v-else class="shop-dashboard" aria-label="数据看板">
    <header class="shop-dashboard__hero">
      <div class="shop-dashboard__heading">
        <div class="shop-dashboard__title">
          <h1>数据看板</h1>
          <span
            class="shop-dashboard__status"
            :class="{ 'is-warning': errors || status === '有待办', 'is-neutral': !ready }"
            >{{ status }}</span
          >
        </div>
        <p>今日 AI 已回 <span>—</span> <small>完整日统计未接入</small></p>
      </div>
      <div class="shop-dashboard__tools">
        <button type="button" @click="showingOrders = true">平台订单</button>
        <div class="shop-dashboard__periods" aria-label="统计周期">
          <button
            v-for="option in dashboardPeriods"
            :key="option.key"
            type="button"
            :data-period="option.key"
            :aria-pressed="period === option.key"
            :class="{ 'is-active': period === option.key }"
            @click="period = option.key"
          >
            {{ option.label }}
          </button>
        </div>
        <span class="shop-dashboard__updated"
          >{{ updated }} <template v-if="snapshotReadAt">更新</template></span
        >
        <button
          type="button"
          data-action="refresh"
          :disabled="busy || !runtime.available"
          @click="refresh"
        >
          {{ busy ? '读取中…' : '刷新' }}
        </button>
        <button
          type="button"
          data-action="export"
          :disabled="!ready || busy"
          @click="exportSummary"
        >
          导出
        </button>
        <button type="button" class="shop-dashboard__assist" @click="navigate('assist')">
          辅助中心
        </button>
      </div>
    </header>
    <div v-if="!runtime.available" class="shop-dashboard__notice" role="status">
      界面预览 · 未连接本机数据，请在桌面版查看真实记录。
    </div>
    <div v-else-if="!workspaceAccessible" class="shop-dashboard__notice" role="status">
      {{ accessMessage }}
    </div>
    <div v-else-if="!ready && !errors" class="shop-dashboard__notice" role="status">
      正在连接本机工作区，尚无可用数据。
    </div>
    <div v-if="errors" class="shop-dashboard__notice is-error" role="alert">
      部分数据读取失败：{{ errors }}。已读取的值可能为上次数据，请刷新重试。
    </div>
    <div class="shop-dashboard__body">
      <section aria-label="实时值守">
        <div class="shop-dashboard__section-title">
          <h2>实时值守</h2>
          <span>当前待回 / 超时 / 预警，点击直接处理</span>
        </div>
        <div class="shop-dashboard__live">
          <button
            v-for="metric in metrics"
            :key="metric.key"
            type="button"
            :data-metric="metric.key"
            class="shop-dashboard__metric"
            :class="`tone-${metric.tone}`"
            :disabled="!metric.panel || !ready"
            @click="navigateMetric(metric.key, metric.panel)"
          >
            <span class="shop-dashboard__metric-icon" aria-hidden="true">{{ metric.icon }}</span>
            <span class="shop-dashboard__metric-main"
              ><strong :class="{ 'is-unknown': metric.value === '—' }">{{ metric.value }}</strong
              ><b>{{ metric.label }}</b
              ><small>{{ metric.note }}</small></span
            >
          </button>
        </div>
      </section>
      <section class="shop-dashboard__overview" aria-label="接待概况">
        <article class="shop-dashboard__overview-card" data-metric="online">
          <h3>接待在线</h3>
          <strong>{{ ready ? `${summary.online}/${summary.total}` : '—' }}</strong>
          <p>
            {{ ready ? `${summary.offline} 店未连接` : '未连接本机数据'
            }}<template v-if="ready && summary.simulated">
              · 含 {{ summary.simulated }} 个模拟店</template
            >
          </p>
        </article>
        <article class="shop-dashboard__overview-card" data-metric="ai">
          <h3>AI 已开启</h3>
          <strong>{{ ready ? `${summary.aiOnline}/${summary.online}` : '—' }}</strong>
          <p>
            在线店铺 · 回复仍需逐条确认<template v-if="ready && summary.aiOffline"
              >；{{ summary.aiOffline }} 店离线开启</template
            >
          </p>
        </article>
        <article class="shop-dashboard__overview-card" data-metric="coverage">
          <h3>意图包覆盖</h3>
          <strong>{{ coverage }}</strong>
          <p>{{ coverageNote }}</p>
        </article>
        <article class="shop-dashboard__overview-card is-quota" data-metric="quota">
          <h3>套餐余量</h3>
          <strong :class="{ 'is-text': summary.quota.value === '不适用' }">{{
            ready ? summary.quota.value : '—'
          }}</strong>
          <p>{{ ready ? summary.quota.note : '未连接账号数据' }}</p>
        </article>
      </section>
      <div class="shop-dashboard__columns">
        <section class="shop-dashboard__panel" aria-label="待回积压店铺">
          <header>
            <h2>待回积压店铺</h2>
            <span>实时 · 仅显示有待办的店</span>
          </header>
          <div v-if="!ready" class="shop-dashboard__empty">未连接本机数据</div>
          <div v-else-if="!summary.backlog.length" class="shop-dashboard__empty">
            当前已采集会话中暂无积压待回。
          </div>
          <ul v-else class="shop-dashboard__backlog">
            <li v-for="store in summary.backlog" :key="store.storeId">
              <div>
                <b :title="store.name">{{ store.name }}<em v-if="store.simulated">本机模拟</em></b
                ><small
                  >待回 {{ store.pending }} · 超时 {{ store.overdue }} · 待人工
                  {{ store.handoff }}</small
                >
              </div>
              <button
                type="button"
                :data-backlog="store.storeId"
                @click="processStore(store.storeId)"
              >
                去处理
              </button>
            </li>
          </ul>
        </section>
        <section class="shop-dashboard__panel" aria-label="风险待办">
          <header>
            <h2>风险待办</h2>
            <span>点击跳转处理</span>
          </header>
          <ul class="shop-dashboard__risks">
            <li v-for="risk in risks" :key="risk.key">
              <span>{{ risk.label }}</span
              ><strong>{{ risk.value }}</strong
              ><button
                type="button"
                :data-risk="risk.key"
                :disabled="!ready"
                @click="navigateMetric(risk.key, risk.panel)"
              >
                {{ risk.action }}
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
    <section class="shop-dashboard__period-panel" aria-label="周期采集统计">
      <div class="shop-dashboard__section-title">
        <h2>周期采集统计</h2>
        <span
          >{{ dashboardPeriods.find((option) => option.key === period)?.label }} ·
          仅统计已采集记录，非完整经营报表</span
        >
      </div>
      <div class="shop-dashboard__period-grid">
        <article>
          <h3>买家消息</h3>
          <strong>{{ display(summary.period.buyerMessages) }}</strong>
        </article>
        <article>
          <h3>客服消息</h3>
          <strong>{{ display(summary.period.sellerMessages) }}</strong>
        </article>
        <article>
          <h3>有消息的会话</h3>
          <strong>{{ display(summary.period.activeConversations) }}</strong>
        </article>
        <article>
          <h3>已观测 AI 确认发送</h3>
          <strong :class="{ 'is-unknown': !ready || !summary.report }">{{
            ready && summary.report ? summary.report.real['ai-sent'] : '—'
          }}</strong>
          <small v-if="!ready">当前工作区不可用</small>
          <small v-else-if="!summary.report">持久化统计未接入</small>
          <small v-else-if="summary.report.persistence === 'error'"
            >统计保存失败 · 历史可能不完整</small
          >
          <small v-else>真实平台 · 模拟 {{ summary.report.simulated['ai-sent'] }} 条另计</small>
        </article>
      </div>
      <p class="shop-dashboard__scope">
        {{ dashboardScope }} 日期仅影响本区，实时值守不受影响。客服消息包含人工回复，不能视为 AI
        回复。
      </p>
      <p v-if="ready && summary.report" class="shop-dashboard__scope" data-report-scope>
        事件统计自
        {{ new Date(summary.report.observedSince).toLocaleString('zh-CN') }}
        启用，保留近30个本地日； 不补采离线历史，不代表平台完整数据。 已观测 AI 生成
        {{ summary.report.real['ai-generated'] }} 次、生成失败
        {{ summary.report.real['ai-failed'] }} 次， 新建本机工单
        {{ summary.report.real['work-order-created'] }} 件（非平台订单或售后）。
        {{ summary.report.truncated ? '已触及20万条保留上限，统计存在缺口。' : '' }}
      </p>
    </section>
  </section>
</template>
