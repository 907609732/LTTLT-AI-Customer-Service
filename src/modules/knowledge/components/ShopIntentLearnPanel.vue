<script setup lang="ts">
import { ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { chatCandidates, documentCandidates, type LearningCandidate } from '../learning'
import LearningReview from './LearningReview.vue'
import { createLearningService } from '../services'
defineProps<{ viewKey?: string }>()
const runtime = useRuntimeStore(),
  task = useTask(),
  service = createLearningService(runtime.run)
const rows = ref<LearningCandidate[]>([]),
  label = ref(''),
  document = ref(''),
  scope = ref('')
watch([() => runtime.selectedStoreId, () => runtime.snapshot.workspaceId], () => {
  rows.value = []
  scope.value = ''
  task.message.value = ''
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
</script>
<template>
  <RuntimePanel
    title="资料与聊天转意图"
    description="整理已有资料 → 预览来源与答案 → 人工确认入库。不会自动覆盖现有事实。"
    :error="task.error.value"
  >
    <div class="runtime-toolbar">
      <el-select
        v-model="runtime.selectedStoreId"
        aria-label="学习店铺"
        :disabled="task.pending.value"
        ><el-option
          v-for="shop in runtime.snapshot.stores"
          :key="shop.id"
          :value="shop.id"
          :label="shop.storeName || shop.id"
      /></el-select>
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
          >来源名称<el-input v-model="label" maxlength="200" placeholder="如：2026-11 发货规则.txt"
        /></label>
        <label
          >问答文本<el-input
            v-model="document"
            type="textarea"
            :rows="6"
            maxlength="100000"
            placeholder="问：多久发货？&#10;答：以审核后的店铺规则填写。"
        /></label>
        <p>支持明确的“问：/答：”文本。PDF、Word、OCR、任意文章自动摘要和实店主动采集尚未接入。</p>
        <el-button :disabled="!runtime.available || task.pending.value" @click="fromDocument"
          >预览文档候选</el-button
        >
      </div>
    </details>
    <p v-if="scope" role="status">{{ scope }} 共 {{ rows.length }} 条候选。</p>
    <LearningReview :candidates="rows" />
  </RuntimePanel>
</template>
