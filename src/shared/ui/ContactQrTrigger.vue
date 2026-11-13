<script setup lang="ts">
import { ref } from 'vue'
import ContactQrDialog from './ContactQrDialog.vue'
import icon from '@/assets/lingtu-ai-icon.png'
withDefaults(defineProps<{ text?: string; plain?: boolean }>(), { text: '联系客服', plain: false })
const visible = ref(false)
</script>
<template>
  <button
    type="button"
    :class="['contact-qr-trigger', { 'is-plain': plain }]"
    title="查看联系方式"
    data-v-3008b96d=""
    @click="visible = true"
  >
    <img :src="icon" alt="" data-v-3008b96d="" /><span data-v-3008b96d="">{{ text }}</span>
  </button>
  <ContactQrDialog v-model="visible" />
</template>
