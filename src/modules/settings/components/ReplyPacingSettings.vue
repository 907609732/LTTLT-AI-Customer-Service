<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
const runtime = useRuntimeStore()
const pacingTask = useTask(),
  pacingSeconds = ref(1),
  pacingDirty = ref(false),
  pacingLoadedMs = ref(1000)
function reloadPacing() {
  pacingLoadedMs.value = runtime.snapshot.config.reply.perUidMinIntervalMs
  pacingSeconds.value = pacingLoadedMs.value / 1000
  pacingDirty.value = false
}
watch(
  () => runtime.snapshot.config.reply.perUidMinIntervalMs,
  () => {
    if (!pacingDirty.value && !pacingTask.pending.value) reloadPacing()
  },
  { immediate: true },
)
async function savePacing() {
  await pacingTask.run(async () => {
    const result = await runtime.run({
      action: 'save-config',
      screenId: 'REPLY_PACING',
      values: { seconds: pacingSeconds.value, expectedMs: pacingLoadedMs.value },
    })
    reloadPacing()
    pacingTask.message.value = result.message
  })
}
watch(
  () => runtime.snapshot.workspaceId,
  () => {
    reloadPacing()
    pacingTask.error.value = ''
    pacingTask.message.value = ''
  },
)
</script>
<template>
  <section aria-label="AI 回复间隔">
    <h3>AI 回复间隔</h3>
    <form class="runtime-form reply-pacing" @submit.prevent="savePacing">
      <label
        >AI 回复最少间隔（秒）<el-input-number
          v-model="pacingSeconds"
          aria-label="同一买家回复间隔（秒）"
          :min="1"
          :max="3600"
          :step="1"
          :precision="0"
          :disabled="pacingTask.pending.value"
          @change="pacingDirty = true"
      /></label>
      <p>
        当前：{{ runtime.snapshot.config.reply.perUidMinIntervalMs / 1000 }} 秒；最少 1
        秒，全局生效（所有店铺）。
      </p>
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="pacingTask.pending.value"
          :disabled="!runtime.available || pacingSeconds === null"
          >保存回复间隔</el-button
        ><el-button :disabled="pacingTask.pending.value" @click="reloadPacing"
          >载入已保存间隔</el-button
        >
      </div>
    </form>
    <p v-if="pacingTask.error.value" role="alert">{{ pacingTask.error.value }}</p>
    <p v-if="pacingTask.message.value" role="status">{{ pacingTask.message.value }}</p>
    <p>间隔单独保存，保存不会开启 AI 或发送消息。</p>
  </section>
</template>
