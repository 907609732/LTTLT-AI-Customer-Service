<script setup lang="ts">
import type { ProductCatalogRow } from '@/shared/contracts/product-catalog'
import type { SizeRuleBinding, SizeRuleRecord } from '@/shared/contracts/size-rules'

interface StoreOption {
  id: string
  storeName: string
}
const props = defineProps<{
  bindings: SizeRuleBinding[]
  stores: StoreOption[]
  rules: SizeRuleRecord[]
  draftRuleId?: string
  products: ProductCatalogRow[]
  storeId: string
  query: string
  offset: number
  total: number
  loading: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:storeId': [value: string]
  'update:query': [value: string]
  page: [delta: number]
  toggle: [binding: SizeRuleBinding, checked: boolean]
  release: [binding: SizeRuleBinding]
}>()
const keyOf = (binding: SizeRuleBinding) => JSON.stringify([binding.storeId, binding.productId])
const isBound = (binding: SizeRuleBinding) =>
  props.bindings.some((item) => keyOf(item) === keyOf(binding))
const ownerFor = (binding: SizeRuleBinding) => {
  const key = keyOf(binding)
  return props.rules.find(
    (rule) => rule.id !== props.draftRuleId && rule.bindings.some((item) => keyOf(item) === key),
  )
}
const storeName = (id: string) => props.stores.find((store) => store.id === id)?.storeName || id
function toggle(row: ProductCatalogRow, event: Event) {
  emit(
    'toggle',
    { storeId: props.storeId, productId: row.productId },
    (event.target as HTMLInputElement).checked,
  )
}
function inputValue(event: Event) {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <fieldset class="size-rules__bindings" :disabled="disabled">
    <legend>店铺与商品绑定 · 已选 {{ bindings.length }} 个商品</legend>
    <p>停用规则仍保留归属；若商品已归属其他规则，必须先解除原绑定。</p>
    <label class="size-rules__field">
      绑定店铺
      <select
        :value="storeId"
        aria-label="绑定店铺"
        @change="emit('update:storeId', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">请选择店铺</option>
        <option v-for="store in stores" :key="store.id" :value="store.id">
          {{ store.storeName || store.id }}
        </option>
      </select>
    </label>
    <label class="size-rules__field">
      搜索绑定商品
      <input
        :value="query"
        aria-label="搜索绑定商品"
        maxlength="200"
        placeholder="商品编号、编码或名称"
        @input="emit('update:query', inputValue($event))"
      />
    </label>
    <div class="size-rules__catalog" :aria-busy="loading">
      <p v-if="loading">正在读取商品目录…</p>
      <p v-else-if="!products.length">
        {{ storeId ? '当前商品目录没有符合条件的结果。' : '请选择店铺。' }}
      </p>
      <template v-else>
        <label v-for="row in products" :key="row.productId">
          <input
            type="checkbox"
            :aria-label="`绑定商品 ${row.productId}`"
            :checked="isBound({ storeId, productId: row.productId })"
            :disabled="Boolean(ownerFor({ storeId, productId: row.productId }))"
            @change="toggle(row, $event)"
          />
          {{ row.title }} · {{ row.productId }}
          <span v-if="row.enabled === false">（商品知识已停用）</span>
          <span v-if="ownerFor({ storeId, productId: row.productId })">
            （已归属 {{ ownerFor({ storeId, productId: row.productId })?.name }}）
          </span>
        </label>
      </template>
    </div>
    <div class="size-rules__pager">
      <button type="button" :disabled="loading || offset === 0" @click="emit('page', -20)">
        商品上一页
      </button>
      <button type="button" :disabled="loading || offset + 20 >= total" @click="emit('page', 20)">
        商品下一页
      </button>
    </div>
    <ul class="size-rules__binding-list">
      <li v-for="binding in bindings" :key="`${binding.storeId}:${binding.productId}`">
        <button
          type="button"
          :aria-label="`解除绑定 ${binding.storeId} ${binding.productId}`"
          @click="emit('release', binding)"
        >
          {{ storeName(binding.storeId) }} · {{ binding.productId }} ×
        </button>
      </li>
    </ul>
  </fieldset>
</template>
