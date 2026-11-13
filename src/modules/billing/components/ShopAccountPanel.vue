<script setup lang="ts">
import { useRouter } from 'vue-router'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
withDefaults(defineProps<{ viewKey?: string }>(), { viewKey: 'account' })
const router = useRouter()
</script>
<template>
  <RuntimePanel
    :title="
      viewKey === 'orders'
        ? '软件订单'
        : viewKey === 'usage'
          ? '模型用量'
          : viewKey === 'general'
            ? '软件偏好'
            : '本机使用模式'
    "
    description="当前使用自己的模型 API Key，无需注册或登录软件账号。"
    ><p>
      模型调用费用与用量以你选择的服务商账户为准。本工程未启用托管账号、软件充值和团队权限服务。
    </p>
    <p>店铺平台仍需在各店铺工作台完成登录，店铺会话互相隔离。</p>
    <el-button type="primary" @click="router.push('/settings')"
      >打开模型与本机设置</el-button
    ></RuntimePanel
  >
</template>
