<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SchedulerRun } from '@/shared/contracts/scheduler'
import type { ReceptionCommand } from '@/shared/contracts/platform-operations'
const props = defineProps<{
  workspaceId: string
  runs: SchedulerRun[]
  busy?: boolean
  storeId?: string
}>()
const emit = defineEmits<{ command: [command: ReceptionCommand] }>()
const selected = ref(''),
  now = ref(Date.now()),
  submitted = ref('')
const rows = computed(() =>
  props.runs.filter((run) => !props.storeId || run.storeId === props.storeId),
)
const current = computed(
  () =>
    rows.value.find((run) => run.id === selected.value) ??
    rows.value.find((run) =>
      ['pending', 'uncertain', 'blocked', 'executing'].includes(run.state),
    ) ??
    rows.value.at(-1),
)
const expired = computed(() => !current.value || current.value.expiresAt <= now.value)
const labels = {
  'welcome-text': '文字欢迎',
  'welcome-image': '图片欢迎',
  'welcome-video': '视频欢迎',
  transfer: '平台客服转接',
  'payment-reminder': '平台催支付',
}
const states = {
  pending: '待批准',
  blocked: '能力或证据不足',
  executing: '执行中',
  confirmed: '已确认',
  failed: '执行失败',
  uncertain: '待核对',
  invalidated: '已失效',
  cancelled: '已取消',
  expired: '已过期',
}
watch(
  () => props.workspaceId,
  () => {
    selected.value = ''
    submitted.value = ''
  },
)
watch(
  () => props.runs,
  () => {
    now.value = Date.now()
  },
)
watch(
  () => current.value?.approvalId,
  () => {
    submitted.value = ''
  },
)
function command(type: 'approve' | 'cancel' | 'prepare' | 'inspect') {
  const run = current.value
  if (!run || props.busy) return
  if (type === 'approve') {
    if (
      expired.value ||
      run.state !== 'pending' ||
      !run.prepared ||
      !run.approvalId ||
      submitted.value === run.approvalId
    )
      return
    submitted.value = run.approvalId
    emit('command', {
      type,
      workspaceId: props.workspaceId,
      id: run.id,
      approvalId: run.approvalId,
    })
  } else emit('command', { type, workspaceId: props.workspaceId, id: run.id })
}
const time = (at: number) =>
  new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const bytes = (size: number) =>
  size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
<template>
  <section class="operation-approval" aria-label="平台操作逐项批准">
    <header class="approval-head">
      <div>
        <h2>逐项批准平台操作</h2>
        <p>每次只执行当前这一项。关闭页面不会批准；待核对事项不会重发。</p>
      </div>
      <span>{{ rows.filter((row) => row.state === 'pending').length }} 项待批准</span>
    </header>
    <p v-if="!rows.length" class="approval-empty">
      暂无平台操作事项。须先取得可信访客、订单或客服事件。
    </p>
    <template v-else>
      <label class="approval-select"
        >选择事项<select v-model="selected" :disabled="busy">
          <option value="">优先显示待处理事项</option>
          <option v-for="row in rows" :key="row.id" :value="row.id">
            {{ states[row.state] }} · {{ labels[row.action.kind] }} ·
            {{ row.prepared?.target.buyerName ?? row.uid }}
          </option>
        </select></label
      >
      <article v-if="current" class="approval-card" :data-state="current.state">
        <div class="approval-heading">
          <strong>{{ states[current.state] }} · {{ labels[current.action.kind] }}</strong
          ><span>{{ time(current.createdAt) }}（北京时间）</span>
        </div>
        <template v-if="current.prepared">
          <dl class="approval-target">
            <div>
              <dt>目标店铺</dt>
              <dd>{{ current.prepared.target.storeName }}（{{ current.storeId }}）</dd>
            </div>
            <div>
              <dt>目标买家</dt>
              <dd>{{ current.prepared.target.buyerName }}（{{ current.uid }}）</dd>
            </div>
          </dl>
          <div class="approval-content" aria-label="最终执行内容">
            <p v-if="current.prepared.operationLabel">{{ current.prepared.operationLabel }}</p>
            <template v-if="current.prepared.action.kind === 'welcome-text'"
              ><h3>最终文字</h3>
              <p class="final-text">{{ current.prepared.action.text }}</p></template
            >
            <template v-else-if="current.prepared.action.kind === 'payment-reminder'"
              ><h3>平台催支付</h3>
              <p>{{ current.prepared.orderLabel }}（订单 {{ current.prepared.action.orderId }}）</p>
              <p class="final-text">备注：{{ current.prepared.action.text }}</p>
              <p>执行以上平台原生催支付条款；备注不会另发聊天消息。</p></template
            >
            <template v-else-if="current.prepared.action.kind === 'transfer'"
              ><h3>转接到平台客服</h3>
              <p>
                {{ current.prepared.agentName }}（{{ current.prepared.action.agentId }}）
              </p></template
            >
            <template v-else>
              <img
                v-if="current.prepared.action.kind === 'welcome-image'"
                :src="current.prepared.action.url"
                alt="当前待批准图片"
              />
              <video
                v-else
                :src="current.prepared.action.url"
                controls
                preload="metadata"
                aria-label="当前待批准视频"
              />
              <p v-if="current.prepared.media">
                {{ current.prepared.media.mimeType }} ·
                {{ bytes(current.prepared.media.sizeBytes) }}
              </p>
              <p class="media-url">{{ current.prepared.action.url }}</p>
            </template>
          </div>
          <details>
            <summary>平台证据与有效期</summary>
            <p v-for="evidence in current.prepared.evidence" :key="evidence.id">
              {{ time(evidence.observedAt) }} · {{ evidence.description }}
            </p>
            <p>批准有效期至 {{ time(current.expiresAt) }}（北京时间）</p>
          </details>
        </template>
        <p v-else>
          店铺 {{ current.storeId }} · 买家 {{ current.uid }}；尚未取得可批准的平台证据。
        </p>
        <p class="approval-reason" role="status">{{ current.reason }}</p>
        <p v-if="current.evidence">
          平台确认：{{ current.evidence.description }} · {{ time(current.evidence.observedAt) }}
        </p>
        <p v-if="current.state === 'uncertain'">
          先核对原平台的准确买家与实际回显。此记录不提供重新发送。
        </p>
        <div class="approval-actions">
          <button
            v-if="current.state === 'pending' && current.prepared && current.approvalId"
            type="button"
            class="approve-button"
            :disabled="busy || expired || submitted === current.approvalId"
            @click="command('approve')"
          >
            批准并执行这一项
          </button>
          <button
            v-if="
              ['pending', 'blocked'].includes(current.state) &&
              (!current.prepared || !current.approvalId)
            "
            type="button"
            :disabled="busy || expired"
            @click="command('prepare')"
          >
            重新只读准备
          </button>
          <button
            v-if="['pending', 'blocked'].includes(current.state)"
            type="button"
            :disabled="busy"
            @click="command('cancel')"
          >
            取消，不执行
          </button>
          <button
            v-if="current.state === 'uncertain'"
            type="button"
            :disabled="busy"
            @click="command('inspect')"
          >
            只读核对平台结果
          </button>
          <span v-if="expired && ['pending', 'blocked'].includes(current.state)"
            >有效期已到，请刷新核对</span
          >
        </div>
      </article>
    </template>
  </section>
</template>
<style scoped>
.operation-approval {
  display: grid;
  gap: 14px;
  margin-top: 22px;
  color: #28313f;
}
.approval-head,
.approval-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.approval-head h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.approval-head p,
.approval-heading span,
.approval-empty {
  color: #78818e;
  font-size: 13px;
  margin: 0;
}
.approval-select {
  display: flex;
  align-items: center;
  gap: 12px;
}
select,
button {
  border: 1px solid #dce1e8;
  border-radius: 7px;
  padding: 9px 12px;
  background: #fff;
  color: inherit;
}
select {
  max-width: 100%;
  flex: 1;
  min-width: 0;
}
.approval-card {
  border: 1px solid #e4e8ef;
  border-radius: 10px;
  padding: 16px;
  background: #fff;
  overflow-wrap: anywhere;
}
.approval-target {
  display: grid;
  gap: 8px;
}
.approval-target div {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
dt {
  color: #78818e;
}
dd {
  margin: 0;
}
.approval-content {
  background: #f7f9fc;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}
.approval-content h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.final-text {
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 0;
}
.approval-content img,
.approval-content video {
  max-width: 100%;
  max-height: 260px;
  border-radius: 6px;
  display: block;
}
.media-url {
  font-size: 12px;
  color: #78818e;
}
details {
  font-size: 12px;
  color: #78818e;
}
.approval-reason {
  font-size: 13px;
}
.approval-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.approve-button {
  color: white;
  background: #6059e8;
  border-color: #6059e8;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
[data-state='uncertain'] {
  border-color: #e9bd62;
}
</style>
