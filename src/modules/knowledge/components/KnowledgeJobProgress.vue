<script setup lang="ts">
import { computed } from 'vue'
import type { KnowledgeJob } from '@/shared/contracts/knowledge'
import type { KnowledgePipelineInput } from '@/shared/contracts/knowledge-pipeline'
import { jobKindLabel, jobStatusLabel } from '../manager-labels'
import KnowledgeUncertainCall from './KnowledgeUncertainCall.vue'
const props = withDefaults(
  defineProps<{ job: KnowledgeJob; pending: boolean; compact?: boolean }>(),
  { compact: false },
)
const emit = defineEmits<{ action: [input: KnowledgePipelineInput] }>()
const active = computed(() => ['queued', 'running'].includes(props.job.status))
const canResume = computed(
  () =>
    (['paused', 'failed'].includes(props.job.status) ||
      (props.job.status === 'needs-confirmation' &&
        ['collect', 'daily-check'].includes(props.job.kind))) &&
    props.job.checkpoint.state !== 'submitted' &&
    !(
      props.job.kind === 'learn' &&
      props.job.status === 'failed' &&
      props.job.checkpoint.state === 'received'
    ),
)
function act(action: 'pause' | 'resume' | 'cancel' | 'retry-received') {
  emit('action', { action, storeId: props.job.storeId, jobId: props.job.id })
}
function resolve(decision: 'retry' | 'skip') {
  emit('action', {
    action: 'resolve-uncertain',
    storeId: props.job.storeId,
    jobId: props.job.id,
    decision,
  })
}
</script>
<template>
  <section
    class="knowledge-job-progress"
    :class="{ 'knowledge-job-progress--compact': compact }"
    :title="
      compact
        ? job.error ||
          (job.kind === 'learn'
            ? '处理文字、规格或图片，步数不代表商品数量；完成后请审核草稿。'
            : undefined)
        : undefined
    "
    :aria-label="`${jobKindLabel(job.kind)}进度`"
    :aria-busy="active"
    :data-status="job.status"
  >
    <div class="progress-heading" role="status">
      <span v-if="active" class="progress-spinner" aria-hidden="true" />
      <strong
        >{{ jobKindLabel(job.kind) }}{{ jobStatusLabel(job.status)
        }}<template v-if="compact && job.kind === 'learn' && job.status === 'succeeded'">
          · 待审核</template
        ></strong
      >
      <span
        >{{ job.progress.completed }} / {{ job.progress.total ?? '总量未知' }}
        {{ job.kind === 'learn' ? '资料步数' : '项' }}</span
      >
    </div>
    <progress
      :value="job.progress.total === null ? undefined : job.progress.completed"
      :max="Math.max(1, job.progress.total ?? 1)"
      :aria-label="`${jobKindLabel(job.kind)}资料处理进度`"
    />
    <p v-if="!compact && job.kind === 'learn' && active" class="progress-note">
      正在处理文字、规格或图片，步数不代表商品数量。
    </p>
    <p v-if="!compact && job.error" class="progress-note">{{ job.error }}</p>
    <p v-if="!compact && job.kind === 'learn' && job.status === 'succeeded'" class="progress-note">
      学习处理已结束，请到“待审核”核对生成的草稿，审核通过后供 AI 使用。
    </p>
    <details
      v-if="
        compact &&
        job.kind === 'learn' &&
        job.status === 'needs-confirmation' &&
        job.checkpoint.state === 'submitted'
      "
      class="progress-recovery"
    >
      <summary>处理</summary>
      <div class="progress-recovery-content">
        <KnowledgeUncertainCall :job="job" :pending="pending" @resolve="resolve" />
      </div>
    </details>
    <KnowledgeUncertainCall
      v-if="!compact && job.kind === 'learn'"
      :job="job"
      :pending="pending"
      @resolve="resolve"
    />
    <div class="progress-actions">
      <button v-if="job.status === 'running'" :disabled="pending" @click="act('pause')">
        暂停
      </button>
      <button v-if="canResume" :disabled="pending" @click="act('resume')">继续</button>
      <button
        v-if="
          job.kind === 'learn' && job.status === 'failed' && job.checkpoint.state === 'received'
        "
        :disabled="pending"
        @click="act('retry-received')"
      >
        {{ compact ? '重试（计费）' : '重新生成本片段（会计费）' }}
      </button>
      <button
        v-if="!['succeeded', 'cancelled', 'failed'].includes(job.status)"
        :disabled="pending"
        @click="act('cancel')"
      >
        取消
      </button>
    </div>
  </section>
</template>
<style scoped>
.knowledge-job-progress {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f4f7ff;
  border: 1px solid #dce5ff;
}
.progress-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
}
.progress-heading > span:last-child {
  color: #56627a;
  margin-left: auto;
}
progress {
  display: block;
  width: 100%;
  height: 8px;
  margin-top: 10px;
  accent-color: #3466ed;
}
.progress-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: #526078;
  overflow-wrap: anywhere;
}
.progress-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.progress-actions:has(button) {
  margin-top: 10px;
}
.progress-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #cbd8ff;
  border-top-color: #3466ed;
  border-radius: 50%;
  animation: knowledge-spin 0.8s linear infinite;
}
[data-status='failed'],
[data-status='needs-confirmation'] {
  background: #fff8f2;
  border-color: #f3d4af;
}
.knowledge-job-progress--compact {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  gap: 6px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  white-space: nowrap;
  position: relative;
}
.knowledge-job-progress--compact .progress-heading {
  gap: 6px;
  flex-wrap: nowrap;
  font-size: 12px;
}
.knowledge-job-progress--compact strong {
  font-weight: 500;
}
.knowledge-job-progress--compact progress {
  width: 80px;
  min-width: 40px;
  height: 5px;
  margin: 0;
}
.knowledge-job-progress--compact .progress-spinner {
  width: 10px;
  height: 10px;
  flex: none;
}
.knowledge-job-progress--compact .progress-actions {
  flex-wrap: nowrap;
  gap: 4px;
  margin: 0;
}
.knowledge-job-progress--compact button,
.progress-recovery summary {
  font-size: 12px;
  padding: 1px 6px;
  line-height: 20px;
  cursor: pointer;
}
.progress-recovery-content {
  position: absolute;
  z-index: 3;
  top: 28px;
  right: 0;
  width: 310px;
  padding: 12px;
  white-space: normal;
  background: #fff;
  border: 1px solid #dce5ff;
  border-radius: 6px;
  box-shadow: 0 4px 16px #15265420;
}
@keyframes knowledge-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .progress-spinner {
    animation-duration: 2s;
  }
}
</style>
