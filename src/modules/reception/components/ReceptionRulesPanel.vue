<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
}>()
const emit = defineEmits<{ command: [command: ReceptionCommand]; refresh: [] }>()
type Media = { kind: 'welcome-image' | 'welcome-video'; url: string }
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
const facts = computed(() => props.snapshot?.facts.find((row) => row.storeId === props.storeId))
const rule = computed(() =>
  props.snapshot?.rules.find(
    (row) => row.storeId === props.storeId && row.trigger === props.trigger,
  ),
)
const conflict = computed(() =>
  Boolean(rule.value && form.id === rule.value.id && form.revision !== rule.value.revision),
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
function load() {
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
}
watch(
  () => [props.workspaceId, props.storeId, props.trigger],
  () => load(),
  { immediate: true },
)
watch(rule, (next, previous) => {
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
  if (props.busy || form.media.length >= 4) return
  form.media.push({ kind: 'welcome-image', url: '' })
  dirty.value = true
}
function removeMedia(index: number) {
  if (props.busy) return
  form.media.splice(index, 1)
  dirty.value = true
}
</script>
<template>
  <section class="reception-rules">
    <header>
      <h2>{{ titles[trigger] }}</h2>
      <button type="button" :disabled="busy" @click="emit('refresh')">刷新真实平台状态</button>
    </header>
    <p>规则保存不会批准任何平台写操作。每条文字、媒体、催支付或转接都需单独批准。</p>
    <p v-if="!snapshot" role="status">接待操作服务尚未接入；当前不能保存规则或执行平台操作。</p>
    <p v-if="facts?.error" role="alert">{{ facts.error }}</p>
    <p v-if="snapshot?.error" role="alert">{{ snapshot.error }}</p>
    <ul v-if="capabilities.length" class="capability-list">
      <li v-for="capability in capabilities" :key="capability.kind">
        <span :class="{ available: capability.available }"
          >{{ capabilityLabels[capability.kind] }} ·
          {{ capability.available ? '入口可用' : '暂不可用' }}</span
        >：{{ capability.reason }}
      </li>
    </ul>
    <p v-else>尚未取得此店铺的真实能力证据。</p>
    <p v-if="facts?.observedAt" class="evidence-time">
      最近平台读取：{{
        new Date(facts.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      }}（北京时间）
    </p>
    <form class="rules-form" @submit.prevent="save" @input="dirty = true" @change="dirty = true">
      <label class="enable-rule"
        ><input
          v-model="form.enabled"
          type="checkbox"
          :disabled="busy || !snapshot"
        />启用此规则（只生成待批准事项）</label
      >
      <template v-if="trigger === 'visitor'">
        <p>仅响应平台明确报告的无消息访客；不会根据本机空归档推断进店。</p>
        <label
          >欢迎文字<textarea v-model="form.text" rows="4" maxlength="2000" :disabled="busy" />
        </label>
        <div class="media-toolbar">
          <strong>欢迎媒体 {{ form.media.length }}/4</strong
          ><button type="button" :disabled="busy || form.media.length >= 4" @click="addMedia">
            添加媒体
          </button>
        </div>
        <article v-for="(media, index) in form.media" :key="index" class="media-row">
          <label
            >媒体类型<select v-model="media.kind" :disabled="busy">
              <option value="welcome-image">图片</option>
              <option value="welcome-video">视频</option>
            </select></label
          ><label v-if="media.kind === 'welcome-image'"
            >HTTPS 媒体地址<input v-model="media.url" type="url" required :disabled="busy" /></label
          ><label v-else
            >平台已审核视频素材<select
              v-model="media.url"
              aria-label="平台已审核视频素材"
              required
              :disabled="busy || !facts?.mediaAssets?.length"
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
          ><button type="button" :disabled="busy" @click="removeMedia(index)">移除此媒体</button>
        </article>
        <p class="evidence-time">
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
        <p>执行前会再次核对平台可转接名单和目标买家。</p></template
      >
      <p v-if="conflict" role="alert">接待规则已在其他窗口更新。请载入最新配置后再保存。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="rules-actions">
        <button type="submit" class="primary" :disabled="busy || !snapshot || conflict">
          保存接待规则</button
        ><button type="button" :disabled="busy" @click="load">载入最新接待规则</button
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
