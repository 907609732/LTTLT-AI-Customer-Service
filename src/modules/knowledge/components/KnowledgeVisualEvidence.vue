<script setup lang="ts">
import type { KnowledgeVisualEvidence } from '@/shared/contracts/knowledge-evidence'
import { sourceLocationLabel } from '../manager-labels'
import KnowledgeSourceImage from './KnowledgeSourceImage.vue'
defineProps<{ evidence: KnowledgeVisualEvidence; load: (id: string) => Promise<string> }>()
</script>
<template>
  <aside class="knowledge-card-body">
    <b>{{ evidence.kind === 'image-text' ? '图片文字依据' : '图示关系依据' }} · 待人工复核</b>
    <p>{{ sourceLocationLabel(evidence.locator) }}</p>
    <p v-if="evidence.kind === 'visual-relationship'">
      {{ evidence.from }} → {{ evidence.to }}：{{ evidence.observation }}
    </p>
    <p v-else>{{ evidence.quote }}</p>
    <KnowledgeSourceImage
      :asset-id="evidence.imageAssetId"
      :load="load"
      :locator="evidence.locator"
      label="候选依据图片"
    />
    <p>对照图片核实后再发布；图示关系不代表未显示的功能、因果或操作承诺。</p>
  </aside>
</template>
