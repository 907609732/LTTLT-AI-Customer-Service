<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
const runtime = useRuntimeStore(),
  task = useTask(),
  reviewed = ref(false)
watch(
  () => runtime.snapshot.modelIssue?.at,
  () => {
    reviewed.value = false
  },
)
async function acknowledge() {
  const issue = runtime.snapshot.modelIssue
  if (!issue || !reviewed.value) return
  await task.run(async () => {
    await runtime.run({
      action: 'acknowledge-model-issue',
      values: { confirmed: true, code: issue.code, at: issue.at },
    })
    reviewed.value = false
  })
}
</script>
<template>
  <section v-if="runtime.snapshot.modelIssue" class="managed-issue">
    <el-alert :title="runtime.snapshot.modelIssue.message" type="error" :closable="false" />
    <p v-if="runtime.snapshot.modelIssue.context?.requestId">
      请求编号：{{ runtime.snapshot.modelIssue.context.requestId }}
    </p>
    <el-checkbox v-model="reviewed">我已核对原请求和处理结果</el-checkbox>
    <el-button :disabled="!reviewed || task.pending.value" @click="acknowledge"
      >清除提示，AI 保持关闭</el-button
    >
    <el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
  </section>
</template>
