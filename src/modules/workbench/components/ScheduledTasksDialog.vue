<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { getSchedulerService, getSchedulerWorkspaceId } from '../services/scheduler'
import {
  schedulerTaskInputSchema,
  type AutomationAction,
  type SchedulerBridge,
  type SchedulerCommand,
  type SchedulerSnapshot,
  type SchedulerTask,
} from '@/shared/contracts/scheduler'
const props = withDefaults(
  defineProps<{ modelValue?: boolean; service?: SchedulerBridge; workspaceId?: string }>(),
  { modelValue: false, workspaceId: '' },
)
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
const snapshot = ref<SchedulerSnapshot>()
const error = ref('')
const busy = ref(false)
const editor = ref(false)
const editing = ref<SchedulerTask>()
const service = computed(() => props.service ?? getSchedulerService())
const workspaceId = computed(
  () => props.workspaceId || (service.value ? getSchedulerWorkspaceId() : ''),
)
const form = reactive({
  name: '',
  storeId: '',
  uid: '',
  enabled: false,
  kind: 'welcome-text' as AutomationAction['kind'],
  text: '',
  url: '',
  agentId: '',
  orderId: '',
  type: 'daily' as 'daily' | 'once' | 'interval',
  time: '09:00',
  timezone: 'Asia/Shanghai',
  once: '',
  minutes: 60,
})
let timer: ReturnType<typeof setInterval> | undefined
let generation = 0
let requestSequence = 0
async function refresh() {
  const bridge = service.value
  const expectedWorkspace = workspaceId.value
  if (!bridge || !expectedWorkspace) return
  const current = generation
  const request = ++requestSequence
  try {
    const next = await bridge.schedulerSnapshot(expectedWorkspace)
    if (
      current !== generation ||
      request !== requestSequence ||
      expectedWorkspace !== workspaceId.value ||
      next.workspaceId !== expectedWorkspace
    )
      return
    if (snapshot.value && snapshot.value.workspaceId !== next.workspaceId) {
      editor.value = false
      editing.value = undefined
    }
    snapshot.value = next
  } catch {
    if (current === generation) error.value = '读取定时任务失败，请刷新重试'
  }
}
watch(
  () => props.modelValue,
  (visible) => {
    generation++
    if (timer) clearInterval(timer)
    timer = undefined
    if (visible) {
      void refresh()
      timer = setInterval(() => {
        if (!busy.value) void refresh()
      }, 5000)
    } else editor.value = false
  },
  { immediate: true },
)
onUnmounted(() => {
  generation++
  if (timer) clearInterval(timer)
})
watch(workspaceId, () => {
  generation++
  snapshot.value = undefined
  editor.value = false
  editing.value = undefined
  error.value = ''
  if (props.modelValue) void refresh()
})
async function execute(command: SchedulerCommand) {
  if (!service.value || busy.value) return false
  busy.value = true
  error.value = ''
  const current = generation
  const request = ++requestSequence
  try {
    const next = await service.value.schedulerExecute(command)
    if (
      current !== generation ||
      request !== requestSequence ||
      command.workspaceId !== workspaceId.value ||
      next.workspaceId !== workspaceId.value
    )
      return false
    snapshot.value = next
    return true
  } catch {
    if (current === generation) error.value = '操作未保存，请刷新核对任务版本或检查输入后重试'
    return false
  } finally {
    busy.value = false
  }
}
function edit(row?: SchedulerTask) {
  editing.value = row
  Object.assign(form, {
    name: row?.name ?? '',
    storeId: row?.storeId ?? '',
    uid: row?.uid ?? '',
    enabled: row?.enabled ?? false,
    kind: row?.action.kind ?? 'welcome-text',
    text: row && 'text' in row.action ? row.action.text : '',
    url: row && 'url' in row.action ? row.action.url : '',
    agentId: row?.action.kind === 'transfer' ? row.action.agentId : '',
    orderId: row?.action.kind === 'payment-reminder' ? row.action.orderId : '',
    type: row?.schedule.type ?? 'daily',
    time: row?.schedule.type === 'daily' ? row.schedule.time : '09:00',
    timezone: row?.schedule.type === 'daily' ? row.schedule.timezone : 'Asia/Shanghai',
    once: row?.schedule.type === 'once' ? new Date(row.schedule.at).toISOString() : '',
    minutes: row?.schedule.type === 'interval' ? row.schedule.minutes : 60,
  })
  editor.value = true
  error.value = ''
}
async function save() {
  if (!snapshot.value) return
  const action =
    form.kind === 'transfer'
      ? { kind: form.kind, agentId: form.agentId }
      : form.kind === 'welcome-image' || form.kind === 'welcome-video'
        ? { kind: form.kind, url: form.url }
        : form.kind === 'payment-reminder'
          ? { kind: form.kind, text: form.text, orderId: form.orderId }
          : { kind: form.kind, text: form.text }
  const schedule =
    form.type === 'daily'
      ? { type: form.type, time: form.time, timezone: form.timezone }
      : form.type === 'interval'
        ? { type: form.type, minutes: Number(form.minutes) }
        : { type: form.type, at: /Z$|[+-]\d\d:\d\d$/.test(form.once) ? Date.parse(form.once) : NaN }
  const value = schedulerTaskInputSchema.safeParse({
    name: form.name,
    storeId: form.storeId,
    uid: form.uid,
    enabled: form.enabled,
    action,
    schedule,
  })
  if (!value.success) {
    error.value =
      '请填写任务、店铺和买家；检查 HTTPS 媒体地址、时间及有效时区。一次性时间须包含 Z 或时区偏移。'
    return
  }
  if (
    await execute({
      type: 'save',
      workspaceId: snapshot.value.workspaceId,
      id: editing.value?.id,
      revision: editing.value?.revision,
      task: value.data,
    })
  )
    editor.value = false
}
function taskCommand(row: SchedulerTask, type: 'enable' | 'remove') {
  if (!snapshot.value) return
  const base = { workspaceId: snapshot.value.workspaceId, id: row.id, revision: row.revision }
  void execute(type === 'enable' ? { ...base, type, enabled: !row.enabled } : { ...base, type })
}
const labels: Record<AutomationAction['kind'], string> = {
  'welcome-text': '文字欢迎',
  'welcome-image': '图片欢迎',
  'welcome-video': '视频欢迎',
  transfer: '平台客服转接',
  'payment-reminder': '催付提醒',
}
const states = {
  pending: '待提交确认',
  blocked: '能力未接入',
  cancelled: '已取消',
  expired: '已过期',
}
function time(at: number) {
  return new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}
</script>
<template>
  <el-dialog
    :model-value="props.modelValue"
    title="定时任务"
    width="760px"
    append-to-body
    :close-on-click-modal="false"
    class="scheduled-tasks-dialog"
    data-v-6379a767=""
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="st-tip" data-v-6379a767="">
      到点仅建立待提交确认事项。所有消息须逐条批准；关闭软件期间不会执行，重启不恢复批准状态。
    </p>
    <p v-if="!service" role="status">定时服务尚未接入；浏览器仅供预览，无法保存或后台执行。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="snapshot?.error" role="alert">{{ snapshot.error }}</p>
    <div class="st-toolbar" data-v-6379a767="">
      <button :disabled="!snapshot || busy" class="st-add" type="button" @click="edit()">
        添加任务</button
      ><button :disabled="!service || busy" type="button" @click="refresh">刷新</button
      ><span v-if="snapshot">{{ snapshot.running ? '调度已启动' : '调度未启动' }}</span>
    </div>
    <div class="st-table" data-v-6379a767="">
      <p v-if="!snapshot?.tasks.length" class="st-empty" data-v-6379a767="">暂无定时任务</p>
      <article v-for="row in snapshot?.tasks" :key="row.id" class="task-entry">
        <strong>{{ row.name }}</strong>
        <p>{{ labels[row.action.kind] }} · 店铺 {{ row.storeId }} · 买家 {{ row.uid }}</p>
        <p>
          {{
            row.schedule.type === 'daily'
              ? `每天 ${row.schedule.time} (${row.schedule.timezone})`
              : row.schedule.type === 'interval'
                ? `每 ${row.schedule.minutes} 分钟`
                : '仅一次'
          }}
          · {{ row.enabled ? `下次 ${time(row.nextAt)}（北京时间）` : '已停用' }}
        </p>
        <button type="button" :disabled="busy" @click="taskCommand(row, 'enable')">
          {{ row.enabled ? '停用' : '启用' }}
        </button>
        <button type="button" :disabled="busy" @click="edit(row)">编辑</button>
        <button type="button" :disabled="busy" @click="taskCommand(row, 'remove')">
          删除并取消待办
        </button>
      </article>
    </div>
    <h3>执行记录（不代表平台已发送）</h3>
    <p v-if="!snapshot?.runs.length">暂无记录</p>
    <article v-for="run in [...(snapshot?.runs ?? [])].reverse()" :key="run.id" class="task-entry">
      <strong>{{ states[run.state] }} · {{ labels[run.action.kind] }}</strong>
      <p>{{ time(run.createdAt) }} · {{ run.storeId }} / {{ run.uid }}</p>
      <p>{{ run.reason }}</p>
      <button
        v-if="run.state === 'pending' && snapshot"
        type="button"
        :disabled="busy"
        @click="execute({ type: 'cancel', workspaceId: snapshot.workspaceId, id: run.id })"
      >
        取消，不发送
      </button>
    </article>
    <el-dialog
      v-model="editor"
      title="设置任务"
      width="520px"
      append-to-body
      :close-on-click-modal="false"
      class="scheduled-task-editor"
      data-v-6379a767=""
    >
      <form class="scheduler-form" @submit.prevent="save">
        <label>任务名称<input v-model="form.name" maxlength="80" required /></label>
        <label>店铺编号<input v-model="form.storeId" required /></label
        ><label>买家 UID<input v-model="form.uid" required /></label>
        <label
          >任务类型<select v-model="form.kind">
            <option v-for="(label, kind) in labels" :key="kind" :value="kind">{{ label }}</option>
          </select></label
        >
        <label v-if="form.kind === 'welcome-text' || form.kind === 'payment-reminder'"
          >待确认文字<textarea v-model="form.text" maxlength="2000" required />
        </label>
        <label v-if="form.kind === 'welcome-image' || form.kind === 'welcome-video'"
          >平台已验证的 HTTPS 媒体地址<input v-model="form.url" type="url" required
        /></label>
        <label v-if="form.kind === 'transfer'"
          >平台客服编号<input v-model="form.agentId" required
        /></label>
        <label v-if="form.kind === 'payment-reminder'"
          >订单编号<input v-model="form.orderId" required
        /></label>
        <label
          >调度方式<select v-model="form.type">
            <option value="daily">每天固定时间</option>
            <option value="once">仅一次</option>
            <option value="interval">固定间隔</option>
          </select></label
        >
        <template v-if="form.type === 'daily'"
          ><label>时间<input v-model="form.time" type="time" required /></label
          ><label
            >IANA 时区<input v-model="form.timezone" placeholder="Asia/Shanghai" required /></label
        ></template>
        <label v-if="form.type === 'once'"
          >含时区的时间<input v-model="form.once" placeholder="2026-11-15T09:00:00+08:00" required
        /></label>
        <label v-if="form.type === 'interval'"
          >间隔（分钟）<input
            v-model.number="form.minutes"
            type="number"
            min="1"
            max="525600"
            required
        /></label>
        <label><input v-model="form.enabled" type="checkbox" />启用（只产生待确认事项）</label>
        <p>
          访客、未付款订单、媒体和转接均须有平台证据及确认门支持；未接入将记录为阻塞，不会发送。
        </p>
        <p v-if="error" role="alert">{{ error }}</p>
        <button type="button" :disabled="busy" @click="editor = false">取消</button>
        <button type="submit" :disabled="busy">保存任务</button>
      </form>
    </el-dialog>
  </el-dialog>
</template>
<style scoped>
.scheduler-form {
  display: grid;
  gap: 12px;
}
.scheduler-form label {
  display: grid;
  gap: 5px;
}
.scheduler-form input,
.scheduler-form select,
.scheduler-form textarea {
  padding: 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #1e293b;
  background: white;
}
.task-entry {
  padding: 12px 0;
  border-bottom: 1px solid #e2e8f0;
  overflow-wrap: anywhere;
}
.task-entry p {
  margin: 6px 0;
}
</style>
