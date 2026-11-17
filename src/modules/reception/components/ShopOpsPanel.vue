<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { useReceptionOperations } from '../services/operations'
import OperationApprovalPanel from './OperationApprovalPanel.vue'
import ReceptionRulesPanel from './ReceptionRulesPanel.vue'
import { useReceptionDraftCache, type ReceptionSettingsDraft } from '../draft-cache'
const props = withDefaults(
  defineProps<{ viewKey?: string; storeId?: string; embedded?: boolean }>(),
  { viewKey: 'transfer', storeId: '', embedded: false },
)
const emit = defineEmits<{ busy: [value: boolean] }>()
const runtime = useRuntimeStore(),
  task = useTask(),
  router = useRouter()
const drafts = props.embedded ? useReceptionDraftCache() : undefined
let draftLease = {
  workspaceId: runtime.snapshot.workspaceId,
  storeId: props.storeId,
  view: props.viewKey,
}
const selectedStoreId = computed(() => props.storeId || runtime.selectedStoreId)
const titles: Record<string, string> = {
  transfer: '转接人工',
  welcome: '进店欢迎',
  auto: '自动操作',
  image: '图片识别',
}
const title = computed(() => titles[props.viewKey] || '接待配置')
const operations = useReceptionOperations(() => runtime.snapshot.workspaceId)
watch(
  () => task.pending.value || operations.busy.value,
  (value) => emit('busy', value),
  { immediate: true },
)
const ruleTrigger = computed(() =>
  props.viewKey === 'welcome'
    ? ('visitor' as const)
    : props.viewKey === 'transfer'
      ? ('transfer-request' as const)
      : ('unpaid-order' as const),
)
const rulesExpanded = ref(false)
const operationError = computed(() =>
  [
    ...new Set(
      [
        operations.error.value,
        operations.snapshot.value?.error,
        operations.snapshot.value?.facts.find((row) => row.storeId === selectedStoreId.value)
          ?.error,
      ].filter(
        (message) => message && message !== '读取真实平台能力失败，请打开平台并重新只读采集',
      ),
    ),
  ].join('；'),
)
const selectedRuns = computed(
  () =>
    operations.snapshot.value?.runs.filter((run) => run.storeId === selectedStoreId.value) ?? [],
)
const activeRuns = computed(() =>
  selectedRuns.value.filter((run) =>
    ['pending', 'uncertain', 'blocked', 'executing'].includes(run.state),
  ),
)
const historyRuns = computed(() =>
  selectedRuns.value.filter(
    (run) => !['pending', 'uncertain', 'blocked', 'executing'].includes(run.state),
  ),
)
const welcome = ref({ text: '', enabled: false, version: 0 }),
  vision = ref({ enabled: false, version: 0 })
const inherited = ref(true),
  keywords = ref(''),
  globalKeywords = ref(''),
  fallbackEnabled = ref(false),
  fallbackSeconds = ref(15),
  fallbackText = ref('')
const cached = new Map<string, { text: string; enabled: boolean; version: number }>()
watch(
  welcome,
  (value) => {
    if (selectedStoreId.value) cached.set(selectedStoreId.value, { ...value })
  },
  { deep: true },
)
let baseline: ReceptionSettingsDraft = {}
function load(restoreDraft = false) {
  const id = selectedStoreId.value,
    snap = runtime.snapshot
  welcome.value = {
    ...(cached.get(id) || snap.welcomeByStore[id] || { text: '', enabled: false, version: 0 }),
  }
  vision.value = { ...(snap.visionByStore[id] || { enabled: false, version: 0 }) }
  inherited.value = !snap.handoffByStore[id]
  keywords.value = snap.handoffByStore[id]?.keywords.join('\n') || ''
  globalKeywords.value = snap.config.safety.handoffKeywords.join('\n')
  fallbackEnabled.value = snap.config.reply.fallbackAfterMs > 0
  fallbackSeconds.value = Math.max(1, snap.config.reply.fallbackAfterMs / 1000 || 15)
  fallbackText.value = snap.config.reply.fallbackText
  draftLease = { workspaceId: snap.workspaceId, storeId: id, view: props.viewKey }
  baseline = {
    welcome: { ...welcome.value },
    inherited: inherited.value,
    keywords: keywords.value,
    globalKeywords: globalKeywords.value,
  }
  const previous = restoreDraft
    ? drafts?.getSettings(snap.workspaceId, id, props.viewKey)
    : undefined
  if (previous) {
    if (previous.welcome) welcome.value = { ...previous.welcome }
    if (previous.inherited !== undefined) inherited.value = previous.inherited
    if (previous.keywords !== undefined) keywords.value = previous.keywords
    if (previous.globalKeywords !== undefined) globalKeywords.value = previous.globalKeywords
  }
}
onBeforeUnmount(() => {
  drafts?.putSettings(draftLease.workspaceId, draftLease.storeId, draftLease.view, {
    ...(JSON.stringify(welcome.value) !== JSON.stringify(baseline.welcome)
      ? { welcome: { ...welcome.value } }
      : {}),
    ...(inherited.value !== baseline.inherited ? { inherited: inherited.value } : {}),
    ...(keywords.value !== baseline.keywords ? { keywords: keywords.value } : {}),
    ...(globalKeywords.value !== baseline.globalKeywords
      ? { globalKeywords: globalKeywords.value }
      : {}),
  })
})
watch(
  [() => selectedStoreId.value, () => props.viewKey, () => runtime.snapshot.workspaceId],
  () => load(true),
  { immediate: true },
)
const welcomeConflict = computed(
  () =>
    welcome.value.version !==
    (runtime.snapshot.welcomeByStore[selectedStoreId.value]?.version || 0),
)
const visionConflict = computed(
  () =>
    vision.value.version !== (runtime.snapshot.visionByStore[selectedStoreId.value]?.version || 0),
)
const lines = (text: string) => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
]
async function save() {
  const storeId = selectedStoreId.value,
    key = props.viewKey
  await task.run(async () => {
    let result
    if (key === 'welcome')
      result = await runtime.run({ action: 'save-welcome', storeId, values: { ...welcome.value } })
    else if (key === 'image')
      result = await runtime.run({
        action: 'save-vision-settings',
        storeId,
        values: { ...vision.value },
      })
    else if (key === 'auto')
      result = await runtime.run({
        action: 'save-automation-fallback',
        values: {
          enabled: fallbackEnabled.value,
          seconds: fallbackSeconds.value,
          text: fallbackText.value,
        },
      })
    else
      result = await runtime.run({
        action: 'save-store-handoff',
        storeId,
        values: inherited.value
          ? { mode: 'inherit' }
          : { mode: 'custom', keywords: lines(keywords.value) },
      })
    if (storeId === selectedStoreId.value && key === props.viewKey) {
      cached.delete(storeId)
      load()
      task.message.value = result.message
    }
  })
}
async function saveGlobal() {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'save-config',
      screenId: 'UX08',
      values: { handoffKeywords: lines(globalKeywords.value) },
    })
    baseline.globalKeywords = globalKeywords.value
    task.message.value = result.message
  })
}
</script>
<template>
  <RuntimePanel
    :title="viewKey === 'transfer' ? '' : title"
    :aria-label="title"
    :class="{ 'embedded-reception': embedded }"
    :description="
      embedded || viewKey === 'transfer' ? '' : '配置独立保存；保存不会自动开启店铺 AI 接待。'
    "
    :error="task.error.value"
    :message="task.message.value"
  >
    <StoreSelect v-if="!embedded" :disabled="task.pending.value" />
    <p v-if="viewKey !== 'auto' && !selectedStoreId">请先在店铺与商品中添加店铺。</p>
    <form v-if="selectedStoreId || viewKey === 'auto'" class="runtime-form" @submit.prevent="save">
      <template v-if="viewKey === 'welcome'"
        ><p>
          此配置在新会话首次 AI
          正文中附加文字欢迎，与正文合并批准。下方独立规则处理可信无消息访客及图片、视频，各项分别批准。
        </p>
        <el-alert
          v-if="welcomeConflict"
          title="配置已更新，当前草稿仍保留。请载入最新配置后再保存。"
          type="warning"
          :closable="false" /><el-switch
          v-model="welcome.enabled"
          active-text="启用本店新会话欢迎"
          :disabled="task.pending.value || welcomeConflict" /><label
          >文字欢迎语<el-input
            v-model="welcome.text"
            type="textarea"
            :rows="embedded ? 3 : 5"
            maxlength="200"
            show-word-limit
            aria-label="文字欢迎语"
            :disabled="task.pending.value" /></label
      ></template>
      <template v-else-if="viewKey === 'image'"
        ><p>{{ runtime.snapshot.capabilities.vision.reason }}</p>
        <p>
          每轮最多 4 张公网 HTTPS
          图片。模型收到实际图片输入；不支持本地图片上传，也不会把图片链接当作图像内容猜测。
        </p>
        <el-alert
          v-if="visionConflict"
          title="识图配置已更新，请载入最新配置后再保存。"
          type="warning"
          :closable="false"
        /><el-switch
          v-model="vision.enabled"
          active-text="启用本店图片识别"
          :disabled="
            task.pending.value ||
            visionConflict ||
            (!runtime.snapshot.capabilities.vision.supported && !vision.enabled)
          "
        /><el-button @click="router.push('/shop/manage?panel=training')"
          >到训练场测试识图</el-button
        ></template
      >
      <template v-else-if="viewKey === 'auto'"
        ><p>
          此处保留全局 AI 回复超时配置；逐条批准模式不自动发送兜底消息。下方可配置本店平台催付规则。
        </p>
        <el-switch
          v-model="fallbackEnabled"
          active-text="启用回复超时兜底"
          :disabled="task.pending.value" /><label
          >等待秒数<el-input-number
            v-model="fallbackSeconds"
            :min="1"
            :max="120"
            :precision="0" /></label
        ><label
          >兜底话术<el-input
            v-model="fallbackText"
            type="textarea"
            maxlength="500"
            :rows="4" /></label
      ></template>
      <template v-else>
        <el-switch
          v-model="inherited"
          active-text="继承全局关键词"
          :disabled="task.pending.value" /><label v-if="!inherited"
          >本店关键词（每行一个）<el-input
            v-model="keywords"
            type="textarea"
            :rows="embedded ? 3 : 6" /></label
      ></template>
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="task.pending.value"
          :disabled="
            !runtime.available ||
            (viewKey === 'welcome' && welcomeConflict) ||
            (viewKey === 'image' && visionConflict)
          "
          >保存配置</el-button
        ><el-button
          v-if="viewKey !== 'transfer'"
          :disabled="task.pending.value"
          @click="
            () => {
              cached.delete(selectedStoreId)
              load()
            }
          "
          >载入最新配置</el-button
        >
      </div>
    </form>
    <component
      :is="embedded ? 'details' : 'div'"
      v-if="viewKey === 'transfer'"
      class="reception-advanced"
    >
      <summary v-if="embedded">全局人工关键词 <span>影响所有继承全局配置的店铺</span></summary>
      <form class="runtime-form" @submit.prevent="saveGlobal">
        <h2 v-if="!embedded">全局人工处理关键词</h2>
        <el-input
          v-model="globalKeywords"
          type="textarea"
          :rows="5"
          aria-label="全局人工处理关键词"
        /><el-button :disabled="!runtime.available || task.pending.value" native-type="submit"
          >保存全局关键词</el-button
        >
      </form>
    </component>
    <p v-if="embedded && operationError" class="reception-visible-error" role="alert">
      {{ operationError }}
    </p>
    <p
      v-if="embedded && viewKey !== 'image' && !operations.snapshot.value"
      class="reception-empty"
      role="status"
    >
      平台接待服务尚未接入，当前不能保存平台规则或执行平台操作。
    </p>
    <component
      :is="embedded && viewKey !== 'welcome' ? 'details' : 'div'"
      v-if="viewKey !== 'image' && selectedStoreId"
      class="reception-advanced"
      :open="embedded && rulesExpanded"
    >
      <summary v-if="embedded && viewKey !== 'welcome'">
        平台接待规则与能力 <span>高级设置 · 逐项批准</span>
      </summary>
      <ReceptionRulesPanel
        v-if="viewKey !== 'image' && selectedStoreId"
        :workspace-id="runtime.snapshot.workspaceId"
        :store-id="selectedStoreId"
        :trigger="ruleTrigger"
        :preserve-draft="embedded"
        :media-only="embedded && viewKey === 'welcome'"
        :snapshot="operations.snapshot.value"
        :busy="operations.busy.value"
        @alert="rulesExpanded = true"
        @command="operations.execute"
        @refresh="
          operations.execute({ type: 'refresh', workspaceId: runtime.snapshot.workspaceId })
        "
      />
    </component>
    <p v-if="!embedded && operations.error.value" role="alert">{{ operations.error.value }}</p>
    <OperationApprovalPanel
      v-if="viewKey !== 'image' && operations.snapshot.value && (!embedded || activeRuns.length)"
      :workspace-id="runtime.snapshot.workspaceId"
      :store-id="selectedStoreId"
      :runs="embedded ? activeRuns : operations.snapshot.value.runs"
      :busy="operations.busy.value"
      @command="operations.execute"
    />
    <details
      v-if="embedded && viewKey !== 'image' && historyRuns.length"
      class="reception-advanced"
    >
      <summary>
        历史平台操作 <span>{{ historyRuns.length }} 项</span>
      </summary>
      <OperationApprovalPanel
        :workspace-id="runtime.snapshot.workspaceId"
        :store-id="selectedStoreId"
        :runs="historyRuns"
        :busy="operations.busy.value"
        @command="operations.execute"
      />
    </details>
    <p v-if="embedded && viewKey !== 'image' && !selectedRuns.length" class="reception-empty">
      暂无平台操作事项
    </p>
  </RuntimePanel>
</template>

<style scoped>
.embedded-reception {
  padding: 16px;
  min-height: 0;
  height: auto;
  overflow: visible;
  border: 1px solid #e5e9f0;
  border-radius: 8px;
}
.embedded-reception :deep(.runtime-page__head) {
  margin-bottom: 12px;
}
.embedded-reception :deep(.runtime-page__head h1) {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
}
.embedded-reception .runtime-form {
  max-width: none;
  gap: 12px;
  margin: 0;
}
.embedded-reception .runtime-form > p {
  margin: 0;
  color: #78869a;
  font-size: 12px;
  line-height: 1.6;
}
.embedded-reception .runtime-actions {
  gap: 8px;
  flex-wrap: wrap;
}
.embedded-reception .reception-advanced {
  margin-top: 12px;
  border-top: 1px solid #edf0f5;
}
.embedded-reception summary {
  box-sizing: border-box;
  min-height: 38px;
  padding: 9px 0;
  color: #4a5d76;
  font-size: 13px;
  cursor: pointer;
}
.embedded-reception summary span {
  margin-left: 8px;
  color: #94a0b1;
  font-size: 12px;
}
.embedded-reception summary:focus-visible {
  outline: 2px solid #3779ed;
  outline-offset: 2px;
}
.embedded-reception :deep(.reception-rules) {
  margin-top: 0;
  padding-top: 8px;
  border-top: 0;
}
.embedded-reception :deep(.reception-rules h2),
.embedded-reception :deep(.approval-head h2) {
  font-size: 16px;
}
.embedded-reception .reception-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: #98a3b2;
}
.embedded-reception .reception-visible-error {
  margin: 12px 0 0;
  font-size: 13px;
  color: #c45656;
  overflow-wrap: anywhere;
}
</style>
