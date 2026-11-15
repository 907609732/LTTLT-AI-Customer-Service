<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { sourceLocationLabel } from '../manager-labels'
import type { KnowledgeImportPreview } from '@/shared/contracts/knowledge-pipeline'
const props = defineProps<{ preview: KnowledgeImportPreview; pending: boolean }>()
const page = ref(0)
const rows = computed(() => props.preview.rows.slice(page.value * 25, (page.value + 1) * 25))
watch(
  () => props.preview.previewId,
  () => {
    page.value = 0
  },
)
const emit = defineEmits<{ confirm: []; close: [] }>()
</script>
<template>
  <div class="knowledge-modal-backdrop">
    <section class="knowledge-modal" role="dialog" aria-label="导入预览" aria-modal="true">
      <h2>核对导入范围</h2>
      <p>
        {{ preview.files }}份原文件 · {{ preview.parts }}个位置/目标 ·
        {{ preview.duplicates }}项重复将跳过
      </p>
      <p>
        请核对下方目标范围。本次只导入资料，不调用付费模型；后续学习需先估算，生成的问答仍需单独审核。
      </p>
      <p v-if="preview.rows.some((row) => row.kind === 'product')">
        商品CSV按编号导入当前店铺，各商品分别保存资料。
      </p>
      <p v-if="preview.rows.some((row) => row.kind === 'intent')">
        导入的启用、审核与其他店铺标记不生效，问答先保存为待审核草稿。
      </p>
      <p v-for="encoding in preview.encodings" :key="encoding">{{ encoding }}</p>
      <p v-for="warning in preview.warnings" :key="warning" class="knowledge-error">
        {{ warning }}
      </p>
      <article v-for="(row, index) in rows" :key="index" class="knowledge-card">
        <b>{{ row.target }} · {{ row.duplicate ? '重复/跳过' : '待导入' }}</b
        ><small>{{ row.label }} · {{ sourceLocationLabel(row.locator) }}</small>
        <pre>{{ row.text }}</pre>
      </article>
      <p v-if="preview.rows.length > 25">
        <button :disabled="page === 0" @click="page--">上一页</button> {{ page + 1 }} /
        {{ Math.ceil(preview.rows.length / 25) }}
        <button :disabled="(page + 1) * 25 >= preview.rows.length" @click="page++">下一页</button>
      </p>
      <footer>
        <button @click="emit('close')">取消</button
        ><button class="primary" :disabled="pending" @click="emit('confirm')">
          确认导入这些资料
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.knowledge-card {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}
.knowledge-card small {
  display: block;
  margin: 8px 0;
}
.knowledge-card pre {
  max-width: 100%;
}
</style>
