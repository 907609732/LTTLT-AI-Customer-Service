<script setup lang="ts">
import { useRuntimeStore } from '../state/runtime'
const runtime = useRuntimeStore()
withDefaults(defineProps<{ disabled?: boolean; label?: string }>(), {
  disabled: false,
  label: '当前店铺',
})
</script>
<template>
  <label class="runtime-store-select"
    >{{ label }}
    <el-select
      v-model="runtime.selectedStoreId"
      :disabled="disabled || !runtime.snapshot.stores.length"
      :aria-label="label"
      placeholder="请先添加店铺"
    >
      <el-option
        v-for="shop in runtime.snapshot.stores"
        :key="shop.id"
        :value="shop.id"
        :label="shop.storeName || '待识别店铺'"
      />
    </el-select>
  </label>
</template>
