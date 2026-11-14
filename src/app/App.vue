<script setup lang="ts">
import { ShopSetupGuide } from '@/modules/shops'
</script>
<template>
  <div class="application-page"><router-view /></div>
  <ShopSetupGuide />
</template>
<style scoped>
.application-page {
  height: 100%;
  min-height: 0;
}
</style>
