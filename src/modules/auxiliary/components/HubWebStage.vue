<!-- HubWebStage：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref } from 'vue'
import { createHubWebStageDemo } from '@/modules/auxiliary/demo/HubWebStage'
const demo = createHubWebStageDemo()
interface Props {
  tabs?: Array<string>
  activeId?: string
}
const props = withDefaults(defineProps<Props>(), { tabs: () => [], activeId: '' })
const __stub = notifyUnavailable
const hubZoomCapture = ref(demo.hubZoomCapture)
</script>

<template>
  <main class="hub-stage">
    <div class="hub-stage__views"></div>
    <div
      v-show="hubZoomCapture"
      class="hub-zoom-capture"
      title="Ctrl + 滚轮缩放"
      @wheel="__stub('此操作')"
    ></div>
    <div :class="['hub-empty', { 'is-visible': !props?.['tabs']?.['length'] }]">
      <p>还没有打开的后台</p>
      <p class="sub">在店铺上右键「打开商家后台」后，会汇总到这里</p>
    </div>
  </main>
</template>
