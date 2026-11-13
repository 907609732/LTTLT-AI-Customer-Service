<script setup lang="ts">
import { PRODUCT_NAME } from '@/shared/brand'
withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
</script>
<template>
  <el-dialog
    :model-value="modelValue"
    :title="`${PRODUCT_NAME} · 联系方式`"
    width="420px"
    append-to-body
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p>灵兔 AI 联系方式暂未配置。</p>
    <template #footer
      ><el-button @click="emit('update:modelValue', false)">关闭</el-button></template
    >
  </el-dialog>
</template>
