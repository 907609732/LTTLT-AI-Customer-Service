<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeStore } from '@/shared/state/runtime'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import OrdersPanel from './OrdersPanel.vue'
import UsagePanel from './UsagePanel.vue'
withDefaults(defineProps<{ viewKey?: string }>(), { viewKey: 'account' })
const router = useRouter()
const runtime = useRuntimeStore()
const managed = computed(() => runtime.snapshot.managed)
const account = computed(() =>
  managed.value.active.mode === 'managed' && managed.value.session.status === 'signed_in'
    ? managed.value.session.account
    : null,
)
</script>
<template>
  <OrdersPanel v-if="viewKey === 'orders'" />
  <UsagePanel v-else-if="viewKey === 'usage'" />
  <RuntimePanel
    v-else
    :title="viewKey === 'general' ? '软件偏好' : '登录账号'"
    :description="
      account
        ? '当前使用托管账号，额度与订单由服务端维护。'
        : '当前未使用已登录的托管账号。本机 Key 费用由模型服务商管理。'
    "
  >
    <p v-if="account">当前账号：{{ account.displayName }}（{{ account.userId }}）</p>
    <p>店铺平台仍需在各店铺工作台完成登录，店铺会话互相隔离。</p>
    <el-button type="primary" @click="router.push('/settings')">打开账号与模型设置</el-button>
  </RuntimePanel>
</template>
