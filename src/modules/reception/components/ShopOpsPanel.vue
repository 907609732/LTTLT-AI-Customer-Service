<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { useReceptionOperations } from '../services/operations'
import OperationApprovalPanel from './OperationApprovalPanel.vue'
import ReceptionRulesPanel from './ReceptionRulesPanel.vue'
const props = withDefaults(defineProps<{ viewKey?: string }>(), { viewKey: 'transfer' })
const runtime = useRuntimeStore(),
  task = useTask(),
  router = useRouter()
const titles: Record<string, string> = {
  transfer: '转接人工',
  welcome: '进店欢迎',
  auto: '自动操作',
  image: '图片识别',
}
const title = computed(() => titles[props.viewKey] || '接待配置')
const operations = useReceptionOperations(() => runtime.snapshot.workspaceId)
const ruleTrigger = computed(() =>
  props.viewKey === 'welcome'
    ? ('visitor' as const)
    : props.viewKey === 'transfer'
      ? ('transfer-request' as const)
      : ('unpaid-order' as const),
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
    if (runtime.selectedStoreId) cached.set(runtime.selectedStoreId, { ...value })
  },
  { deep: true },
)
function load() {
  const id = runtime.selectedStoreId,
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
}
watch(
  [() => runtime.selectedStoreId, () => props.viewKey, () => runtime.snapshot.workspaceId],
  load,
  { immediate: true },
)
const welcomeConflict = computed(
  () =>
    welcome.value.version !==
    (runtime.snapshot.welcomeByStore[runtime.selectedStoreId]?.version || 0),
)
const visionConflict = computed(
  () =>
    vision.value.version !==
    (runtime.snapshot.visionByStore[runtime.selectedStoreId]?.version || 0),
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
  const storeId = runtime.selectedStoreId,
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
    if (storeId === runtime.selectedStoreId && key === props.viewKey) {
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
    task.message.value = result.message
  })
}
</script>
<template>
  <RuntimePanel
    :title="title"
    description="配置独立保存；保存不会自动开启店铺 AI 接待。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <StoreSelect :disabled="task.pending.value" />
    <p v-if="viewKey !== 'auto' && !runtime.selectedStoreId">请先在店铺与商品中添加店铺。</p>
    <form
      v-if="runtime.selectedStoreId || viewKey === 'auto'"
      class="runtime-form"
      @submit.prevent="save"
    >
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
            :rows="5"
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
      <template v-else
        ><p>
          关键词命中后标记并暂停本会话 AI。下方可选择真实平台目标客服并配置逐项批准的转接规则。
        </p>
        <el-switch
          v-model="inherited"
          active-text="继承全局关键词"
          :disabled="task.pending.value" /><label v-if="!inherited"
          >本店关键词（每行一个）<el-input v-model="keywords" type="textarea" :rows="6" /></label
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
          :disabled="task.pending.value"
          @click="
            () => {
              cached.delete(runtime.selectedStoreId)
              load()
            }
          "
          >载入最新配置</el-button
        >
      </div>
    </form>
    <form v-if="viewKey === 'transfer'" class="runtime-form" @submit.prevent="saveGlobal">
      <h2>全局人工处理关键词</h2>
      <el-input
        v-model="globalKeywords"
        type="textarea"
        :rows="5"
        aria-label="全局人工处理关键词"
      /><el-button :disabled="!runtime.available || task.pending.value" native-type="submit"
        >保存全局关键词</el-button
      >
    </form>
    <ReceptionRulesPanel
      v-if="viewKey !== 'image' && runtime.selectedStoreId"
      :workspace-id="runtime.snapshot.workspaceId"
      :store-id="runtime.selectedStoreId"
      :trigger="ruleTrigger"
      :snapshot="operations.snapshot.value"
      :busy="operations.busy.value"
      @command="operations.execute"
      @refresh="operations.execute({ type: 'refresh', workspaceId: runtime.snapshot.workspaceId })"
    />
    <p v-if="operations.error.value" role="alert">{{ operations.error.value }}</p>
    <OperationApprovalPanel
      v-if="viewKey !== 'image' && operations.snapshot.value"
      :workspace-id="runtime.snapshot.workspaceId"
      :store-id="runtime.selectedStoreId"
      :runs="operations.snapshot.value.runs"
      :busy="operations.busy.value"
      @command="operations.execute"
    />
  </RuntimePanel>
</template>
