<script setup lang="ts">
withDefaults(defineProps<{ title?: string; subtitle?: string; viewKey?: string }>(), {
  title: '',
  subtitle: '',
  viewKey: '',
})
</script>
<template>
  <section class="shop-panel" data-v-1af97971="">
    <header class="shop-panel__head" data-v-1af97971="">
      <div class="shop-panel__titles" data-v-1af97971="">
        <h1 data-v-1af97971="">{{ title }}</h1>
        <p v-if="subtitle" data-v-1af97971="">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="shop-panel__acts" data-v-1af97971="">
        <slot name="actions" />
      </div>
    </header>
    <div class="shop-panel__body" data-v-1af97971=""><slot /></div>
  </section>
</template>
