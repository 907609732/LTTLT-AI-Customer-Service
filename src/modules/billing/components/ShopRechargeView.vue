<script setup lang="ts">
import BillingDashboard from './BillingDashboard.vue'
import AppWindowBar from '@/shared/ui/AppWindowBar.vue'
import { useRouter } from 'vue-router'
const router = useRouter()
</script>
<template>
  <div class="recharge-page">
    <AppWindowBar>
      <button @click="router.push('/')">返回工作台</button>
      <button @click="router.push('/shop/manage')">返回配置中心</button>
    </AppWindowBar>
    <BillingDashboard section="plans" />
  </div>
</template>
<style scoped>
.recharge-page {
  min-height: 100%;
  background: #f5f8fc;
}
button {
  border: 1px solid #dce8fb;
  background: #fff;
  border-radius: 7px;
  color: #334761;
  padding: 8px 12px;
  cursor: pointer;
}
button:hover {
  background: #edf5ff;
}
</style>
