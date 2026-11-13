<script setup lang="ts">
import logo from '@/assets/lingtu-ai-icon.png'
import { PRODUCT_NAME } from '@/shared/brand'
withDefaults(defineProps<{ subtitle?: string; size?: string }>(), { subtitle: '', size: 'md' })
</script>
<template>
  <div :class="['brand-mark', 'brand-mark--' + size]" :aria-label="PRODUCT_NAME">
    <div class="brand-mark-icons">
      <img class="brand-mark-icon brand-mark-icon--primary" :src="logo" :alt="PRODUCT_NAME" />
    </div>
    <div class="brand-mark-copy">
      <strong>{{ PRODUCT_NAME }}</strong
      ><span v-if="subtitle">{{ subtitle }}</span>
    </div>
  </div>
</template>
