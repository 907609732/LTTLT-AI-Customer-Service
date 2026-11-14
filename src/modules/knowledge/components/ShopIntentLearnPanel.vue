<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import {
  platformLearningSnapshotSchema,
  type PlatformLearningSnapshot,
  type PlatformLearningTask,
} from '@/shared/contracts/platform-learning'
import { chatCandidates, documentCandidates, type LearningCandidate } from '../learning'
import LearningReview from './LearningReview.vue'
import { createLearningService } from '../services'
import { platformLearningTransportKey } from '../platform-learning'
const props = defineProps<{ viewKey?: string; sourceKey?: unknown }>()
const emit = defineEmits<{ returnProducts: [] }>()
const runtime = useRuntimeStore(),
  task = useTask(),
  service = createLearningService(runtime.run),
  transport = inject(platformLearningTransportKey, null)
const source = ref<'local' | 'products' | 'chats'>(
    props.sourceKey === 'products' ? 'products' : props.sourceKey === 'chats' ? 'chats' : 'local',
  ),
  rows = ref<LearningCandidate[]>([]),
  label = ref(''),
  document = ref(''),
  scope = ref(''),
  platformState = ref<PlatformLearningSnapshot | null>(null),
  refreshError = ref(''),
  from = ref(''),
  to = ref(''),
  maxPages = ref(5),
  maxRecords = ref(100),
  productStatus = ref<'all' | 'on-sale' | 'off-sale'>('all')
watch(
  () => props.sourceKey,
  (value) => {
    source.value = value === 'products' || value === 'chats' ? value : 'local'
  },
)
const emptyRows: LearningCandidate[] = []
const localRows = computed(() => (source.value === 'local' ? rows.value : emptyRows))
const platformTasks = computed(
  () => platformState.value?.tasks.filter((row) => row.source === source.value) ?? [],
)
const platformCandidates = computed(
  () => platformState.value?.candidates.filter((row) => row.source === source.value) ?? [],
)
let refreshTicket = 0,
  disposed = false,
  refreshing = false
function acceptPlatformSnapshot(value: PlatformLearningSnapshot) {
  const next = platformLearningSnapshotSchema.parse(value)
  if (next.workspaceId !== runtime.snapshot.workspaceId) return
  const storeId = runtime.selectedStoreId
  platformState.value = {
    ...next,
    tasks: next.tasks.filter((row) => row.identity.storeId === storeId),
    candidates: next.candidates.filter((row) => row.identity.storeId === storeId),
  }
  refreshError.value = ''
}
async function refreshPlatform() {
  if (
    !transport ||
    refreshing ||
    disposed ||
    !runtime.snapshot.workspaceId ||
    !runtime.selectedStoreId
  )
    return
  const workspaceId = runtime.snapshot.workspaceId,
    storeId = runtime.selectedStoreId,
    ticket = ++refreshTicket
  refreshing = true
  try {
    const next = await transport.snapshot({ workspaceId, storeId })
    if (
      !disposed &&
      ticket === refreshTicket &&
      workspaceId === runtime.snapshot.workspaceId &&
      storeId === runtime.selectedStoreId
    )
      acceptPlatformSnapshot(next)
  } catch (cause) {
    if (!disposed && ticket === refreshTicket)
      refreshError.value = cause instanceof Error ? cause.message : '任务读取失败，请刷新重试'
  } finally {
    refreshing = false
  }
}
watch(
  [() => runtime.selectedStoreId, () => runtime.snapshot.workspaceId],
  () => {
    refreshTicket++
    rows.value = []
    scope.value = ''
    platformState.value = null
    refreshError.value = ''
    task.message.value = ''
    void refreshPlatform()
  },
  { immediate: true },
)
watch(source, () => {
  if (source.value !== 'local') void refreshPlatform()
})
const unsubscribe = transport?.subscribe?.(() => {
  void refreshPlatform()
})
// Progress survives navigation in the service; the page only polls its current workspace lease.
const timer = transport
  ? setInterval(() => {
      if (source.value !== 'local') void refreshPlatform()
    }, 2000)
  : undefined
onBeforeUnmount(() => {
  disposed = true
  refreshTicket++
  clearInterval(timer)
  unsubscribe?.()
})
function fromChat() {
  void task.run(async () => {
    rows.value = []
    if (!runtime.selectedStoreId) throw new Error('请先选择店铺')
    rows.value = chatCandidates(runtime.selectedStoreId, runtime.snapshot.conversations)
    scope.value = '仅当前本机快照，最多 100 组相邻文字；不代表完整历史，客服回复仍须人工核对。'
  })
}
function fromDocument() {
  rows.value = []
  void task.run(async () => {
    if (!runtime.selectedStoreId) throw new Error('请先选择店铺')
    rows.value = documentCandidates(runtime.selectedStoreId, label.value, document.value)
    scope.value = '来源为手工粘贴文本；不读取文件、不执行文档指令，也不自动调用付费模型。'
  })
}
function fromProducts() {
  rows.value = []
  const storeId = runtime.selectedStoreId,
    workspace = runtime.snapshot.workspaceId
  void task.run(async () => {
    if (!storeId) throw new Error('请先选择店铺')
    const result = await service.products(storeId)
    if (runtime.selectedStoreId !== storeId || runtime.snapshot.workspaceId !== workspace) return
    rows.value = result.candidates
    scope.value = `本机商品资料 ${result.loaded}/${result.total} 条，仅整理有规格的启用商品，最多 100 条；没有发起实店采集。`
  })
}
function openPlatformSource() {
  void task.run(async () => {
    if (!transport?.openSource || source.value === 'local')
      throw Error('平台原页入口尚未就绪，请刷新后重试')
    await transport.openSource({
      workspaceId: runtime.snapshot.workspaceId,
      storeId: runtime.selectedStoreId,
      source: source.value,
    })
  })
}
function startPlatform() {
  void task.run(async () => {
    if (!transport) throw Error('平台学习服务尚未就绪，请在桌面端刷新后重试')
    if (source.value === 'local') return
    if (!runtime.selectedStoreId) throw Error('请先选择店铺')
    if (source.value === 'chats' && (!from.value || !to.value || from.value > to.value))
      throw Error('请明确选择顺序正确的聊天起止日期')
    const workspaceId = runtime.snapshot.workspaceId,
      storeId = runtime.selectedStoreId
    const next = await transport.start({
      workspaceId,
      storeId,
      source: source.value,
      range: {
        maxPages: maxPages.value,
        maxRecords: maxRecords.value,
        productStatus: productStatus.value,
        ...(source.value === 'chats' ? { from: from.value, to: to.value } : {}),
      },
    })
    if (workspaceId === runtime.snapshot.workspaceId && storeId === runtime.selectedStoreId)
      acceptPlatformSnapshot(next)
  })
}
function controlPlatform(row: PlatformLearningTask, action: 'pause' | 'resume' | 'cancel') {
  void task.run(async () => {
    if (!transport) throw Error('平台学习服务尚未就绪，请刷新后重试')
    const workspaceId = runtime.snapshot.workspaceId,
      storeId = runtime.selectedStoreId
    const next = await transport[action]({ workspaceId, taskId: row.id })
    if (workspaceId === runtime.snapshot.workspaceId && storeId === runtime.selectedStoreId)
      acceptPlatformSnapshot(next)
  })
}
const statusLabels: Record<PlatformLearningTask['status'], string> = {
  running: '采集中',
  paused: '已暂停',
  completed: '采集结束',
  failed: '采集失败',
  cancelled: '已取消',
}
</script>
<template>
  <RuntimePanel
    :title="
      source === 'products'
        ? '平台商品采集与审核'
        : source === 'chats'
          ? '平台聊天采集与审核'
          : '资料与聊天转意图'
    "
    description="选择来源与范围 → 采集或预览 → 人工审核 → 保存停用知识包。启用后才参与接待。"
    :error="task.error.value || refreshError"
  >
    <template v-if="source === 'products'" #actions
      ><el-button @click="emit('returnProducts')">返回商品知识</el-button></template
    >
    <div class="runtime-toolbar">
      <StoreSelect label="学习店铺" :disabled="task.pending.value" />
      <label
        >学习来源
        <el-select v-model="source" aria-label="学习来源" :disabled="task.pending.value">
          <el-option value="local" label="本机已有资料" />
          <el-option value="products" label="平台商品" />
          <el-option value="chats" label="平台聊天" />
        </el-select>
      </label>
    </div>
    <template v-if="source === 'local'">
      <div class="runtime-toolbar">
        <el-button :disabled="!runtime.available || task.pending.value" @click="fromChat"
          >预览已采集聊天</el-button
        >
        <el-button :disabled="!runtime.available || task.pending.value" @click="fromProducts"
          >预览本机商品规格</el-button
        >
      </div>
      <details class="runtime-card">
        <summary>粘贴文档问答</summary>
        <div class="runtime-form">
          <label
            >来源名称<el-input
              v-model="label"
              maxlength="200"
              placeholder="如：2026-11 发货规则.txt"
          /></label>
          <label
            >问答文本<el-input
              v-model="document"
              type="textarea"
              :rows="6"
              maxlength="100000"
              placeholder="问：多久发货？&#10;答：以审核后的店铺规则填写。"
          /></label>
          <p>支持明确的“问：/答：”文本。PDF、Word、OCR 和任意文章自动摘要尚未接入。</p>
          <el-button :disabled="!runtime.available || task.pending.value" @click="fromDocument"
            >预览文档候选</el-button
          >
        </div>
      </details>
      <p v-if="scope" role="status">{{ scope }} 共 {{ rows.length }} 条候选。</p>
    </template>
    <template v-else>
      <p>
        从本店已登录的平台页面主动读取。只整理实际取得的文字；采集范围受平台可访问页面和本次上限限制。
      </p>
      <p v-if="!transport" role="status">平台学习服务尚未就绪；请在桌面端刷新后重试。</p>
      <div class="runtime-card learning-range">
        <label v-if="source === 'products'"
          >商品状态
          <el-select
            v-model="productStatus"
            aria-label="采集商品状态"
            :disabled="task.pending.value"
          >
            <el-option value="all" label="全部状态" /><el-option
              value="on-sale"
              label="在售"
            /><el-option value="off-sale" label="已下架" />
          </el-select>
        </label>
        <template v-else>
          <label
            >聊天开始日期（北京时间）<el-input
              v-model="from"
              type="date"
              aria-label="聊天开始日期"
              :disabled="task.pending.value"
          /></label>
          <label
            >聊天结束日期（北京时间）<el-input
              v-model="to"
              type="date"
              aria-label="聊天结束日期"
              :disabled="task.pending.value"
          /></label>
        </template>
        <label
          >最多页数<el-input-number
            v-model="maxPages"
            aria-label="采集最多页数"
            :min="1"
            :max="1000"
            :disabled="task.pending.value"
        /></label>
        <label
          >最多来源记录<el-input-number
            v-model="maxRecords"
            aria-label="采集最多来源记录"
            :min="1"
            :max="10000"
            :disabled="task.pending.value"
        /></label>
      </div>
      <div class="runtime-toolbar">
        <el-button
          type="primary"
          :disabled="
            !runtime.available || !transport || task.pending.value || !runtime.selectedStoreId
          "
          @click="startPlatform"
          >开始采集</el-button
        >
        <el-button
          :disabled="!transport?.openSource || task.pending.value || !runtime.selectedStoreId"
          @click="openPlatformSource"
          >打开平台原页</el-button
        >
        <el-button :disabled="!transport || task.pending.value" @click="refreshPlatform"
          >刷新任务</el-button
        >
      </div>
      <article v-for="row in platformTasks" :key="row.id" class="runtime-card learning-task">
        <strong
          >{{ row.source === 'products' ? '平台商品' : '平台聊天' }} ·
          {{ statusLabels[row.status] }}</strong
        >
        <p>
          已保存 {{ row.pages }} 页 · {{ row.records }} 条来源记录<span
            v-if="row.total !== undefined"
          >
            / 平台声明 {{ row.total }} 条</span
          >
          · 新候选 {{ row.candidates }} · 重复 {{ row.duplicates }} · 跳过 {{ row.skipped }}
        </p>
        <p>
          范围：{{ row.scope || '等待平台返回实际范围' }} ·
          {{ row.coverage === 'range-complete' ? '已读完所声明的可访问范围' : '部分范围' }}
        </p>
        <p v-if="row.range.from">
          所选日期：{{ row.range.from }} 至 {{ row.range.to }}（北京时间）
        </p>
        <p>{{ row.reason }}</p>
        <p v-if="row.error" role="alert">{{ row.error }}</p>
        <div class="runtime-toolbar">
          <el-button
            v-if="row.status === 'running'"
            :disabled="task.pending.value"
            @click="controlPlatform(row, 'pause')"
            >暂停</el-button
          >
          <el-button
            v-if="row.status === 'paused' || row.status === 'failed'"
            :disabled="task.pending.value"
            @click="controlPlatform(row, 'resume')"
            >{{ row.status === 'failed' ? '重试' : '继续' }}</el-button
          >
          <el-button
            v-if="!['completed', 'cancelled'].includes(row.status)"
            :disabled="task.pending.value"
            @click="controlPlatform(row, 'cancel')"
            >取消任务</el-button
          >
        </div>
      </article>
      <p v-if="!platformTasks.length">
        本店暂无此来源的采集任务。开始后任务、进度和候选会保留；重启后需要手动继续。
      </p>
      <p>
        候选保存为停用知识包后，请在“意图问法与知识包”单独启用。采集和审核不会开启 AI 或向买家发送。
      </p>
    </template>
    <LearningReview
      :candidates="localRows"
      :platform-candidates="platformCandidates"
      @platform-updated="acceptPlatformSnapshot"
    />
  </RuntimePanel>
</template>
<style scoped>
.learning-range {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.learning-range label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.learning-range :deep(.el-select) {
  min-width: 160px;
}
.learning-task {
  overflow-wrap: anywhere;
}
</style>
