<script setup lang="ts">
import { ref } from 'vue'
import ContactQrDialog from './ContactQrDialog.vue'
import qr from '@/assets/yunduo-contact-qr-sCxlNm8O.png'
withDefaults(defineProps<{ text?: string; plain?: boolean }>(), { text: '联系客服', plain: false })
const visible = ref(false)
</script>
<template>
  <button
    type="button"
    :class="['contact-qr-trigger', { 'is-plain': plain }]"
    title="查看客服二维码"
    data-v-3008b96d=""
    @click="visible = true"
  >
    <img :src="qr" alt="" data-v-3008b96d="" /><span data-v-3008b96d="">{{ text }}</span>
  </button>
  <ContactQrDialog v-model="visible" />
</template>
