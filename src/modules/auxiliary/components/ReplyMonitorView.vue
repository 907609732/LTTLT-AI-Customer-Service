<script setup lang="ts">
import { computed } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getDesktop } from '@/shared/platform/desktop'
import { useTask } from '@/shared/ui/use-task'

const runtime = useRuntimeStore(),
  task = useTask(),
  desktop = getDesktop()
const pending = computed(() =>
  runtime.snapshot.review.replies.filter((row) => row.status === 'pending'),
)
const latestLog = computed(() => runtime.snapshot.review.logs.at(-1))
const lifecycleLogKinds = new Set([
  '确认发送',
  '自动模式放行',
  '自动发送复核',
  '待确认发送',
  '确认暂未放行',
  '已拒绝发送',
  '候选失效',
  '客服消息',
])
const reply = computed(() => {
  if (pending.value.length) return pending.value[0]
  const recentReplies = [...runtime.snapshot.review.replies].sort((a, b) => b.at - a.at)
  const sending = recentReplies.find((row) => row.status === 'sending')
  if (sending) return sending
  const latest = recentReplies[0],
    log = latestLog.value
  if (!latest || !log || latest.at >= log.at) return latest
  // 发送日志晚于候选创建时间；同会话的发送生命周期继续展示候选的实际状态。
  const related = log.storeId === latest.storeId && log.uid === latest.uid
  return related && (log.kind.startsWith('reply:') || lifecycleLogKinds.has(log.kind))
    ? latest
    : undefined
})
const store = computed(
  () =>
    runtime.snapshot.stores.find(
      (row) => row.id === (reply.value?.storeId ?? latestLog.value?.storeId),
    ) ?? runtime.currentStore,
)
const mode = computed(() => (store.value?.sendMode === 'auto' ? '自动发送' : '审核发送'))
const canReview = computed(() => reply.value?.status === 'pending')
const statusLabels = {
  pending: '等待确认',
  sending: '发送中',
  sent: '已发送',
  rejected: '已取消',
  expired: '已失效',
  failed: '需核对发送',
}
const status = computed(() =>
  reply.value ? statusLabels[reply.value.status] : latestLog.value?.ai?.reason || '等待新消息',
)
const detail = computed(
  () =>
    task.error.value ||
    runtime.error ||
    reply.value?.reason ||
    latestLog.value?.text ||
    (runtime.available ? '开启店铺 AI 后显示回复进度' : '浏览器仅预览，操作需要桌面版'),
)
async function decide(approve: boolean) {
  const id = reply.value?.id
  if (!id || !canReview.value) return
  await task.run(async () => {
    await runtime.run({ action: 'review-reply', values: { id, approve } })
  })
}
async function openLogs() {
  await task.run(async () => {
    await runtime.run({ action: 'open-runtime-logs' })
  })
}
async function close() {
  await task.run(async () => {
    await desktop.close()
  })
}
</script>

<template>
  <main class="reply-monitor">
    <header data-window-drag>
      <b>回复监控</b>
      <span class="mode">{{ mode }}</span>
      <button data-no-drag class="close" aria-label="关闭监控" @click="close">×</button>
    </header>
    <section class="monitor-content" aria-live="polite">
      <div class="identity">
        <strong>{{
          reply?.storeName || latestLog?.storeName || store?.storeName || '暂无店铺'
        }}</strong
        ><span>{{ reply?.buyerName || latestLog?.buyerName || '等待买家消息' }}</span>
      </div>
      <div class="state">
        <i :class="{ failed: reply?.status === 'failed' }" />{{ status
        }}<span v-if="pending.length > 1"> · {{ pending.length }} 条待确认</span>
      </div>
      <p class="reply-text">{{ reply?.text || latestLog?.text || '暂无回复' }}</p>
      <p class="detail" :class="{ error: task.error.value || runtime.error }" :title="detail">
        {{ detail }}
      </p>
    </section>
    <footer>
      <button data-action="logs" class="logs" :disabled="task.pending.value" @click="openLogs">
        高级日志
      </button>
      <template v-if="canReview">
        <button data-action="cancel" :disabled="task.pending.value" @click="decide(false)">
          取消
        </button>
        <button
          data-action="approve"
          class="primary"
          :disabled="task.pending.value"
          @click="decide(true)"
        >
          确认发送
        </button>
      </template>
    </footer>
  </main>
</template>

<style scoped>
.reply-monitor {
  box-sizing: border-box;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  color: #263248;
  font:
    12px/1.5 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  flex-shrink: 0;
  padding: 0 12px;
  border-bottom: 1px solid #edf0f4;
}
header b {
  font-size: 13px;
}
.mode {
  border-radius: 4px;
  padding: 1px 5px;
  background: #f1f5fa;
  color: #61718a;
  font-size: 10px;
}
button {
  border: 1px solid #e1e6ed;
  border-radius: 5px;
  padding: 4px 10px;
  background: #fff;
  color: #58677c;
  cursor: pointer;
  font: inherit;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.close {
  margin-left: auto;
  border: 0;
  padding: 0 3px;
  font-size: 20px;
  line-height: 24px;
}
.monitor-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 11px 12px 4px;
}
.identity {
  display: flex;
  gap: 10px;
}
.identity strong,
.identity span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.identity strong {
  max-width: 55%;
}
.identity span {
  color: #6b788b;
}
.state {
  display: flex;
  align-items: center;
  color: #76849a;
  font-size: 11px;
  margin-top: 5px;
}
i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  margin-right: 5px;
  background: #6298ec;
}
i.failed {
  background: #dc705c;
}
.reply-text {
  margin: 8px 0 5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 58px;
  overflow: auto;
  color: #27394f;
}
.detail {
  margin: 0;
  color: #8a95a5;
  font-size: 11px;
  max-height: 32px;
  overflow: auto;
  overflow-wrap: anywhere;
}
.detail.error {
  color: #c65746;
}
footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding: 8px 12px;
  border-top: 1px solid #f0f2f5;
}
.logs {
  margin-right: auto;
  padding-left: 0;
  border: 0;
  color: #758399;
}
.primary {
  background: #397ff2;
  border-color: #397ff2;
  color: white;
}
</style>
