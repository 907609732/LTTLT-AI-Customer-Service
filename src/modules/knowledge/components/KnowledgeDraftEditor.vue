<script setup lang="ts">
import { computed } from 'vue'
import type { KnowledgeDraftInput, ProductBinding } from '@/shared/contracts/knowledge'
const props = defineProps<{
  draft: KnowledgeDraftInput
  bindings: ProductBinding[]
  stores: { id: string; storeName: string }[]
  hasCanonical: boolean
  scopeValue?: string
}>()
const emit = defineEmits<{
  patch: [patch: Partial<KnowledgeDraftInput>]
  scope: [value: string]
  template: [storeId: string, applied: boolean]
  save: []
  review: []
  discard: []
}>()
const value = (event: Event) => (event.target as HTMLInputElement).value
const templateStores = computed(() => {
  const ids = props.draft.scope.kind === 'template' ? props.draft.scope.storeIds : []
  return [
    ...props.stores,
    ...ids
      .filter((id) => !props.stores.some((s) => s.id === id))
      .map((id) => ({ id, storeName: '已移除店铺 ' + id })),
  ]
})
const minDate = computed(() => new Date().toISOString().slice(0, 16))
</script>
<template>
  <form class="knowledge-editor" @submit.prevent="emit('save')">
    <label
      >问题<input
        data-testid="draft-question"
        :value="draft.question"
        @input="emit('patch', { question: value($event) })"
        maxlength="4000" /></label
    ><label
      >标准答案<textarea
        data-testid="draft-answer"
        :value="draft.answer"
        @input="emit('patch', { answer: value($event) })"
        rows="7"
        maxlength="30000"
      /></label
    ><label
      >生效范围<select :value="scopeValue" @change="emit('scope', value($event))">
        <option v-if="hasCanonical" value="canonical">共享商品（影响所有关联店铺）</option>
        <option v-for="binding in bindings" :key="binding.id" :value="'binding:' + binding.id">
          本店 {{ binding.skuId ? 'SKU ' + binding.skuId : '商品覆盖' }}
        </option>
        <option value="store">本店通用问答</option>
        <option value="template">公共模板（选择应用店铺）</option>
      </select></label
    >
    <fieldset v-if="draft.scope.kind === 'template'">
      <legend>明确应用店铺</legend>
      <label v-for="shop in templateStores" :key="shop.id"
        ><input
          type="checkbox"
          :checked="draft.scope.storeIds.includes(shop.id)"
          @change="emit('template', shop.id, ($event.target as HTMLInputElement).checked)"
        />{{ shop.storeName }}</label
      >
    </fieldset>
    <label
      >资料类型<select
        :value="draft.field"
        @change="emit('patch', { field: value($event) as KnowledgeDraftInput['field'] })"
      >
        <option value="fact">静态事实</option>
        <option :disabled="['canonical', 'template'].includes(draft.scope.kind)" value="price">
          价格
        </option>
        <option :disabled="['canonical', 'template'].includes(draft.scope.kind)" value="stock">
          库存
        </option>
        <option :disabled="['canonical', 'template'].includes(draft.scope.kind)" value="activity">
          活动
        </option>
      </select></label
    ><label v-if="draft.field !== 'fact'"
      >有效至（留空使用配置TTL）<input
        type="datetime-local"
        :min="minDate"
        :value="
          draft.expiresAt
            ? new Date(draft.expiresAt - new Date().getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16)
            : ''
        "
        @change="
          emit('patch', { expiresAt: value($event) ? new Date(value($event)).getTime() : null })
        "
    /></label>
    <p class="knowledge-muted">
      {{ draft.sourceRefs?.length || 0 }} 个精确来源版本；手写修改不会自动审核。
    </p>
    <div class="knowledge-editor-actions">
      <button data-testid="save-draft" type="submit">保存草稿</button
      ><button type="button" class="primary" @click="emit('review')">审核并发布…</button
      ><button type="button" @click="emit('discard')">放弃未保存编辑</button>
    </div>
  </form>
</template>
