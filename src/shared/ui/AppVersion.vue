<script setup lang="ts">
const version = __APP_VERSION__
</script>

<template>
  <span class="app-version" :title="`当前软件版本 v${version}`" aria-label="软件版本"
    >v{{ version }}</span
  >
</template>

<style scoped>
.app-version {
  display: block;
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 8px 12px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  user-select: text;
}
</style>
