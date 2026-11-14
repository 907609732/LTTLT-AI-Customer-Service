<script setup lang="ts">
import { computed } from 'vue'
import type { ProductCatalogRow } from '@/shared/contracts/product-catalog'

const props = defineProps<{ row: ProductCatalogRow }>()
const emit = defineEmits<{ close: [] }>()
const detail = computed(() => props.row.platformDetail)
const images = computed(() =>
  (detail.value?.images ?? []).filter((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
    } catch {
      return false
    }
  }),
)
const capturedAt = computed(() =>
  detail.value ? new Date(detail.value.capturedAt).toLocaleString('zh-CN', { hour12: false }) : '',
)
</script>

<template>
  <el-dialog
    :model-value="true"
    title="平台商品详情与SKU"
    width="1080px"
    append-to-body
    destroy-on-close
    class="goods-dialog platform-product-dialog"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <section aria-label="平台商品详情" class="platform-product-details">
      <template v-if="detail">
        <header>
          <h3>{{ detail.title }}</h3>
          <p>
            平台商品编号：{{ detail.productId }} · 平台商家编码：{{
              detail.merchantCode || '平台未填写'
            }}
          </p>
          <p>采集时间：{{ capturedAt }} · 价格和库存为采集时快照</p>
          <p class="platform-source">来源：{{ detail.sourceUrl }}</p>
        </header>
        <el-alert
          v-if="detail.detailStatus !== 'complete'"
          type="warning"
          :closable="false"
          :title="detail.detailNote || '平台详情未完整读取，以下仅展示实际取得的资料。'"
        />
        <p class="platform-use-hint">
          平台资料只读；在商品知识编辑中启用检索并保存后，AI才能使用。编码、SKU
          ID和条形码分别展示，缺失信息不会互相代替。
        </p>
        <h4>商品说明</h4>
        <p class="platform-description">{{ detail.description || '平台未提供文字说明' }}</p>
        <ul v-if="detail.attributes.length" class="platform-attributes">
          <li v-for="(attribute, index) in detail.attributes" :key="index">
            {{ attribute.name }}：{{ attribute.value }}
          </li>
        </ul>
        <h4>
          SKU规格 <span>（{{ detail.skus.length }}）</span>
        </h4>
        <p v-if="!detail.skus.length">尚未取得SKU资料，请重新采集并查看采集范围。</p>
        <div v-else class="platform-sku-scroll">
          <table class="platform-sku-table">
            <thead>
              <tr>
                <th>SKU ID</th>
                <th>规格组合</th>
                <th>SKU商家编码</th>
                <th>条形码</th>
                <th>拼单价（元）</th>
                <th>库存</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="sku in detail.skus"
                :key="sku.skuId || JSON.stringify(sku.specs)"
                :data-platform-sku="sku.skuId"
              >
                <td>{{ sku.skuId || '平台未提供' }}</td>
                <td>
                  <span v-for="(spec, index) in sku.specs" :key="index" class="platform-spec"
                    >{{ spec.name }}：{{ spec.value }}</span
                  ><span v-if="!sku.specs.length">平台未提供</span>
                </td>
                <td>{{ sku.merchantCode || '平台未填写' }}</td>
                <td data-sku-barcode>{{ sku.barcode || '平台未提供' }}</td>
                <td>{{ sku.price || '平台未提供' }}</td>
                <td data-sku-stock>{{ sku.stock === null ? '平台未提供' : sku.stock }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="images.length">
          <h4>平台详情图片</h4>
          <p class="platform-use-hint">图片仅展示采集来源，未识别的图片内容不作为文字知识。</p>
          <div class="platform-images">
            <img
              v-for="(url, index) in images"
              :key="url"
              :src="url"
              :alt="`平台详情图 ${index + 1}`"
              loading="lazy"
              referrerpolicy="no-referrer"
            />
          </div>
        </template>
      </template>
      <el-empty v-else description="尚未采集平台详情，请点击采集平台商品。" :image-size="90" />
    </section>
    <template #footer><el-button @click="emit('close')">关闭</el-button></template>
  </el-dialog>
</template>

<style scoped>
.platform-product-details {
  color: #395374;
  font-size: 13px;
}
.platform-product-details h3 {
  margin: 0 0 12px;
  color: #263653;
}
.platform-product-details header p,
.platform-use-hint {
  line-height: 1.7;
  color: #7c8da7;
}
.platform-source {
  overflow-wrap: anywhere;
}
.platform-product-details h4 {
  margin: 24px 0 12px;
  font-size: 14px;
}
.platform-description {
  white-space: pre-wrap;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.platform-attributes {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 28px;
  padding-left: 18px;
}
.platform-sku-scroll {
  overflow: auto;
  border: 1px solid #dbe7f8;
  border-radius: 10px;
}
.platform-sku-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  text-align: left;
}
.platform-sku-table th {
  background: #f4f8ff;
  white-space: nowrap;
  color: #5d708e;
}
.platform-sku-table th,
.platform-sku-table td {
  padding: 12px;
  border-bottom: 1px solid #edf1f7;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.platform-sku-table tr:last-child td {
  border-bottom: 0;
}
.platform-spec {
  display: block;
  line-height: 1.7;
}
.platform-images {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  overflow: auto;
}
.platform-images img {
  width: 170px;
  max-height: 240px;
  object-fit: contain;
  border: 1px solid #edf1f7;
  border-radius: 8px;
}
</style>
