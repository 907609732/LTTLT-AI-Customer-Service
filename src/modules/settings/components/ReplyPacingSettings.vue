<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import {
  describeReplyPacing,
  REPLY_PACING_LIMITS,
  REPLY_PACING_OPTIONS,
} from '@/shared/reply-pacing'
import type { ReplyPacing, ReplyPacingMode } from '@/shared/contracts/backend'

const runtime = useRuntimeStore()
const pacingTask = useTask()
// 下拉模式与自定义起止是本地草稿；普通快照刷新不覆盖，只有保存或显式重新载入才同步。
const pacingMode = ref<ReplyPacingMode>('random-1-3'),
  pacingMin = ref<number | null>(1),
  pacingMax = ref<number | null>(3),
  pacingDirty = ref(false),
  // 载入时的完整节奏用于 CAS 并发检查；其他窗口保存后拒绝覆盖并保留草稿。
  pacingLoaded = ref<ReplyPacing>({
    mode: 'random-1-3',
    customMinSeconds: 1,
    customMaxSeconds: 3,
  })
const pacingCustom = computed(() => pacingMode.value === 'custom')
const pacingRangeInvalid = computed(() => {
  if (!pacingCustom.value) return false
  const min = pacingMin.value,
    max = pacingMax.value
  const valid = (value: number | null): value is number =>
    value !== null &&
    Number.isInteger(value) &&
    value >= REPLY_PACING_LIMITS.minSeconds &&
    value <= REPLY_PACING_LIMITS.maxSeconds
  return !(valid(min) && valid(max) && min <= max)
})
const pacingCurrent = computed(() => describeReplyPacing(runtime.snapshot.config.reply.pacing))
const pacingConflict = computed(() => pacingTask.error.value.includes('已更新'))
function reloadPacing() {
  const saved = runtime.snapshot.config.reply.pacing
  pacingLoaded.value = { ...saved }
  pacingMode.value = saved.mode
  pacingMin.value = saved.customMinSeconds
  pacingMax.value = saved.customMaxSeconds
  pacingDirty.value = false
  pacingTask.error.value = ''
}
watch(
  () =>
    [
      runtime.snapshot.config.reply.pacing.mode,
      runtime.snapshot.config.reply.pacing.customMinSeconds,
      runtime.snapshot.config.reply.pacing.customMaxSeconds,
    ].join('|'),
  () => {
    if (!pacingDirty.value && !pacingTask.pending.value) reloadPacing()
  },
  { immediate: true },
)
async function savePacing() {
  // Enter/程序触发表单也必须经过同一校验，不能仅依赖禁用保存按钮。
  if (pacingRangeInvalid.value) return
  const minSeconds = pacingCustom.value ? pacingMin.value : pacingLoaded.value.customMinSeconds
  const maxSeconds = pacingCustom.value ? pacingMax.value : pacingLoaded.value.customMaxSeconds
  if (minSeconds === null || maxSeconds === null) return
  await pacingTask.run(async () => {
    const result = await runtime.run({
      action: 'save-config',
      screenId: 'REPLY_PACING',
      values: {
        mode: pacingMode.value,
        customMinSeconds: minSeconds,
        customMaxSeconds: maxSeconds,
        expected: { ...pacingLoaded.value },
      },
    })
    reloadPacing()
    pacingTask.message.value = result.message
  })
}
watch(
  () => runtime.snapshot.workspaceId,
  () => {
    reloadPacing()
    pacingTask.message.value = ''
  },
)
</script>
<template>
  <section class="reply-pacing-settings" aria-label="AI 回复间隔">
    <form class="runtime-form reply-pacing" @submit.prevent="savePacing">
      <label class="pacing-label" for="reply-pacing-mode">回复间隔</label>
      <el-select
        id="reply-pacing-mode"
        v-model="pacingMode"
        aria-label="回复间隔模式"
        size="small"
        :disabled="pacingTask.pending.value"
        @update:model-value="pacingDirty = true"
      >
        <el-option
          v-for="option in REPLY_PACING_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <span v-if="pacingCustom" class="pacing-range">
        <el-input-number
          v-model="pacingMin"
          aria-label="随机间隔下限（秒）"
          size="small"
          :min="1"
          :max="3600"
          :step="1"
          :precision="0"
          :disabled="pacingTask.pending.value"
          @update:model-value="pacingDirty = true"
        /><span class="pacing-sep">～</span
        ><el-input-number
          v-model="pacingMax"
          aria-label="随机间隔上限（秒）"
          size="small"
          :min="1"
          :max="3600"
          :step="1"
          :precision="0"
          :disabled="pacingTask.pending.value"
          @update:model-value="pacingDirty = true"
        /><span class="pacing-unit">秒</span>
      </span>
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="pacingTask.pending.value"
          :disabled="!runtime.available || pacingRangeInvalid"
          size="small"
          aria-label="保存回复间隔"
          >保存</el-button
        >
      </div>
      <span v-if="pacingDirty" class="pacing-dirty">未保存</span>
      <p
        class="pacing-current"
        title="同一买家两次回复之间等待的秒数；至少 1 秒、最多 3600 秒，下限不能大于上限。全局生效（所有店铺）。"
      >
        当前：{{ pacingCurrent }} · 全局生效
      </p>
    </form>
    <p class="pacing-hint">同一买家的连续回复按所选间隔调度；模型生成和审核耗时另计。</p>
    <p v-if="pacingTask.error.value || pacingRangeInvalid" class="pacing-error" role="alert">
      {{ pacingTask.error.value || '请输入 1～3600 的整数秒，且下限不能大于上限' }}
      <el-button
        v-if="pacingConflict"
        size="small"
        text
        aria-label="重新载入已保存设置"
        @click="reloadPacing"
        >重新载入已保存设置</el-button
      >
    </p>
    <p v-if="pacingTask.message.value" class="pacing-message" role="status">
      {{ pacingTask.message.value }}
    </p>
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
.pacing-label {
  font-size: 13px;
  white-space: nowrap;
}
.reply-pacing :deep(.el-select) {
  width: 168px;
}
.reply-pacing :deep(.el-input-number) {
  width: 96px;
}
.pacing-sep,
.pacing-unit {
  font-size: 13px;
}
/* 起止输入与单位作为一组换行，窄容器里不把“～”或“秒”拆到另一行。 */
.pacing-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.reply-pacing .runtime-actions {
  gap: 0;
}
.pacing-dirty {
  font-size: 12px;
  color: #b26a00;
  white-space: nowrap;
}
.pacing-current {
  margin: 0;
  font-size: 12px;
  color: #71819a;
  line-height: 1.5;
  min-width: 0;
}
.pacing-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #71819a;
  line-height: 1.5;
}
.reply-pacing-settings > p.pacing-error,
.reply-pacing-settings > p.pacing-message {
  margin: 6px 0 0;
  font-size: 12px;
}
.pacing-error {
  color: #c45656;
}
</style>
