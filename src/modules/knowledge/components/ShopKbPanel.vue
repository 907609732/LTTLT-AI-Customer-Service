<script setup lang="ts">
import { ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { candidatePack, type LearningCandidate } from '../learning'
import LearningReview from './LearningReview.vue'
defineProps<{ viewKey?: string }>()
const runtime = useRuntimeStore(),
  task = useTask()
const label = ref(''),
  answer = ref(''),
  productIds = ref(''),
  rows = ref<LearningCandidate[]>([])
watch(
  [label, answer, productIds, () => runtime.selectedStoreId, () => runtime.snapshot.workspaceId],
  () => {
    rows.value = []
  },
)
function preview() {
  void task.run(async () => {
    const row: LearningCandidate = {
      question: `${label.value.trim()}的尺码/规格是什么？`,
      answer: answer.value,
      productIds: [
        ...new Set(
          productIds.value
            .split(/\r?\n/)
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ],
      source: { kind: 'size', storeId: runtime.selectedStoreId, label: label.value.trim() },
    }
    if (!label.value.trim() || label.value.length > 200)
      throw new Error('请填写 1～200 字来源/规则名称')
    if (
      !row.productIds.length ||
      row.productIds.length > 1000 ||
      row.productIds.some((id) => id.length > 100)
    )
      throw new Error('请填写 1～1000 个商品编号，每个不超过 100 字')
    candidatePack(row)
    rows.value = [row]
  })
}
</script>
<template>
  <RuntimePanel
    id="viewKb"
    data-v-5f3c24c3=""
    title="尺码规格表"
    description="按当前店铺和商品编号保存为知识包，先审核再启用。跨店共用与商品互斥绑定尚未接入。"
    :error="task.error.value"
  >
    <form class="runtime-form" @submit.prevent="preview">
      <label
        >店铺<el-select v-model="runtime.selectedStoreId" aria-label="尺码店铺"
          ><el-option
            v-for="shop in runtime.snapshot.stores"
            :key="shop.id"
            :value="shop.id"
            :label="shop.storeName || shop.id" /></el-select
      ></label>
      <label>来源/规则名称<el-input v-model="label" maxlength="200" /></label>
      <label
        >绑定商品编号（必填，每行一个）<el-input v-model="productIds" type="textarea" :rows="2"
      /></label>
      <label
        >尺码规格及单位、适用条件<el-input
          v-model="answer"
          type="textarea"
          :rows="8"
          maxlength="4000"
          placeholder="粘贴经过核对的尺码表，并注明单位和适用商品。"
      /></label>
      <el-button native-type="submit" :disabled="!runtime.available || task.pending.value"
        >预览尺码候选</el-button
      >
    </form>
    <p>
      保存后在“意图问法与知识包”维护及启用。现有已启用规则不会自动覆盖或合并，请核对重叠绑定；本页不承诺跨店同步。
    </p>
    <LearningReview :candidates="rows" />
  </RuntimePanel>
</template>
