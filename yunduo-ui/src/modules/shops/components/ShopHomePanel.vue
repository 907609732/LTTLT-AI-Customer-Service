<script setup lang="ts">
import { computed } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
const runtime = useRuntimeStore()
const stats = computed(() => [
  { label: '本机店铺', value: runtime.snapshot.stores.length },
  { label: '已连接店铺', value: runtime.snapshot.stores.filter((s) => s.runtime.online).length },
  { label: '已开启 AI', value: runtime.snapshot.stores.filter((s) => s.aiEnabled).length },
  { label: '本机商品知识', value: runtime.snapshot.products.total },
  { label: '已归档会话', value: runtime.snapshot.conversations.length },
  {
    label: '未完成本机工单',
    value: runtime.snapshot.workOrders.filter((x) => x.status !== 'done').length,
  },
])
</script>
<template>
  <RuntimePanel
    title="数据看板"
    description="仅统计当前本机工作区的真实记录；经营统计、平台订单及历史营收未接入。"
    ><div class="runtime-two-columns">
      <div v-for="stat in stats" :key="stat.label" class="runtime-card">
        <p>{{ stat.label }}</p>
        <h1>{{ stat.value }}</h1>
      </div>
    </div>
    <el-button :disabled="runtime.loading" @click="runtime.refresh()"
      >刷新本机数据</el-button
    ></RuntimePanel
  >
</template>
