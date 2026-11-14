<script setup lang="ts">
import { ShopSetupGuide, useShopSetupStore } from '@/modules/shops'
const setup = useShopSetupStore()
</script>
<template>
  <div class="application-page" :inert="setup.visible"><router-view /></div>
  <ShopSetupGuide />
</template>
<style scoped>
.application-page {
  height: 100%;
  min-height: 0;
}
</style>
