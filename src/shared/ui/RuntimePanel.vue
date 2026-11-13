<script setup lang="ts">
import { useRuntimeStore } from '../state/runtime'
withDefaults(
  defineProps<{ title: string; description?: string; error?: string; message?: string }>(),
  { description: '', error: '', message: '' },
)
const runtime = useRuntimeStore()
</script>
<template>
  <section class="runtime-page">
    <header class="runtime-page__head" data-window-drag>
      <div>
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="runtime-actions"><slot name="actions" /></div>
    </header>
    <el-alert
      v-if="!runtime.available"
      title="浏览器预览：请使用桌面版保存数据、配置模型和连接店铺。"
      type="info"
      :closable="false"
    />
    <el-alert
      v-if="runtime.error || error"
      :title="error || runtime.error"
      type="error"
      :closable="false"
      role="alert"
    />
    <el-alert v-if="message" :title="message" type="success" :closable="false" role="status" />
    <slot />
  </section>
</template>
