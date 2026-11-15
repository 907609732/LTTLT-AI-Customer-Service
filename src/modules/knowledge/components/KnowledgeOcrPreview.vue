<script setup lang="ts">
import type { KnowledgeOcrPreview } from '@/shared/contracts/knowledge-pipeline'
import KnowledgeThumbnail from './KnowledgeThumbnail.vue'
import KnowledgeSourceImage from './KnowledgeSourceImage.vue'
defineProps<{ preview: KnowledgeOcrPreview; loadAsset(id: string): Promise<string> }>()
defineEmits<{ close: [] }>()
</script>
<template>
  <div class="knowledge-modal-backdrop">
    <section class="knowledge-modal" role="dialog" aria-modal="true" aria-label="图片文字识别结果">
      <h2>图片文字识别结果</h2>
      <p>
        本机识别 {{ preview.images }} 张图片、{{ preview.items.length }} 个分块，共
        {{ preview.characters }} 字。OCR可能误读，须结合原图审核；尚未生成或发布知识。
      </p>
      <div class="ocr-items">
        <article
          v-for="item in preview.items"
          :key="item.sourceId + ':' + item.tileAssetId + ':' + item.image"
        >
          <KnowledgeThumbnail :asset-id="item.tileAssetId" :load="loadAsset" />
          <div>
            <b>图片 {{ item.image }} · 分块 {{ item.tile }}</b>
            <KnowledgeSourceImage
              :asset-id="item.tileAssetId"
              :load="loadAsset"
              :locator="{ image: item.image, tile: item.tile }"
              label="OCR依据分块"
            />
            <pre>{{ item.text || '未识别到可读文字；不代表图片没有商品信息。' }}</pre>
          </div>
        </article>
      </div>
      <footer><button @click="$emit('close')">关闭</button></footer>
    </section>
  </div>
</template>
<style scoped>
.ocr-items {
  max-height: 55vh;
  overflow: auto;
}
.ocr-items article {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #e2e8f0;
}
.ocr-items article > div {
  min-width: 0;
}
.ocr-items pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
</style>
