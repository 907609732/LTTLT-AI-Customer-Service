<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useReceptionDraftCache } from '../draft-cache'
import {
  receptionRuleSchema,
  type ReceptionCommand,
  type ReceptionSnapshot,
  type ReceptionRule,
} from '@/shared/contracts/platform-operations'
const props = defineProps<{
  workspaceId: string
  storeId: string
  trigger: ReceptionRule['trigger']
  snapshot?: ReceptionSnapshot
  busy?: boolean
  preserveDraft?: boolean
  mediaOnly?: boolean
  /** 欢迎媒体自动保存；只有该回调返回真实确认快照后才允许提示成功。 */
  mediaAutosave?: boolean
  saveMediaRule?: (command: ReceptionCommand) => Promise<ReceptionSnapshot | undefined>
}>()
const drafts = props.preserveDraft ? useReceptionDraftCache() : undefined
let draftLease = { workspaceId: props.workspaceId, storeId: props.storeId, trigger: props.trigger }
const emit = defineEmits<{ command: [command: ReceptionCommand]; refresh: []; alert: [] }>()
type Media = { kind: 'welcome-image' | 'welcome-video'; url: string }
type MediaSaveCommand = Extract<ReceptionCommand, { type: 'save-rule' | 'remove-rule' }>
const form = reactive({
  id: '',
  revision: 1,
  enabled: false,
  text: '',
  agentId: '',
  media: [] as Media[],
})
const error = ref(''),
  dirty = ref(false),
  saving = ref(false)
interface MediaQueue {
  generation: number
  running: boolean
  queued: boolean
}
const mediaQueue: MediaQueue = { generation: 0, running: false, queued: false }
let mediaConfirmedSignature = ''
const removedRuleReceipt = ref<{ id: string; revision: number } | null>(null)
let unmounted = false
const facts = computed(() => props.snapshot?.facts.find((row) => row.storeId === props.storeId))
const rule = computed(() =>
  props.snapshot?.rules.find(
    (row) => row.storeId === props.storeId && row.trigger === props.trigger,
  ),
)
const mediaLoaded = computed(() => props.snapshot?.workspaceId === props.workspaceId)
// 草稿模式允许先编辑；真正自动保存仍要求权威快照，避免在未知规则上删掉隐藏文字。
const mediaReady = computed(
  () => !props.mediaAutosave || Boolean(props.preserveDraft) || mediaLoaded.value,
)
const conflict = computed(() =>
  Boolean(
    rule.value &&
      !(
        removedRuleReceipt.value?.id === rule.value.id &&
        rule.value.revision <= removedRuleReceipt.value.revision
      ) &&
      ((form.id === rule.value.id && form.revision < rule.value.revision) ||
        (props.mediaAutosave && dirty.value && form.id !== rule.value.id)),
  ),
)
watch(
  [error, conflict],
  ([message, hasConflict]) => {
    if (message || hasConflict) emit('alert')
  },
  { immediate: true },
)
const titles = {
  visitor: '无消息访客进店规则',
  'unpaid-order': '未付款订单催付规则',
  'transfer-request': '平台客服转接规则',
}
const capabilityLabels = {
  'welcome-text': '文字欢迎',
  'welcome-image': '图片欢迎',
  'welcome-video': '视频欢迎',
  'payment-reminder': '平台催支付',
  transfer: '平台客服转接',
}
const capabilities = computed(
  () =>
    facts.value?.capabilities.filter((row) =>
      props.trigger === 'visitor'
        ? row.kind.startsWith('welcome-')
        : row.kind === (props.trigger === 'unpaid-order' ? 'payment-reminder' : 'transfer'),
    ) ?? [],
)
function actionSignature(id: string, enabled: boolean, actions: ReceptionRule['actions']): string {
  return JSON.stringify({ id, enabled, actions })
}
function ruleSignature(value: ReceptionRule) {
  return actionSignature(value.id, value.enabled, value.actions)
}
function formActions(): ReceptionRule['actions'] {
  return [
    ...(form.text.trim() ? [{ kind: 'welcome-text' as const, text: form.text }] : []),
    ...form.media
      .filter((item) => Boolean(item.url.trim()))
      .map((item) => ({ kind: item.kind, url: item.url.trim() })),
  ]
}
function currentMediaSignature() {
  return actionSignature(form.id, form.enabled, formActions())
}
function resetMediaAutosave() {
  removedRuleReceipt.value = null
  mediaQueue.generation += 1
  mediaQueue.running = false
  mediaQueue.queued = false
  mediaConfirmedSignature = rule.value
    ? ruleSignature(rule.value)
    : actionSignature('', form.enabled, [])
}
function mediaError(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )
}
/**
 * Build the exact media command from the visible draft. Blank rows are only
 * unfinished drafts; non-empty invalid rows stop the save instead of being
 * silently dropped. Hidden welcome text and rule flags are always preserved.
 */
function mediaCommand(): MediaSaveCommand | null {
  if (!mediaLoaded.value) {
    error.value = '欢迎媒体配置尚未载入，请稍后重试。'
    return null
  }
  const media: Media[] = []
  for (const item of form.media) {
    const url = item.url.trim()
    if (!url) continue
    if (!/^https:\/\//i.test(url)) {
      error.value = '媒体地址必须是公网 HTTPS 地址。'
      return null
    }
    if (
      item.kind === 'welcome-video' &&
      !facts.value?.mediaAssets?.some((asset) => asset.url === url)
    ) {
      error.value = '请选择平台已审核的视频素材。'
      return null
    }
    media.push({ kind: item.kind, url })
  }
  if (media.length > 4) {
    error.value = '欢迎媒体最多四项。'
    return null
  }
  const actions: ReceptionRule['actions'] = [
    ...(form.text.trim() ? [{ kind: 'welcome-text' as const, text: form.text }] : []),
    ...media,
  ]
  if (!actions.length) {
    // 最后一项持久化媒体移除后，若没有隐藏文字动作，必须删除整条规则，
    // 否则旧媒体仍会在下一次平台事件中生效。
    const current = rule.value
    if (!current || (form.id && form.id !== current.id)) return null
    return {
      type: 'remove-rule',
      workspaceId: props.workspaceId,
      id: current.id,
      revision: current.revision,
    }
  }
  const id = form.id || globalThis.crypto.randomUUID()
  form.id = id
  const next = receptionRuleSchema.safeParse({
    id,
    storeId: props.storeId,
    enabled: form.enabled,
    trigger: props.trigger,
    actions,
    revision: form.revision,
  })
  if (!next.success) {
    error.value = '请填写有效文字、HTTPS媒体或选择平台可转接客服；欢迎媒体最多四项。'
    return null
  }
  return { type: 'save-rule', workspaceId: props.workspaceId, rule: next.data }
}
function mediaCommandSignature(command: MediaSaveCommand) {
  return command.type === 'remove-rule'
    ? actionSignature('', false, [])
    : actionSignature(command.rule.id, command.rule.enabled, command.rule.actions)
}
function acknowledgedMedia(snapshot: ReceptionSnapshot | undefined, command: MediaSaveCommand) {
  if (!snapshot || snapshot.workspaceId !== props.workspaceId) return false
  if (command.type === 'remove-rule') return !snapshot.rules.some((row) => row.id === command.id)
  const stored = snapshot.rules.find((row) => row.id === command.rule.id)
  return Boolean(
    stored &&
      stored.storeId === command.rule.storeId &&
      stored.trigger === command.rule.trigger &&
      stored.enabled === command.rule.enabled &&
      JSON.stringify(stored.actions) === JSON.stringify(command.rule.actions),
  )
}
async function pumpMediaAutosave() {
  if (!props.mediaAutosave || !props.saveMediaRule || mediaQueue.running) return
  mediaQueue.running = true
  const generation = mediaQueue.generation
  try {
    while (generation === mediaQueue.generation && mediaQueue.queued && !unmounted) {
      mediaQueue.queued = false
      if (conflict.value) {
        error.value = '接待规则已在其他窗口更新，请重新载入后再保存。'
        return
      }
      const command = mediaCommand()
      if (!command) continue
      const signature = mediaCommandSignature(command)
      if (signature === mediaConfirmedSignature) continue
      error.value = ''
      let next
      try {
        next = await props.saveMediaRule(command)
      } catch (cause) {
        if (generation === mediaQueue.generation && !unmounted) error.value = mediaError(cause)
        return
      }
      if (generation !== mediaQueue.generation || unmounted) return
      if (!next) {
        error.value = '无法确认媒体保存结果，当前草稿仍保留；请稍后重试。'
        return
      }
      if (!acknowledgedMedia(next, command)) {
        error.value = '平台未确认媒体规则已保存，当前草稿仍保留。'
        return
      }
      if (command.type === 'remove-rule') {
        // A confirmed deletion takes precedence over an older parent snapshot.
        removedRuleReceipt.value = { id: command.id, revision: command.revision }
        form.id = ''
        form.revision = 1
        // A replacement media draft may already be queued; deletion must not
        // change its enabled intent while advancing the empty-rule baseline.
        mediaConfirmedSignature = actionSignature('', form.enabled, [])
      } else {
        const stored = next.rules.find((row) => row.id === command.rule.id)
        if (!stored) {
          error.value = '平台未确认媒体规则已保存，当前草稿仍保留。'
          return
        }
        // 只推进 id/revision 基线；保存期间的媒体编辑仍保留在草稿里。
        form.id = stored.id
        form.revision = stored.revision
        mediaConfirmedSignature = actionSignature(
          command.rule.id,
          command.rule.enabled,
          command.rule.actions,
        )
      }
      dirty.value = currentMediaSignature() !== mediaConfirmedSignature
      ElMessage.success('保存成功')
    }
  } finally {
    if (generation === mediaQueue.generation) mediaQueue.running = false
  }
}
function requestMediaAutosave() {
  if (unmounted || !props.mediaAutosave || !props.saveMediaRule) return
  if (props.trigger !== 'visitor') return
  mediaQueue.queued = true
  void pumpMediaAutosave()
}
function submitRule() {
  if (props.mediaOnly) requestMediaAutosave()
  else save()
}
function load(restoreDraft = false) {
  const value = rule.value
  Object.assign(form, {
    id: value?.id ?? '',
    revision: value?.revision ?? 1,
    enabled: value?.enabled ?? false,
    text:
      value?.actions.find(
        (action) => action.kind === 'welcome-text' || action.kind === 'payment-reminder',
      )?.text ?? '',
    agentId: value?.actions.find((action) => action.kind === 'transfer')?.agentId ?? '',
    media:
      value?.actions
        .filter(
          (action): action is Media =>
            action.kind === 'welcome-image' || action.kind === 'welcome-video',
        )
        .map((action) => ({ ...action })) ?? [],
  })
  dirty.value = false
  saving.value = false
  error.value = ''
  resetMediaAutosave()
  draftLease = { workspaceId: props.workspaceId, storeId: props.storeId, trigger: props.trigger }
  const previous = restoreDraft
    ? drafts?.getRule(props.workspaceId, props.storeId, props.trigger)
    : undefined
  if (previous) {
    Object.assign(form, previous.form, { media: previous.form.media.map((item) => ({ ...item })) })
    dirty.value = previous.dirty
  }
}
onBeforeUnmount(() => {
  unmounted = true
  mediaQueue.generation += 1
  mediaQueue.queued = false
  drafts?.putRule(draftLease.workspaceId, draftLease.storeId, draftLease.trigger, {
    form: { ...form, media: form.media.map((item) => ({ ...item })) },
    dirty: dirty.value,
  })
})
watch(
  () => [props.workspaceId, props.storeId, props.trigger],
  () => load(true),
  { immediate: true },
)
watch(rule, (next, previous) => {
  // 媒体自动保存已在响应里推进 form.id/revision；对应规则出现时不能再 load，
  // 否则会覆盖保存在途期间用户继续输入的媒体草稿。
  if (props.mediaAutosave && next && next.id === form.id) return
  if (
    (!previous && (!dirty.value || saving.value)) ||
    (saving.value && next?.revision !== form.revision)
  )
    load()
})
function save() {
  if (props.busy || conflict.value || !props.snapshot || !props.storeId) return
  const actions =
    props.trigger === 'visitor'
      ? [
          ...(form.text.trim() ? [{ kind: 'welcome-text' as const, text: form.text }] : []),
          ...form.media,
        ]
      : props.trigger === 'unpaid-order'
        ? [{ kind: 'payment-reminder' as const, text: form.text }]
        : [{ kind: 'transfer' as const, agentId: form.agentId }]
  const next = receptionRuleSchema.safeParse({
    id: form.id || globalThis.crypto.randomUUID(),
    storeId: props.storeId,
    enabled: form.enabled,
    trigger: props.trigger,
    actions,
    revision: form.revision,
  })
  if (!next.success) {
    error.value = '请填写有效文字、HTTPS媒体或选择平台可转接客服；欢迎媒体最多四项。'
    return
  }
  if (
    props.trigger === 'transfer-request' &&
    !facts.value?.agents.some(
      (agent) =>
        agent.agentId === form.agentId && (agent.canTransfer === true || agent.online === true),
    )
  ) {
    error.value = '请选择当前平台提供的可转接客服'
    return
  }
  error.value = ''
  saving.value = true
  form.id = next.data.id
  emit('command', { type: 'save-rule', workspaceId: props.workspaceId, rule: next.data })
}
const validPreview = (url: string) => /^https:\/\//i.test(url)
function addMedia() {
  if (!mediaReady.value || (props.busy && !props.mediaOnly) || form.media.length >= 4) return
  form.media.push({ kind: 'welcome-image', url: '' })
  dirty.value = true
}
function removeMedia(index: number) {
  if (!mediaReady.value || (props.busy && !props.mediaOnly)) return
  form.media.splice(index, 1)
  dirty.value = true
  requestMediaAutosave()
}
</script>
<template>
  <section class="reception-rules" :class="{ 'media-only': mediaOnly }">
    <header v-if="!mediaOnly">
      <h2>{{ titles[trigger] }}</h2>
      <button type="button" :disabled="busy" @click="emit('refresh')">刷新真实平台状态</button>
    </header>
    <p v-if="!mediaOnly && !snapshot" role="status">
      接待操作服务尚未接入；当前不能保存规则或执行平台操作。
    </p>
    <p
      v-if="
        !mediaOnly &&
        facts?.error &&
        facts.error !== '读取真实平台能力失败，请打开平台并重新只读采集'
      "
      role="alert"
    >
      {{ facts.error }}
    </p>
    <p
      v-if="
        !mediaOnly &&
        snapshot?.error &&
        snapshot.error !== '读取真实平台能力失败，请打开平台并重新只读采集'
      "
      role="alert"
    >
      {{ snapshot.error }}
    </p>
    <ul v-if="!mediaOnly && capabilities.length" class="capability-list">
      <li v-for="capability in capabilities" :key="capability.kind">
        <span :class="{ available: capability.available }"
          >{{ capabilityLabels[capability.kind] }} ·
          {{ capability.available ? '入口可用' : '暂不可用' }}</span
        >：{{ capability.reason }}
      </li>
    </ul>
    <p v-if="!mediaOnly && facts?.observedAt" class="evidence-time">
      最近平台读取：{{
        new Date(facts.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      }}（北京时间）
    </p>
    <form
      class="rules-form"
      @submit.prevent="submitRule"
      @input="dirty = true"
      @change="dirty = true"
    >
      <label v-if="!mediaOnly" class="enable-rule"
        ><input
          v-model="form.enabled"
          type="checkbox"
          :disabled="busy || !snapshot"
        />启用此规则（只生成待批准事项）</label
      >
      <template v-if="trigger === 'visitor'">
        <p v-if="!mediaOnly">仅响应平台明确报告的无消息访客；不会根据本机空归档推断进店。</p>
        <label v-if="!mediaOnly"
          >欢迎文字<textarea v-model="form.text" rows="4" maxlength="2000" :disabled="busy" />
        </label>
        <div class="media-toolbar">
          <strong>欢迎媒体 {{ form.media.length }}/4</strong
          ><button
            type="button"
            :disabled="!mediaReady || (busy && !mediaOnly) || form.media.length >= 4"
            @click="addMedia"
          >
            添加媒体
          </button>
        </div>
        <article v-for="(media, index) in form.media" :key="index" class="media-row">
          <label
            >媒体类型<select
              v-model="media.kind"
              :disabled="!mediaReady || (busy && !mediaOnly)"
              @change="requestMediaAutosave"
            >
              <option value="welcome-image">图片</option>
              <option value="welcome-video">视频</option>
            </select></label
          ><label v-if="media.kind === 'welcome-image'"
            >HTTPS 媒体地址<input
              v-model="media.url"
              type="url"
              required
              :disabled="!mediaReady || (busy && !mediaOnly)"
              @blur="requestMediaAutosave" /></label
          ><label v-else
            >平台已审核视频素材<select
              v-model="media.url"
              aria-label="平台已审核视频素材"
              required
              :disabled="!mediaReady || (busy && !mediaOnly) || !facts?.mediaAssets?.length"
              @change="requestMediaAutosave"
            >
              <option value="" disabled>请选择平台已审核视频</option>
              <option v-for="asset in facts?.mediaAssets" :key="asset.url" :value="asset.url">
                {{ asset.name }}（{{ (asset.sizeBytes / 1024 / 1024).toFixed(1) }} MB）
              </option>
            </select></label
          ><template v-if="validPreview(media.url)"
            ><img
              v-if="media.kind === 'welcome-image'"
              :src="media.url"
              :alt="`欢迎图片 ${index + 1} 预览`" /><video
              v-else
              :src="media.url"
              controls
              preload="metadata"
              :aria-label="`欢迎视频 ${index + 1} 预览`" /></template
          ><button
            type="button"
            :disabled="!mediaReady || (busy && !mediaOnly)"
            @click="removeMedia(index)"
          >
            移除此媒体
          </button>
        </article>
        <p v-if="!mediaOnly" class="evidence-time">
          预览仅核对内容；批准前主进程仍会验证媒体类型、大小、指纹及对应买家的卖家回显能力。
        </p>
      </template>
      <template v-else-if="trigger === 'unpaid-order'"
        ><p>订单号由可信未付款事件绑定，不在规则中固定。付款、关闭或买家变化会使旧事项失效。</p>
        <label
          >催付备注（不作为聊天消息发送）<textarea
            v-model="form.text"
            rows="4"
            maxlength="2000"
            required
            :disabled="busy"
          />
        </label>
        <details>
          <summary>当前平台订单证据（{{ facts?.orders.length ?? 0 }}）</summary>
          <p v-for="order in facts?.orders" :key="order.orderId">
            {{ order.label }} · {{ order.orderId }} ·
            {{
              order.status === 'unpaid' ? '未付款' : order.status === 'paid' ? '已付款' : '已关闭'
            }}
          </p>
        </details></template
      >
      <template v-else
        ><label
          >真实平台目标客服<select
            v-model="form.agentId"
            :disabled="busy || !facts?.agents.length"
            required
          >
            <option value="" disabled>请选择平台可转接客服</option>
            <option
              v-for="agent in facts?.agents"
              :key="agent.agentId"
              :value="agent.agentId"
              :disabled="agent.canTransfer !== true && agent.online !== true"
            >
              {{ agent.name
              }}{{
                agent.online === true
                  ? '（在线）'
                  : agent.canTransfer === true
                    ? '（平台可转接）'
                    : agent.online === false
                      ? '（离线）'
                      : '（状态未知）'
              }}
            </option>
          </select></label
        >
      </template>
      <p v-if="conflict" role="alert">
        接待规则已在其他窗口更新。
        <button type="button" class="conflict-reload" :disabled="busy" @click="load()">
          使用最新版本重新编辑
        </button>
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="!mediaOnly" class="rules-actions">
        <button type="submit" class="primary" :disabled="busy || !snapshot || conflict">
          保存接待规则</button
        ><button
          v-if="rule"
          type="button"
          :disabled="busy"
          @click="
            emit('command', {
              type: 'remove-rule',
              workspaceId,
              id: rule.id,
              revision: rule.revision,
            })
          "
        >
          删除规则并取消待办
        </button>
      </div>
    </form>
  </section>
</template>
<style scoped>
.reception-rules {
  margin-top: 24px;
  border-top: 1px solid #e6e9ef;
  padding-top: 20px;
  color: #28313f;
}
/* 欢迎媒体嵌在文字欢迎下方右侧：去掉重复章节留白，只保留紧凑编辑/预览。 */
.reception-rules.media-only {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
  min-width: 0;
}
.reception-rules.media-only .rules-form {
  gap: 8px;
}
.reception-rules.media-only .media-toolbar {
  justify-content: flex-end;
}
.reception-rules.media-only .media-row {
  gap: 8px;
  padding: 8px 10px;
  min-width: 0;
}
.reception-rules.media-only .media-row label,
.reception-rules.media-only .media-row input,
.reception-rules.media-only .media-row select {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.reception-rules.media-only .media-row img,
.reception-rules.media-only .media-row video {
  max-height: 120px;
}
header,
.media-toolbar,
.rules-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
h2 {
  margin: 0;
  font-size: 17px;
}
p,
.capability-list {
  font-size: 13px;
  line-height: 1.6;
}
.capability-list {
  padding-left: 18px;
  color: #a06c13;
}
.available {
  color: #299a70;
}
.rules-form {
  display: grid;
  gap: 12px;
}
label {
  display: grid;
  gap: 6px;
}
input,
textarea,
select,
button {
  border: 1px solid #dce1e8;
  border-radius: 7px;
  padding: 9px 12px;
  color: inherit;
  background: #fff;
}
textarea {
  resize: vertical;
}
.enable-rule {
  display: flex;
  align-items: center;
  gap: 8px;
}
.media-row {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e6e9ef;
  border-radius: 8px;
}
.media-row img,
.media-row video {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
}
.conflict-reload {
  padding: 0;
  border: 0;
  color: #3779ed;
  background: transparent;
  text-decoration: underline;
  cursor: pointer;
}
.evidence-time {
  color: #78818e;
  font-size: 12px;
}
.primary {
  background: #6059e8;
  color: white;
  border-color: #6059e8;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
