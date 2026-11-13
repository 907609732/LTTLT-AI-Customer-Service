<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Conversation } from '@/shared/contracts/backend'
import { SIM_PLATFORM_LABEL, type SimulatorStatus } from '@/shared/contracts/simulation'
import { useRuntimeStore } from '@/shared/state/runtime'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useTask } from '@/shared/ui/use-task'
import {
  listSimStores,
  openSimulatorPage,
  readSimulatorStatus,
  simulatorSupport,
} from '../services/simulator'

/**
 * 本机模拟客服台。
 *
 * 数据全部来自本地运行时快照（snapshot.conversations 里 platform = sim-local 的店铺），
 * 页面只负责展示与提交候选回复：
 * - 这里没有真实平台登录、也没有真实买家，界面文案不能暗示“真实平台已送达”；
 * - 发送必须经主进程统一确认门，只有 confirmed === true 才算受理，失败保留草稿；
 * - 模拟服务是否在跑由主进程回答，读不到就如实显示“未启动 + 原因”，不伪造在线。
 */
const runtime = useRuntimeStore()
const task = useTask()
const router = useRouter()
const support = simulatorSupport()

const simStores = computed(() => listSimStores(runtime.snapshot.stores))
const store = computed(() => {
  const id = runtime.selectedStoreId
  return simStores.value.find((item) => item.id === id)
})

/** 只在模拟店铺之间切换；切到别的店铺会让客服台失去上下文。 */
const selectedId = computed({
  get: () => store.value?.id ?? '',
  set: (id: string) => {
    runtime.selectedStoreId = id
  },
})

const openBadge = computed<{ text: string; tone: 'success' | 'info' | 'warning' }>(() => {
  const row = store.value
  if (!row) return { text: '未选择店铺', tone: 'info' }
  if (!row.runtime.open) return { text: '未打开', tone: 'info' }
  return row.runtime.online
    ? { text: '已打开 · 在线', tone: 'success' }
    : { text: '已打开 · 未在线', tone: 'warning' }
})
const canOpenStore = computed(
  () => Boolean(store.value) && !store.value?.runtime.open && !task.pending.value,
)

/** 会话列表按最后一条消息时间倒序，最近有人在等的排在最上面。 */
function lastAt(row: Conversation): number {
  const last = row.messages[row.messages.length - 1]
  if (typeof row.updatedAt === 'number' && row.updatedAt > 0) return row.updatedAt
  return last && Number.isFinite(last.ts) ? last.ts : 0
}
const conversations = computed<Conversation[]>(() => {
  const id = store.value?.id
  if (!id) return []
  return runtime.snapshot.conversations
    .filter((row) => row.storeId === id)
    .slice()
    .sort((a, b) => lastAt(b) - lastAt(a))
})

const keyOf = (storeId: string, uid: string) => JSON.stringify([storeId, uid])
const chosen = ref('')
const text = ref('')
/** 草稿只留在本页内存：会话一切换就先存下来，发送确认后才丢弃。 */
const drafts = new Map<string, string>()
const current = computed(() =>
  conversations.value.find((row) => keyOf(row.storeId, row.uid) === chosen.value),
)

// 有模拟店铺但没有选中时，自动落到第一家，避免页面停在“未选择”的死状态。
watch(
  simStores,
  (stores) => {
    if (!stores.length) return
    if (stores.some((item) => item.id === runtime.selectedStoreId)) return
    const first = stores[0]
    if (first) runtime.selectedStoreId = first.id
  },
  { immediate: true },
)

watch(
  () => store.value?.id,
  (id) => {
    if (current.value) drafts.set(keyOf(current.value.storeId, current.value.uid), text.value)
    chosen.value = ''
    text.value = ''
    const selection = runtime.snapshot.selection
    if (!id || selection.storeId !== id) return
    const match = conversations.value.find((row) => row.uid === selection.conversationId)
    if (!match) return
    chosen.value = keyOf(match.storeId, match.uid)
    text.value = drafts.get(chosen.value) ?? ''
  },
)

async function select(row: Conversation) {
  const target = keyOf(row.storeId, row.uid)
  if (chosen.value === target) return
  const ok = await task.run(async () => {
    await runtime.run({
      action: 'select-conversation',
      storeId: row.storeId,
      conversationId: row.uid,
    })
  })
  if (!ok) return
  if (current.value) drafts.set(keyOf(current.value.storeId, current.value.uid), text.value)
  chosen.value = target
  text.value =
    drafts.get(target) ??
    runtime.snapshot.auxiliary.drafts.find(
      (draft) => draft.storeId === row.storeId && draft.uid === row.uid,
    )?.text ??
    ''
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待回复',
  replied: '已回复',
  handoff: '已转人工',
}
const statusLabel = (status: string) => STATUS_LABELS[status] ?? status
const statusTone = (status: string) =>
  status === 'pending' ? 'is-pending' : status === 'replied' ? 'is-replied' : 'is-other'

function whoLabel(from: string): string {
  return from === 'buyer' ? '顾客' : from === 'seller' ? '客服' : '系统'
}

function summary(row: Conversation): string {
  const last = row.messages[row.messages.length - 1]
  if (!last) return '暂无消息'
  const body = last.type === 'image' ? `[图片] ${last.content}` : last.content
  return `${whoLabel(last.from)}：${body}`.slice(0, 80)
}

function clock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function relative(at: number): string {
  if (!at) return ''
  const diff = Date.now() - at
  if (!Number.isFinite(diff)) return ''
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const date = new Date(at)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

const quickReplies = [
  '您好，请说一下您遇到的问题，我这边帮您看。',
  '这款目前有现货，可以放心下单。',
  '尺码建议参考详情页的尺码表，需要我帮您确认吗？',
  '已经为您登记，稍后安排发出。',
  '抱歉让您久等了，我马上帮您确认。',
]
/** 快捷话术只填入输入框：是否发送由人确认，不替用户按下发送。 */
function fillPhrase(phrase: string) {
  text.value = phrase
}

const sendReason = computed(() => {
  if (task.pending.value) return '正在提交，请稍候'
  if (!current.value) return '请先在左侧选择一条会话'
  if (!store.value?.runtime.online) return '店铺未在线，无法发送；先在模拟顾客页打开店铺'
  if (!text.value.trim()) return '请先输入回复内容'
  return ''
})

const logEl = ref<HTMLElement | null>(null)
function scrollToLatest() {
  const el = logEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
watch(
  () => [current.value?.uid, current.value?.messages.length],
  () => {
    void nextTick(scrollToLatest)
  },
  { immediate: true },
)

/** 两个入口共用一个提交中状态，避免同时转圈让人以为两个动作都在执行。 */
const busy = ref<'store' | 'page' | ''>('')

async function openStore() {
  const row = store.value
  if (!row) return
  busy.value = 'store'
  try {
    const ok = await task.run(async () => {
      const result = await runtime.run({ action: 'open-store', storeId: row.id })
      task.message.value = result.message
    })
    if (ok) await refreshStatus()
  } finally {
    busy.value = ''
  }
}

async function openPage() {
  if (!support.supported) return
  busy.value = 'page'
  try {
    await task.run(async () => {
      const result = await openSimulatorPage()
      if (!result.ok) throw new Error(result.message)
      task.message.value = result.message
    })
    await refreshStatus()
  } finally {
    busy.value = ''
  }
}

/**
 * 模拟服务状态以主进程为准：进页面读一次，店铺数据变化（快照被替换）再读，
 * 另外每 10 秒兜底轮询一次，避免端口/进程在外部变化时界面一直旧值。
 */
const status = ref<SimulatorStatus>({ running: false, port: 0, url: '', error: '' })
const statusLoaded = ref(false)
let statusTicket = 0
let statusTimer: ReturnType<typeof setInterval> | undefined
let disposed = false

async function refreshStatus() {
  const ticket = ++statusTicket
  const next = await readSimulatorStatus()
  if (disposed || ticket !== statusTicket) return
  status.value = next
  statusLoaded.value = true
}

watch([() => runtime.snapshot.revision, () => runtime.snapshot.stores], () => {
  void refreshStatus()
})

onMounted(() => {
  void refreshStatus()
  statusTimer = setInterval(() => {
    void refreshStatus()
  }, 10_000)
})

onUnmounted(() => {
  disposed = true
  if (statusTimer !== undefined) clearInterval(statusTimer)
  statusTimer = undefined
})

async function send() {
  const row = current.value
  const reply = text.value.trim()
  if (!row || !reply || task.pending.value) return
  await task.run(async () => {
    const target = keyOf(row.storeId, row.uid)
    drafts.set(target, reply)
    // 先定位会话：主进程确认门按“当前选中会话”校验，跳过这一步会把回复发错会话。
    await runtime.run({
      action: 'select-conversation',
      storeId: row.storeId,
      conversationId: row.uid,
    })
    const result = await runtime.run({
      action: 'send-reply',
      storeId: row.storeId,
      conversationId: row.uid,
      values: { reply },
    })
    // 统一确认门在主进程：confirmed 才是“已受理”，这里既不能当成功，也不能改快照伪造。
    if (result.data.confirmed !== true)
      throw new Error(result.message || '发送未确认，请在模拟顾客页核对；草稿已保留')
    drafts.delete(target)
    if (chosen.value === target && text.value.trim() === reply) text.value = ''
    task.message.value = result.message
  })
}

function goAddStore() {
  void router.push({ path: '/shop/manage', query: { panel: 'shops' } })
}
</script>

<template>
  <RuntimePanel
    title="模拟客服台"
    description="本机模拟店铺的顾客消息由主进程采集到这里；显示的是本机记录，不连接任何真实平台。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <template #actions>
      <el-button :disabled="task.pending.value" @click="goAddStore">店铺管理</el-button>
      <el-button @click="router.push('/')">返回工作台</el-button>
    </template>

    <el-alert v-if="!support.supported" :title="support.reason" type="info" :closable="false" />
    <p v-if="runtime.loading" class="runtime-muted">正在同步本机数据…</p>

    <section v-if="!simStores.length" class="runtime-card sim-empty">
      <h2>还没有本机模拟店铺</h2>
      <p>
        请先到店铺管理里点「添加店铺」，平台选择「{{ SIM_PLATFORM_LABEL }}」并起一个名字；
        之后回到这里打开店铺，就能接收模拟顾客消息。
      </p>
      <div class="runtime-actions">
        <el-button type="primary" @click="goAddStore">去添加本机模拟店铺</el-button>
      </div>
    </section>

    <template v-else>
      <section class="runtime-card sim-toolbar" aria-label="模拟店铺操作">
        <div class="sim-toolbar__row">
          <label class="sim-field">
            <span>模拟店铺</span>
            <el-select
              v-model="selectedId"
              :disabled="task.pending.value"
              placeholder="请选择本机模拟店铺"
              aria-label="本机模拟店铺"
            >
              <el-option
                v-for="item in simStores"
                :key="item.id"
                :value="item.id"
                :label="item.storeName || '未命名模拟店铺'"
              />
            </el-select>
          </label>
          <el-tag type="info" effect="plain">{{ SIM_PLATFORM_LABEL }}</el-tag>
          <el-tag :type="openBadge.tone" effect="plain">{{ openBadge.text }}</el-tag>
          <span class="runtime-muted">本机模拟，不连接真实平台</span>
        </div>
        <div class="sim-toolbar__row">
          <el-button
            type="primary"
            :disabled="!canOpenStore || busy !== ''"
            :loading="busy === 'store'"
            @click="openStore"
          >
            打开店铺
          </el-button>
          <el-button
            :disabled="!support.supported || task.pending.value || busy !== ''"
            :loading="busy === 'page'"
            @click="openPage"
          >
            打开模拟顾客页
          </el-button>
          <span v-if="store?.runtime.lastError" class="sim-warn"
            >店铺最近错误：{{ store.runtime.lastError }}</span
          >
        </div>
        <p v-if="store?.runtime.open" class="runtime-muted">
          店铺已打开。到「模拟顾客页」以顾客身份发消息，本页会自动出现该会话。
        </p>
        <p v-else class="runtime-muted">先点「打开店铺」，再打开模拟顾客页发消息。</p>
      </section>

      <div class="sim-workspace">
        <section class="runtime-card sim-list" aria-label="会话列表">
          <header class="sim-list__head">
            <h2>会话</h2>
            <span class="runtime-muted">{{ conversations.length }} 个</span>
          </header>
          <p v-if="!conversations.length" class="runtime-muted">
            还没有顾客消息。打开模拟顾客页，以顾客身份发一条消息试试。
          </p>
          <button
            v-for="row in conversations"
            :key="row.uid"
            type="button"
            class="runtime-entry sim-entry"
            :class="{ active: chosen === keyOf(row.storeId, row.uid) }"
            :disabled="task.pending.value"
            @click="select(row)"
          >
            <span class="sim-entry__top">
              <b>{{ row.name || row.uid }}</b>
              <em :class="['sim-entry__status', statusTone(row.status)]">{{
                statusLabel(row.status)
              }}</em>
            </span>
            <span class="sim-entry__summary">{{ summary(row) }}</span>
            <span class="runtime-muted">{{ relative(lastAt(row)) }}</span>
          </button>
        </section>

        <section class="runtime-card sim-chat" aria-label="会话内容">
          <header class="sim-list__head">
            <h2>{{ current ? current.name || current.uid : '会话内容' }}</h2>
            <span v-if="current" class="runtime-muted"
              >{{ statusLabel(current.status) }} · {{ current.messages.length }} 条</span
            >
          </header>
          <p v-if="!conversations.length" class="runtime-muted">
            收到顾客消息后，这里会显示聊天记录。
          </p>
          <p v-else-if="!current" class="runtime-muted">在左侧选择一条会话开始查看和回复。</p>
          <template v-else>
            <div
              ref="logEl"
              class="sim-log"
              role="log"
              aria-label="模拟会话消息"
              aria-live="polite"
            >
              <div
                v-for="(message, index) in current.messages"
                :key="message.msgId || index"
                :class="['runtime-message', 'sim-bubble', message.from]"
              >
                <span class="sim-bubble__meta">
                  <b>{{ whoLabel(message.from) }}</b>
                  <span class="runtime-muted">{{ clock(message.ts) }}</span>
                </span>
                <span class="sim-bubble__body">{{
                  message.type === 'image' ? `[图片] ${message.content}` : message.content
                }}</span>
              </div>
              <p v-if="!current.messages.length" class="runtime-muted">
                本会话还没有消息，等待顾客先发一条。
              </p>
            </div>
            <form class="sim-composer" @submit.prevent="send">
              <el-input
                v-model="text"
                type="textarea"
                :rows="4"
                maxlength="2000"
                show-word-limit
                aria-label="回复内容"
                :disabled="task.pending.value"
                placeholder="输入要发给顾客的回复；发送经主进程确认门，不确认不会写入会话。"
              />
              <div class="sim-quick" role="group" aria-label="常用话术">
                <el-button
                  v-for="phrase in quickReplies"
                  :key="phrase"
                  size="small"
                  :disabled="task.pending.value"
                  @click="fillPhrase(phrase)"
                >
                  {{ phrase }}
                </el-button>
              </div>
              <div class="runtime-actions">
                <el-button
                  type="primary"
                  native-type="submit"
                  :disabled="Boolean(sendReason)"
                  :loading="task.pending.value"
                >
                  发送回复
                </el-button>
                <span v-if="sendReason" class="runtime-muted">{{ sendReason }}</span>
              </div>
            </form>
          </template>
        </section>

        <aside class="sim-info">
          <section class="runtime-card">
            <h2>本机模拟怎么用</h2>
            <ol class="sim-steps">
              <li>「添加店铺」里选「{{ SIM_PLATFORM_LABEL }}」，并起一个能区分的名字。</li>
              <li>回到本页点「打开店铺」，再点「打开模拟顾客页」。</li>
              <li>在系统浏览器里以顾客身份发消息。</li>
              <li>消息进入左侧会话列表后，在这里人工回复。</li>
            </ol>
            <p class="runtime-muted">
              模拟店铺只在本机运行：没有真实平台登录、没有真实买家，消息只写在本机记录里，适合先演练回复流程。
            </p>
          </section>

          <section class="runtime-card">
            <h2>模拟服务状态</h2>
            <p class="sim-status-line">
              <el-tag :type="status.running ? 'success' : 'info'" effect="plain">{{
                status.running ? '运行中' : '未启动'
              }}</el-tag>
              <span class="runtime-muted">{{
                statusLoaded
                  ? status.running
                    ? `端口 ${status.port}`
                    : '主进程未启动模拟服务'
                  : '正在读取…'
              }}</span>
            </p>
            <p class="sim-url">
              <span>地址：</span>
              <code v-if="status.url">{{ status.url }}</code>
              <span v-else class="runtime-muted">尚未启动</span>
            </p>
            <el-alert
              v-if="!status.running && status.error"
              :title="status.error"
              type="error"
              :closable="false"
            />
          </section>

          <section class="runtime-card sim-notice">
            <p><strong>AI 生成的回复同样需要逐条人工确认，确认后才发送。</strong></p>
            <p class="runtime-muted">
              确认门在主进程：本页只提交候选回复，不能绕过确认，也不能改快照把未确认的回复显示成已发送。
            </p>
          </section>
        </aside>
      </div>
    </template>
  </RuntimePanel>
</template>

<style scoped>
.sim-toolbar__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 6px 0;
}
.sim-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.sim-field .el-select {
  width: 240px;
}
.sim-warn {
  color: #d05b5b;
  font-size: 12px;
}
.sim-workspace {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(240px, 300px);
  grid-template-areas: 'list chat info';
  gap: 16px;
  align-items: start;
}
.sim-list {
  grid-area: list;
}
.sim-chat {
  grid-area: chat;
}
.sim-info {
  grid-area: info;
}
.sim-list__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.sim-list__head h2 {
  margin: 0 0 12px;
}
.sim-entry__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.sim-entry__status {
  font-style: normal;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #eef2f9;
  color: #71819a;
}
.sim-entry__status.is-pending {
  background: #fff3e2;
  color: #c07916;
}
.sim-entry__status.is-replied {
  background: #e9f6ec;
  color: #3f8a4f;
}
.sim-entry__summary {
  display: block;
  margin: 6px 0 4px;
  color: #5d6b80;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sim-log {
  max-height: 46vh;
  min-height: 180px;
  overflow-y: auto;
  padding: 4px 6px;
  border: 1px solid #eef2f9;
  border-radius: 10px;
  background: #fafcff;
}
.sim-bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: fit-content;
  max-width: 78%;
}
.sim-bubble.buyer {
  margin-right: auto;
}
.sim-bubble.seller {
  margin-left: auto;
  background: #e4f1ff;
}
.sim-bubble__meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  color: #8493a9;
}
.sim-bubble__body {
  font-size: 14px;
  line-height: 1.6;
}
.sim-composer {
  margin-top: 14px;
  display: grid;
  gap: 10px;
}
.sim-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sim-steps {
  margin: 0 0 12px;
  padding-left: 20px;
  color: #5d6b80;
  font-size: 13px;
  line-height: 1.9;
}
.sim-status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
}
.sim-url {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.sim-url code {
  font-size: 12px;
  user-select: all;
}
.sim-notice strong {
  color: #c07916;
}
@media (max-width: 1180px) {
  .sim-workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'list'
      'info'
      'chat';
  }
  .sim-log {
    max-height: none;
  }
}
</style>
