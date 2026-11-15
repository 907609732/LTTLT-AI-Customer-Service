<script setup lang="ts">
import type { KnowledgeJob } from '@/shared/contracts/knowledge'
defineProps<{ job: KnowledgeJob; pending: boolean }>()
const emit = defineEmits<{ resolve: [decision: 'retry' | 'skip'] }>()
</script>
<template>
  <div
    v-if="job.status === 'needs-confirmation' && job.checkpoint.state === 'submitted'"
    class="knowledge-card-body"
  >
    <p>这次模型调用的结果不确定，可能已扣费。普通继续不会重发。</p>
    <button :disabled="pending" @click="emit('resolve', 'retry')">
      明确重试此调用（可能重复计费）</button
    ><button :disabled="pending" @click="emit('resolve', 'skip')">
      跳过此调用（保留未完成提示）
    </button>
  </div>
</template>
