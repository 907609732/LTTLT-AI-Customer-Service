<script setup lang="ts">
import logo from '@/assets/yunduo-customer-service-icon-Cu2_ooke.png'
withDefaults(defineProps<{ subtitle?: string; size?: string }>(), { subtitle: '', size: 'md' })
</script>
<template>
  <div :class="['brand-mark', 'brand-mark--' + size]" aria-label="云朵客服">
    <div class="brand-mark-icons">
      <img class="brand-mark-icon brand-mark-icon--primary" :src="logo" alt="云朵客服" />
    </div>
    <div class="brand-mark-copy">
      <strong>云朵客服</strong><span v-if="subtitle">{{ subtitle }}</span>
    </div>
  </div>
</template>
