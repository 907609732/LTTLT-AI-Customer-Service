<script setup lang="ts">
import { ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
const runtime = useRuntimeStore(),
  task = useTask()
const rules = ref<{ word: string; replacement: string }[]>([])
function load() {
  rules.value = runtime.snapshot.bannedWords.map((row) => ({ ...row }))
}
watch(() => runtime.snapshot.workspaceId, load, { immediate: true })
async function save() {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'save-banned-words',
      values: {
        rules: rules.value.map((row) => ({ word: row.word.trim(), replacement: row.replacement })),
      },
    })
    task.message.value = result.message
    load()
  })
}
</script>
<template>
  <RuntimePanel
    title="AI 禁用词"
    description="全局规则在发送前按长词优先替换。替换后为空的回复会交由人工处理。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <div v-for="(rule, index) in rules" :key="index" class="runtime-toolbar">
      <el-input
        v-model="rule.word"
        placeholder="禁用词"
        aria-label="禁用词"
        maxlength="100"
        style="max-width: 260px"
        :disabled="task.pending.value"
      /><el-input
        v-model="rule.replacement"
        placeholder="替换内容，可留空"
        aria-label="替换内容"
        maxlength="200"
        style="max-width: 360px"
        :disabled="task.pending.value"
      /><el-button type="danger" :disabled="task.pending.value" @click="rules.splice(index, 1)"
        >移除</el-button
      >
    </div>
    <p v-if="!rules.length">尚未设置禁用词。</p>
    <div class="runtime-actions">
      <el-button :disabled="task.pending.value" @click="rules.push({ word: '', replacement: '' })"
        >添加规则</el-button
      ><el-button
        type="primary"
        :disabled="!runtime.available"
        :loading="task.pending.value"
        @click="save"
        >保存禁用词</el-button
      ><el-button :disabled="task.pending.value" @click="load">载入已保存规则</el-button>
    </div>
  </RuntimePanel>
</template>
