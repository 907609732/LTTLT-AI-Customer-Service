<script setup lang="ts">
import type { BatchReviewResult } from '../batch-review'
defineProps<{ results: BatchReviewResult[] }>()
defineEmits<{ close: [] }>()
const labels = { approved: '已发布', skipped: '已跳过', failed: '失败，草稿保留' }
</script>
<template>
  <div class="knowledge-modal-backdrop">
    <section class="knowledge-modal" role="dialog" aria-label="批量审核结果">
      <h2>逐商品审核结果</h2>
      <article v-for="row in results" :key="row.entryId" class="knowledge-card">
        <b>{{ row.target }} · {{ labels[row.status] }}</b>
        <p>{{ row.question }}</p>
        <p>{{ row.reason }}</p>
      </article>
      <footer><button @click="$emit('close')">关闭</button></footer>
    </section>
  </div>
</template>

<style scoped>
.knowledge-card {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
