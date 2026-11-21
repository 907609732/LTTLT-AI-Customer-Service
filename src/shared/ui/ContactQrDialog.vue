<script setup lang="ts">
import { PRODUCT_NAME } from '@/shared/brand'
import supportQr from './assets/support-wecom.png'
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
    <div class="contact-qr">
      <img :src="supportQr" alt="企业微信客服二维码" width="260" height="260" />
      <p>用微信扫码添加客服</p>
    </div>
    <template #footer
      ><el-button @click="emit('update:modelValue', false)">关闭</el-button></template
    >
  </el-dialog>
</template>

<style scoped>
.contact-qr {
  text-align: center;
}
.contact-qr img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.contact-qr p {
  margin: 8px 0 0;
}
</style>
