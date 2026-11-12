<!-- GoodsDetailDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { computed } from 'vue'
import { createGoodsDetailDialogDemo } from '@/modules/shops/demo/GoodsDetailDialog'
const demo = createGoodsDetailDialogDemo()
interface Props {
  modelValue?: boolean
  goods?: {
    id: number
    name: string
    code: string
    price: string
    sku: string
    sales: string
    learning: string
    learned: string
    specs: string
    detail: string
    goodsConfig: string
  }
  shopName?: string
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  goods: () => ({
    id: 0,
    name: '',
    code: '',
    price: '',
    sku: '',
    sales: '',
    learning: '',
    learned: '',
    specs: '',
    detail: '',
    goodsConfig: '',
  }),
  shopName: '',
})
const __stub = notifyUnavailable
const displayText = computed(() => demo.displayText)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    @update:modelValue="emit('update:modelValue', $event)"
    title="商品详情"
    width="560px"
    @close="__stub('此操作')"
    data-v-49d280f9=""
    ><template #footer
      ><el-button @click="emit('update:modelValue', false)" data-v-49d280f9="">关闭</el-button
      ><el-button type="primary" @click="__stub('此操作')" data-v-49d280f9="">{{
        displayText
      }}</el-button></template
    ><template v-if="props.modelValue"
      ><el-descriptions column="2" border="" size="small" data-v-49d280f9=""
        ><el-descriptions-item label="所属店铺" data-v-49d280f9="">{{
          props?.shopName || '—'
        }}</el-descriptions-item
        ><el-descriptions-item label="商品编号" data-v-49d280f9="">{{
          props?.goods?.id
        }}</el-descriptions-item
        ><el-descriptions-item label="商品名称" data-v-49d280f9="">{{
          props?.goods?.name
        }}</el-descriptions-item
        ><el-descriptions-item label="商品编码" data-v-49d280f9="">{{
          props?.goods?.code || '—'
        }}</el-descriptions-item
        ><el-descriptions-item label="价格" data-v-49d280f9="">{{
          props?.goods?.price || '—'
        }}</el-descriptions-item
        ><el-descriptions-item label="SKU" data-v-49d280f9="">{{
          props?.goods?.sku || '—'
        }}</el-descriptions-item
        ><el-descriptions-item label="销量" data-v-49d280f9="">{{
          props?.goods?.sales || 0
        }}</el-descriptions-item
        ><el-descriptions-item label="学习状态" data-v-49d280f9="">{{
          props?.goods?.learning ? '学习中' : props?.goods?.learned ? '已学习' : '未学习'
        }}</el-descriptions-item
        ><el-descriptions-item label="规格卖点" span="2" data-v-49d280f9="">{{
          props?.goods?.specs || '—'
        }}</el-descriptions-item
        ><el-descriptions-item label="商品知识" span="2" data-v-49d280f9="">
          <pre class="detail-pre" data-v-49d280f9="">{{
            props?.goods?.detail || props?.goods?.goodsConfig || '暂无深度学习内容，可点编辑完善'
          }}</pre>
        </el-descriptions-item></el-descriptions
      ></template
    ></el-dialog
  >
</template>
