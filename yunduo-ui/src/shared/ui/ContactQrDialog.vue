<script setup lang="ts">
import qr from '@/assets/yunduo-contact-qr-sCxlNm8O.png'
withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
</script>
<template>
  <el-dialog
    :model-value="modelValue"
    title="联系客服"
    width="420px"
    append-to-body
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <img :src="qr" alt="客服二维码" style="display: block; width: 240px; margin: auto" />
    <template #footer
      ><el-button @click="emit('update:modelValue', false)">关闭</el-button></template
    >
  </el-dialog>
</template>
