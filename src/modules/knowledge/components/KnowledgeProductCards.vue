<script setup lang="ts">
import type { KnowledgeProductCard, KnowledgeJob } from '@/shared/contracts/knowledge'
import { isRecoverableKnowledgeJob } from '@/shared/knowledge-progress'
import { sourceLabel } from '../manager-labels'
import type { KnowledgePipelineInput } from '@/shared/contracts/knowledge-pipeline'
import KnowledgeJobProgress from './KnowledgeJobProgress.vue'
import KnowledgeThumbnail from './KnowledgeThumbnail.vue'
const props = withDefaults(
  defineProps<{
    jobs?: KnowledgeJob[]
    pending?: boolean
    products: KnowledgeProductCard[]
    selection: string[]
    page: number
    canLearn: boolean
    loadAsset(id: string): Promise<string>
  }>(),
  { jobs: () => [], pending: false },
)
function learningJob(row: KnowledgeProductCard) {
  return props.jobs
    .filter(
      (job) =>
        job.kind === 'learn' &&
        job.storeId === row.binding.storeId &&
        Array.isArray(job.payload?.bindingIds) &&
        job.payload.bindingIds.includes(row.binding.id),
    )
    .sort(
      (a, b) =>
        Number(isRecoverableKnowledgeJob(b)) - Number(isRecoverableKnowledgeJob(a)) ||
        b.createdAt - a.createdAt,
    )[0]
}
function learningActive(row: KnowledgeProductCard) {
  const job = learningJob(row)
  return !!job && ['queued', 'running', 'paused', 'needs-confirmation'].includes(job.status)
}
function visibleImages(row: KnowledgeProductCard) {
  const ids = row.imageAssetIds?.length
    ? row.imageAssetIds
    : row.sourceSummary.thumbnailAssetId
      ? [row.sourceSummary.thumbnailAssetId]
      : []
  return [...new Set(ids)].slice(0, 3)
}
const emit = defineEmits<{
  'job-action': [input: KnowledgePipelineInput]
  select: [id: string, checked: boolean]
  edit: [row: KnowledgeProductCard, trigger?: HTMLElement]
  knowledge: [row: KnowledgeProductCard]
  training: [row: KnowledgeProductCard]
  learn: [row: KnowledgeProductCard]
  ocr: [row: KnowledgeProductCard]
  remove: [row: KnowledgeProductCard]
  backup: [canonicalId: string]
}>()
</script>
<template>
  <article v-for="(row, index) in products" :key="row.binding.id" class="knowledge-card">
    <input
      type="checkbox"
      :aria-label="`选择${row.canonical.title}`"
      :checked="selection.includes(row.binding.id)"
      @change="emit('select', row.binding.id, ($event.target as HTMLInputElement).checked)"
    />
    <div class="knowledge-card-body">
      <div class="knowledge-card-heading">
        <b
          ><span class="knowledge-card-number">{{ page * 20 + index + 1 }}</span>
          {{ row.displayTitle || row.binding.title || row.canonical.title }}</b
        ><span class="badge">{{ row.binding.productId }}</span
        ><span class="badge">{{
          row.sourceSummary.kinds.map(sourceLabel).join(' / ') || '手工录入'
        }}</span>
      </div>
      <p class="knowledge-card-summary">
        {{ row.summary || '暂无商品文案摘要，点击编辑补充。' }}
      </p>
      <small class="knowledge-muted knowledge-card-meta">
        商品编码：{{ row.productSummary?.code || row.canonical.code || '暂无编码' }} ·
        {{ row.sources }} 份来源 · {{ row.productSummary?.skuCount ?? 0 }} 个SKU ·
        {{ row.productSummary?.specifications.join(' / ') || '规格未采集' }} ·
        {{
          row.productSummary?.capturedAt
            ? `${new Date(row.productSummary.capturedAt).toLocaleString()}采集 · ${row.productSummary.expired ? '已过期，需重新核对' : '有效至' + new Date(row.productSummary.expiresAt!).toLocaleString()}`
            : '未取得动态快照'
        }}
      </small>
      <div class="knowledge-card-media">
        <KnowledgeThumbnail
          v-for="assetId in visibleImages(row)"
          :key="assetId"
          :asset-id="assetId"
          :load="loadAsset"
        /><span v-if="!visibleImages(row).length" class="knowledge-image-empty">暂无来源图片</span
        ><button
          class="knowledge-card-counts"
          data-testid="product-knowledge"
          @click="emit('knowledge', row)"
        >
          {{ row.approved }} 条已审核 · {{ row.drafts }} 条草稿 ›
        </button>
        <KnowledgeJobProgress
          v-if="learningJob(row)"
          :job="learningJob(row)!"
          :pending="pending"
          compact
          @action="(input) => emit('job-action', input)"
        />
      </div>
    </div>
    <div class="knowledge-card-actions">
      <button @click="emit('ocr', row)">识别图片文字</button>
      <button
        class="primary"
        :disabled="!canLearn || pending || learningActive(row)"
        @click="emit('learn', row)"
      >
        开始学习</button
      ><button @click="emit('backup', row.canonical.id)">同款备份</button
      ><button
        data-testid="product-edit"
        @click="emit('edit', row, $event.currentTarget as HTMLElement)"
      >
        编辑</button
      ><button data-testid="product-training" @click="emit('training', row)">AI训练场</button
      ><button class="danger" @click="emit('remove', row)">解除关联</button>
    </div>
  </article>
</template>

<style scoped>
.knowledge-card-number {
  color: #8a94a6;
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
}
.knowledge-card-summary {
  display: -webkit-box;
  margin: 7px 0 5px !important;
  overflow: hidden;
  color: #4b5563;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.knowledge-card-meta {
  display: block;
  margin-bottom: 6px;
}
.knowledge-card-media {
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
}
.knowledge-card-media > button {
  flex: none;
  white-space: nowrap;
}
.knowledge-card-counts {
  color: #2453e8 !important;
  border-radius: 16px !important;
}
.knowledge-image-empty {
  width: 80px;
  font-size: 12px;
  flex: none;
}
@media (max-width: 1100px) {
  .knowledge-card-media {
    flex-wrap: wrap;
    overflow-x: visible;
  }
}
</style>
