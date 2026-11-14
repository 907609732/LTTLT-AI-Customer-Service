<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { createLearningService } from '../services'
import type { LearningCandidate } from '../learning'
import type {
  PlatformLearningCandidate,
  PlatformLearningSnapshot,
} from '@/shared/contracts/platform-learning'
import { platformLearningTransportKey } from '../platform-learning'
const props = withDefaults(
  defineProps<{
    candidates: LearningCandidate[]
    platformCandidates?: PlatformLearningCandidate[]
  }>(),
  { platformCandidates: () => [] },
)
const emit = defineEmits<{ platformUpdated: [snapshot: PlatformLearningSnapshot] }>()
type ReviewRow = LearningCandidate & { platform?: PlatformLearningCandidate }
const runtime = useRuntimeStore(),
  task = useTask(),
  service = createLearningService(runtime.run),
  platformTransport = inject(platformLearningTransportKey, null)
const rows = computed<ReviewRow[]>(() => [
  ...props.candidates,
  ...props.platformCandidates.map((row) => ({
    question: row.question,
    answer: row.answer,
    original: row.original,
    productIds: row.productIds,
    source: {
      kind: `platform-${row.source}` as 'platform-products' | 'platform-chats',
      ...row.identity,
      taskId: row.taskId,
      candidateId: row.id,
      ...row.evidence,
    },
    platform: row,
  })),
])
const selected = ref<ReviewRow | null>(null),
  question = ref(''),
  answer = ref(''),
  approved = ref(false)
const saved = ref<LearningCandidate[]>([])
watch(
  [() => props.candidates, () => runtime.selectedStoreId, () => runtime.snapshot.workspaceId],
  () => {
    selected.value = null
    approved.value = false
    saved.value = []
    task.message.value = ''
  },
)
watch(
  () => props.platformCandidates,
  (next) => {
    const current = selected.value?.platform
    if (
      current &&
      !next.some(
        (row) =>
          row.id === current.id &&
          (row.status === 'pending' ||
            (task.pending.value && (row.status === 'saving' || row.status === 'saved'))),
      )
    ) {
      selected.value = null
      approved.value = false
    }
  },
)
watch([question, answer], () => {
  approved.value = false
})
function preview(row: ReviewRow) {
  selected.value = row
  question.value = row.platform?.reviewed?.question ?? row.question
  answer.value = row.platform?.reviewed?.answer ?? row.answer
  approved.value = false
  task.error.value = ''
  task.message.value = ''
}
async function save() {
  await task.run(async () => {
    const row = selected.value
    if (!row || row.source.storeId !== runtime.selectedStoreId)
      throw new Error('候选店铺已变化，请重新预览')
    const workspace = runtime.snapshot.workspaceId
    if (row.platform) {
      if (!platformTransport) throw new Error('平台学习服务尚未就绪，请刷新后重试')
      const next = await platformTransport.review({
        workspaceId: workspace,
        candidateId: row.platform.id,
        question: question.value,
        answer: answer.value,
        confirmed: approved.value,
      })
      if (workspace !== runtime.snapshot.workspaceId || row !== selected.value) return
      emit('platformUpdated', next)
      selected.value = null
      approved.value = false
      task.message.value =
        '已保存为停用知识包，来源审计随包保存。请到“意图问法与知识包”审核并启用。'
      return
    }
    await service.confirm(
      {
        ...row,
        question: question.value,
        answer: answer.value,
        original: { question: row.question, answer: row.answer },
      },
      approved.value,
      () =>
        workspace === runtime.snapshot.workspaceId &&
        row === selected.value &&
        row.source.storeId === runtime.selectedStoreId,
    )
    if (workspace !== runtime.snapshot.workspaceId || row !== selected.value) return
    saved.value.push(row)
    selected.value = null
    approved.value = false
    task.message.value = '已保存为停用知识包，来源审计随包保存。请到“意图问法与知识包”审核并启用。'
  })
}
</script>
<template>
  <div class="runtime-two-columns">
    <div>
      <button
        v-for="(row, index) in rows"
        :key="row.platform?.id ?? index"
        class="runtime-entry"
        :disabled="
          task.pending.value ||
          saved.includes(row) ||
          (row.platform && row.platform.status !== 'pending')
        "
        @click="preview(row)"
      >
        <b>{{ row.question }}</b>
        <p>
          {{ row.source.kind }} ·
          {{
            row.platform?.status === 'saved' || saved.includes(row)
              ? '已入库'
              : row.platform?.status === 'saving'
                ? '正在入库'
                : '待人工确认'
          }}
        </p>
        <p v-if="row.platform?.error" role="alert">{{ row.platform.error }}</p>
      </button>
      <p v-if="!rows.length">暂无候选。先选择店铺并预览已有资料或开始平台采集。</p>
    </div>
    <form v-if="selected" class="runtime-form" @submit.prevent="save">
      <strong>原始来源（仅供审核，不代表事实正确）</strong>
      <pre class="learning-source">{{ JSON.stringify(selected.source, null, 2) }}</pre>
      <details>
        <summary>查看原始问答</summary>
        <p>{{ selected.original?.question ?? selected.question }}</p>
        <p class="learning-original">{{ selected.original?.answer ?? selected.answer }}</p>
      </details>
      <p>商品绑定：{{ selected.productIds.join('、') || '无，仅限当前店铺' }}</p>
      <label
        >问法<el-input
          v-model="question"
          type="textarea"
          :rows="2"
          maxlength="1000"
          :disabled="task.pending.value"
      /></label>
      <label
        >审核后的答案<el-input
          v-model="answer"
          aria-label="审核后的候选答案"
          type="textarea"
          :rows="6"
          maxlength="4000"
          :disabled="task.pending.value"
      /></label>
      <el-checkbox v-model="approved" class="learning-confirm" :disabled="task.pending.value"
        >已核对来源、答案和绑定范围，确认保存为停用包</el-checkbox
      >
      <el-button
        native-type="submit"
        type="primary"
        :loading="task.pending.value"
        :disabled="!runtime.available || !approved || task.pending.value"
        >确认入库</el-button
      >
    </form>
  </div>
  <el-alert
    v-if="task.error.value"
    :title="task.error.value"
    type="error"
    :closable="false"
    role="alert"
  />
  <el-alert
    v-if="task.message.value"
    :title="task.message.value"
    type="success"
    :closable="false"
    role="status"
  />
</template>
<style scoped>
.learning-source {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.learning-original {
  white-space: pre-wrap;
}
.learning-confirm {
  display: flex;
  align-items: center;
  height: auto;
  white-space: normal;
}
.learning-confirm :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.5;
}
</style>
