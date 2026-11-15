<script setup lang="ts">
import { ref } from 'vue'
import { sourceLocationLabel } from '../manager-labels'
import type { KnowledgeSourceLocator } from '@/shared/contracts/knowledge'
const props = defineProps<{
  assetId: string
  load: (id: string) => Promise<string>
  label?: string
  locator?: KnowledgeSourceLocator
}>()
const image = ref(''),
  error = ref('')
async function open() {
  error.value = ''
  try {
    image.value = await props.load(props.assetId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>
<template>
  <button @click="open">查看资料图片</button><span v-if="error">{{ error }}</span>
  <div v-if="image" class="knowledge-modal-backdrop">
    <section class="knowledge-modal" role="dialog" aria-label="来源图片预览">
      <p>{{ label || '资料图片' }} · {{ locator ? sourceLocationLabel(locator) : '只读预览' }}</p>
      <img :src="image" alt="来源资料原图或页面分块" style="max-width: 100%; height: auto" />
      <footer><button @click="image = ''">关闭图片</button></footer>
    </section>
  </div>
</template>
