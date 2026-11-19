<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = withDefaults(
  defineProps<{
    assetId?: string
    src?: string
    alt: string
    loadAsset?: (id: string) => Promise<string>
  }>(),
  { assetId: '', src: '', loadAsset: undefined },
)
const image = ref(''),
  state = ref<'loading' | 'ready' | 'error' | 'empty'>('empty')
let ticket = 0
async function read() {
  const current = ++ticket
  image.value = ''
  if (props.src) {
    image.value = props.src
    state.value = 'ready'
    return
  }
  if (!props.assetId || !props.loadAsset) {
    state.value = 'empty'
    return
  }
  state.value = 'loading'
  try {
    const url = await props.loadAsset(props.assetId)
    if (current !== ticket) return
    image.value = url
    state.value = 'ready'
  } catch {
    if (current === ticket) state.value = 'error'
  }
}
function failed() {
  image.value = ''
  state.value = 'error'
}
onMounted(read)
onBeforeUnmount(() => {
  ticket++
})
watch(() => [props.assetId, props.src], read)
</script>
<template>
  <span class="knowledge-product-image">
    <img v-if="image" :src="image" :alt="alt" @error="failed" />
    <span v-else class="knowledge-product-image-state" :data-state="state">{{
      state === 'loading' ? '加载中' : state === 'error' ? '图片不可用' : '暂无图片'
    }}</span>
  </span>
</template>
<style scoped>
.knowledge-product-image {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #191714;
  color: #a99f93;
}
.knowledge-product-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.knowledge-product-image-state {
  padding: 8px;
  font-size: 12px;
  text-align: center;
}
</style>
