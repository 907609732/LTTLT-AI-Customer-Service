<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ assetId: string; load(id: string): Promise<string> }>()
const element = ref<HTMLElement>(),
  image = ref(''),
  error = ref(false)
let observer: IntersectionObserver | undefined,
  ticket = 0
async function read() {
  const current = ++ticket
  try {
    const url = await props.load(props.assetId)
    if (current === ticket) image.value = url
  } catch {
    if (current === ticket) error.value = true
  }
}
function failed() {
  image.value = ''
  error.value = true
}
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return void read()
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer?.disconnect()
      void read()
    }
  })
  if (element.value) observer.observe(element.value)
})
watch(
  () => props.assetId,
  () => {
    image.value = ''
    error.value = false
    void read()
  },
)
onBeforeUnmount(() => {
  ticket++
  observer?.disconnect()
})
</script>
<template>
  <span ref="element" class="knowledge-thumbnail"
    ><img v-if="image" :src="image" alt="来源图片" loading="lazy" @error="failed" /><span v-else>{{
      error ? '不可用' : '图片'
    }}</span></span
  >
</template>
<style scoped>
.knowledge-thumbnail {
  display: inline-flex;
  width: 52px;
  height: 52px;
  flex: none;
  align-items: center;
  justify-content: center;
  background: var(--km-card, #fff);
  border: 1px solid var(--km-border, #e4e7ed);
  border-radius: 6px;
  overflow: hidden;
  color: var(--km-muted, #606266);
  font-size: 14px;
}
.knowledge-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
