<script setup lang="ts">
import { scopeLabel, fieldLabel } from '../manager-labels'
import type { KnowledgeEntry } from '@/shared/contracts/knowledge'
defineProps<{
  entries: KnowledgeEntry[]
  affected: string[]
  excluded: string[]
  pending: boolean
}>()
const emit = defineEmits<{
  exclude: [entryId: string, excluded: boolean]
  confirm: []
  close: []
}>()
</script>
<template>
  <div class="knowledge-modal-backdrop">
    <section class="knowledge-modal" role="dialog" aria-modal="true" aria-label="审核发布">
      <h2>审核发布 {{ entries.length }} 条</h2>
      <p>
        受影响店铺：{{
          affected.join('、') || '尚未绑定店铺'
        }}。请逐条核对；取消勾选即排除本次发布。
      </p>
      <label v-for="entry in entries" :key="entry.id" class="knowledge-review-row"
        ><input
          type="checkbox"
          :checked="!excluded.includes(entry.id)"
          @change="emit('exclude', entry.id, !($event.target as HTMLInputElement).checked)"
        />
        <div>
          <b>{{ entry.draft.question }}</b>
          <p>{{ entry.draft.answer }}</p>
          <small
            >{{ scopeLabel(entry.draft.scope.kind) }} · {{ fieldLabel(entry.draft.field) }} · 来源
            {{ JSON.stringify(entry.draft.sourceRefs) }} ·
            {{
              entry.draft.expiresAt
                ? new Date(entry.draft.expiresAt).toLocaleString() + '到期'
                : '无动态有效期'
            }}</small
          >
        </div></label
      >
      <footer>
        <button @click="emit('close')">继续编辑</button
        ><button class="primary" :disabled="pending" @click="emit('confirm')">
          明确审核并发布所选条目
        </button>
      </footer>
    </section>
  </div>
</template>
