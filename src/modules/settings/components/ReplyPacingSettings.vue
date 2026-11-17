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
  <section class="reply-pacing-settings" aria-label="AI 回复间隔">
    <form class="runtime-form reply-pacing" @submit.prevent="savePacing">
      <label
        >回复间隔<el-input-number
          v-model="pacingSeconds"
          aria-label="同一买家回复间隔（秒）"
          size="small"
          :min="1"
          :max="3600"
          :step="1"
          :precision="0"
          :disabled="pacingTask.pending.value"
          @change="pacingDirty = true"
        /><span>秒</span></label
      >
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="pacingTask.pending.value"
          :disabled="!runtime.available || pacingSeconds === null"
          size="small"
          aria-label="保存回复间隔"
          >保存</el-button
        >
      </div>
      <p class="pacing-current" title="最少 1 秒，全局生效（所有店铺）">
        当前 {{ runtime.snapshot.config.reply.perUidMinIntervalMs / 1000 }} 秒 · 全局生效
      </p>
    </form>
    <p v-if="pacingTask.error.value" role="alert">{{ pacingTask.error.value }}</p>
    <p v-if="pacingTask.message.value" role="status">{{ pacingTask.message.value }}</p>
  </section>
</template>

<style scoped>
.reply-pacing-settings {
  margin: 12px 0;
}
.reply-pacing {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin: 0;
}
.reply-pacing > label {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  white-space: nowrap;
  font-size: 13px;
}
.reply-pacing :deep(.el-input-number) {
  width: 96px;
}
.reply-pacing .runtime-actions {
  gap: 0;
}
.pacing-current {
  margin: 0;
  font-size: 12px;
  color: #71819a;
  line-height: 1.5;
  white-space: nowrap;
}
.reply-pacing-settings > p {
  margin: 6px 0 0;
  font-size: 12px;
}
</style>
