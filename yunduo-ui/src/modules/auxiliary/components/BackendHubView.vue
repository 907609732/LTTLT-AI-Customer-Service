<!-- BackendHubView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import HubTabBar from '@/modules/auxiliary/components/HubTabBar.vue'
import HubWebStage from '@/modules/auxiliary/components/HubWebStage.vue'
import { ref } from 'vue'
import { createBackendHubViewDemo } from '@/modules/auxiliary/demo/BackendHubView'
const demo = createBackendHubViewDemo()
const __stub = notifyUnavailable
const tabs = ref(demo.tabs)
const activeId = ref(demo.activeId)
const isOpeningAll = ref(demo.isOpeningAll)
</script>

<template>
  <div class="hub-root">
    <HubTabBar
      :tabs="tabs"
      :active-id="activeId"
      :opening-all="isOpeningAll"
      @select="__stub('此操作')"
      @close="__stub('此操作')"
      @openAll="__stub('此操作')"
    ></HubTabBar
    ><HubWebStage :tabs="tabs" :active-id="activeId"></HubWebStage>
  </div>
</template>
