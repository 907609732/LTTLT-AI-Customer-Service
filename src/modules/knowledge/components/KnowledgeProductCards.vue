<script setup lang="ts">
import type { KnowledgeProductCard } from '@/shared/contracts/knowledge'
import { sourceLabel } from '../manager-labels'
import KnowledgeThumbnail from './KnowledgeThumbnail.vue'
defineProps<{
  products: KnowledgeProductCard[]
  selection: string[]
  page: number
  canLearn: boolean
  loadAsset(id: string): Promise<string>
}>()
const emit = defineEmits<{
  select: [id: string, checked: boolean]
  edit: [row: KnowledgeProductCard]
  learn: [row: KnowledgeProductCard]
  remove: [row: KnowledgeProductCard]
  backup: []
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
        <b>{{ page * 20 + index + 1 }} {{ row.binding.title || row.canonical.title }}</b
        ><span class="badge">{{ row.binding.productId }}</span
        ><span class="badge">{{
          row.sourceSummary.kinds.map(sourceLabel).join(' / ') || '手工录入'
        }}</span>
      </div>
      <p class="knowledge-muted">
        共享商品：{{ row.canonical.title }} · 编码：{{ row.canonical.code || '未提供' }} ·
        {{ row.sources }} 份来源 · 静态事实继承共享，价格库存按店铺/SKU及有效期核验
      </p>
      <div class="knowledge-card-media">
        <KnowledgeThumbnail
          v-if="row.sourceSummary.thumbnailAssetId"
          :asset-id="row.sourceSummary.thumbnailAssetId"
          :load="loadAsset"
        /><span v-else class="knowledge-image-empty">暂无来源图片</span
        ><button @click="emit('edit', row)">
          {{ row.approved }} 条已审核 · {{ row.drafts }} 条草稿 ›
        </button>
      </div>
    </div>
    <div class="knowledge-card-actions">
      <button class="primary" :disabled="!canLearn" @click="emit('learn', row)">开始学习</button
      ><button @click="emit('backup')">备份</button><button @click="emit('edit', row)">编辑</button
      ><button class="danger" @click="emit('remove', row)">解除关联</button>
    </div>
  </article>
</template>
