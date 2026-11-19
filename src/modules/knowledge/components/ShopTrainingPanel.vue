<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import type { KnowledgeProductCard } from '@/shared/contracts/knowledge'
const props = withDefaults(
  defineProps<{
    storeId: string
    storeName?: string
    products?: KnowledgeProductCard[]
    productId?: string
    productLoading?: boolean
    productError?: string
    session?: number
  }>(),
  {
    storeName: '',
    products: () => [],
    productId: '',
    productLoading: false,
    productError: '',
    session: 0,
  },
)
const emit = defineEmits<{
  'update:productId': [value: string]
  retryProducts: []
}>()
const runtime = useRuntimeStore()
const question = ref(''),
  productSearch = ref(''),
  images = ref(''),
  history = ref<{ from: 'buyer' | 'seller'; content: string }[]>([]),
  pending = ref(false),
  error = ref('')
let generation = 0,
  requestId = 0
const storeLabel = computed(() => props.storeName || props.storeId || '未选择店铺')
const selectedProductId = computed({
  get: () => props.productId,
  set: (value: string) => emit('update:productId', value),
})
const productIssue = computed(() => {
  if (!props.productId) return ''
  if (props.productLoading) return '正在核对所选商品，请稍候。'
  if (props.productError) return '商品读取失败，请重试后再测试。'
  return props.products.some(
    (row) => row.binding.storeId === props.storeId && row.binding.productId === props.productId,
  )
    ? ''
    : '所选商品不可用，请重新选择商品，或明确选择“不指定商品”。'
})
const filteredProducts = computed(() => {
  const query = productSearch.value.trim().toLowerCase()
  if (!query) return props.products
  return props.products.filter(
    (row) =>
      row.binding.productId === props.productId ||
      (row.binding.title || row.canonical.title).toLowerCase().includes(query) ||
      row.binding.productId.toLowerCase().includes(query),
  )
})
const selectedProductLabel = computed(() => {
  if (!props.productId) return ''
  const row = props.products.find((item) => item.binding.productId === props.productId)
  return row
    ? `${row.binding.title || row.canonical.title} · ${row.binding.productId}`
    : props.productId
})
/** Shop/product changes invalidate both the visible transcript and any in-flight model result. */
function resetContext() {
  generation++
  requestId++
  pending.value = false
  error.value = ''
  question.value = ''
  images.value = ''
  productSearch.value = ''
  history.value = []
}
watch(() => [props.storeId, props.productId, props.session] as const, resetContext, {
  flush: 'sync',
})
onBeforeUnmount(() => {
  generation++
  requestId++
})
async function send() {
  if (pending.value) return
  if (!props.storeId || productIssue.value) {
    error.value = productIssue.value || '请先选择店铺'
    return
  }
  const text = question.value.trim()
  if (!text) return
  const ticket = ++requestId,
    storeId = props.storeId,
    selectedProduct = props.productId,
    currentGeneration = generation
  pending.value = true
  error.value = ''
  try {
    const imageUrls = images.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    const result = await runtime.run({
      action: 'start-training',
      ...(storeId ? { storeId } : {}),
      values: {
        question: text,
        // Vue turns stored rows into reactive proxies; Electron's IPC structured clone
        // rejects them ("An object could not be cloned.") before the main process runs.
        history: history.value
          .slice(-20)
          .map((item) => ({ from: item.from, content: item.content })),
        ...(selectedProduct ? { productId: selectedProduct } : {}),
        ...(imageUrls.length ? { images: imageUrls } : {}),
      },
    })
    if (
      ticket !== requestId ||
      currentGeneration !== generation ||
      storeId !== props.storeId ||
      selectedProduct !== props.productId
    )
      return
    if (typeof result.data.reply !== 'string') throw new Error('模型未返回有效回复')
    history.value.push(
      { from: 'buyer', content: text },
      { from: 'seller', content: result.data.reply },
    )
    history.value = history.value.slice(-20)
    question.value = ''
    images.value = ''
  } catch (cause) {
    if (
      ticket === requestId &&
      currentGeneration === generation &&
      storeId === props.storeId &&
      selectedProduct === props.productId
    )
      error.value = (cause instanceof Error ? cause.message : String(cause)).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      )
  } finally {
    if (ticket === requestId) pending.value = false
  }
}
</script>
<template>
  <RuntimePanel
    class="knowledge-training-panel"
    title="AI训练场"
    :description="`当前知识库店铺：${storeLabel}。使用当前模型、分店规则、商品及意图知识生成模拟回复，不向买家发送。`"
    :error="error"
  >
    <div class="knowledge-training-shop" data-testid="training-store">
      <b>{{ storeLabel }}</b>
      <span>请选择本店商品并输入模拟买家问题。</span>
    </div>
    <div class="knowledge-training-products">
      <label
        >测试商品（可选）
        <input
          v-model="productSearch"
          aria-label="搜索训练商品"
          placeholder="按商品名称或编号筛选"
          :disabled="pending"
        />
        <select
          v-model="selectedProductId"
          aria-label="训练商品"
          :disabled="pending || productLoading"
        >
          <option value="">不指定商品</option>
          <option
            v-if="productId && !products.some((row) => row.binding.productId === productId)"
            :value="productId"
            disabled
          >
            {{ productId }}（待核对或商品不可用）
          </option>
          <option
            v-for="row in filteredProducts"
            :key="row.binding.id"
            :value="row.binding.productId"
          >
            {{ row.binding.title || row.canonical.title }} · {{ row.binding.productId }}
          </option>
        </select>
      </label>
      <p v-if="selectedProductLabel" class="knowledge-training-selected">
        已选商品：{{ selectedProductLabel }}
      </p>
      <p v-if="productIssue" class="knowledge-alert error" role="alert">{{ productIssue }}</p>
      <p class="knowledge-muted">
        商品回答使用已审核且有效的知识；尚未学习或审核时会提示实际原因。
      </p>
      <p v-if="productLoading" class="knowledge-muted">正在读取当前店铺全部商品…</p>
      <p v-else-if="productError" class="knowledge-alert error" role="alert">
        {{ productError }}
        <button type="button" @click="emit('retryProducts')">重试读取</button>
      </p>
      <p v-else-if="!products.length" class="knowledge-muted">
        当前店铺还没有可用于训练的商品；仍可不指定商品直接测试文字规则。
      </p>
      <p v-else class="knowledge-muted">当前店铺共 {{ products.length }} 件商品可选。</p>
    </div>
    <div class="runtime-card" role="log" aria-label="模拟对话">
      <p v-if="!history.length">输入问题，验证模型和回复规则。</p>
      <div v-for="(item, index) in history" :key="index" :class="['runtime-message', item.from]">
        <b>{{ item.from === 'buyer' ? '模拟买家' : 'AI' }}</b>
        <div>{{ item.content }}</div>
      </div>
    </div>
    <form class="runtime-form" @submit.prevent="send">
      <label
        >模拟买家问题<el-input
          v-model="question"
          type="textarea"
          :rows="3"
          aria-label="模拟买家问题"
          maxlength="2000"
          :disabled="pending" /></label
      ><label
        >测试图片地址（可选，每行一个）<el-input
          v-model="images"
          type="textarea"
          :rows="2"
          aria-label="测试图片地址"
          placeholder="最多 4 张公网 HTTPS 图片，需本店启用识图及模型支持"
          :disabled="pending"
      /></label>
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="pending"
          :disabled="!runtime.available || !storeId || !question.trim() || Boolean(productIssue)"
          >发送测试</el-button
        ><el-button :disabled="pending" @click="history = []">清空模拟对话</el-button>
      </div>
    </form>
  </RuntimePanel>
</template>

<style scoped>
.knowledge-training-panel {
  height: auto;
  min-height: 100%;
  overflow: visible;
  padding: 18px 4px 32px;
  background: transparent;
}
.knowledge-training-shop,
.knowledge-training-products {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  border: 1px solid #dfe6ef;
  border-radius: 8px;
  background: #f8fafc;
}
.knowledge-training-shop span,
.knowledge-training-products p {
  margin: 0;
  color: #606266;
  font-size: 13px;
}
.knowledge-training-products label {
  display: grid;
  gap: 7px;
  color: #303133;
}
.knowledge-training-products input,
.knowledge-training-products select {
  min-height: 34px;
  padding: 6px 9px;
  border: 1px solid #dcdfe6;
  border-radius: 5px;
  background: #fff;
}
</style>
