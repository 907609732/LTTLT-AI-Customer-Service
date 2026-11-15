<script setup lang="ts">
import type { KnowledgeCatalogPage } from '@/shared/contracts/knowledge-pipeline'
defineProps<{ catalog: KnowledgeCatalogPage; storeName: string; search: string; busy: boolean }>()
const selected = defineModel<string[]>('selected', { required: true })
const all = defineModel<boolean>('all', { required: true })
defineEmits<{ close: []; next: [cursor: string]; collect: [] }>()
</script>
<template>
  <div class="knowledge-modal-backdrop">
    <section class="knowledge-modal" role="dialog" aria-label="选择在售商品后采集">
      <h2>选择在售商品后采集</h2>
      <p>
        {{ catalog.range }} · 筛选总量 {{ catalog.total ?? '未知' }} ·
        {{ catalog.complete ? '全部目录页与总量已核对' : '目录范围尚未完整' }}
      </p>
      <p>
        店铺 {{ storeName }} · 筛选 {{ search || '全部在售' }} · 已明确选择
        {{ all ? catalog.total : selected.length }} 项（含其他目录页的选择）
      </p>
      <label
        ><input
          type="checkbox"
          v-model="all"
          :disabled="busy || !catalog.complete || catalog.total === null || catalog.total > 1000"
        />明确采集当前筛选全部 {{ catalog.total ?? '未知' }} 项</label
      >
      <p v-if="!catalog.complete || catalog.total === null">
        全部筛选采集须先核对全部页及总量；可以逐项选择已核对商品。
      </p>
      <p v-else-if="catalog.total > 1000">单任务最多1000项，请明确分批选择。</p>
      <label v-for="item in catalog.items" :key="item.productId"
        ><input
          type="checkbox"
          :value="item.productId"
          v-model="selected"
          :disabled="busy || all"
        />{{ item.title }} · {{ item.productId }}</label
      >
      <p v-if="!catalog.items.length">
        当前核对页没有符合筛选的商品。{{ catalog.nextCursor ? '可继续读取下一页。' : '' }}
      </p>
      <footer>
        <button :disabled="busy" @click="$emit('close')">取消</button
        ><button
          v-if="catalog.nextCursor"
          :disabled="busy"
          @click="$emit('next', catalog.nextCursor)"
        >
          下一页目录</button
        ><button
          class="primary"
          :disabled="busy || (!all && !selected.length)"
          @click="$emit('collect')"
        >
          采集明确所选 {{ all ? catalog.total : selected.length }} 项
        </button>
      </footer>
    </section>
  </div>
</template>
