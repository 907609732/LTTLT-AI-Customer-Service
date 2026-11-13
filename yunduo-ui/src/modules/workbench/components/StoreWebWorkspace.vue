<!-- StoreWebWorkspace：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createStoreWebWorkspaceDemo } from '@/modules/workbench/demo/StoreWebWorkspace'
const demo = createStoreWebWorkspaceDemo()
interface Props {
  stores?: string
  activeStoreId?: boolean
  visible?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  stores: '',
  activeStoreId: false,
  visible: false,
})
const __stub = notifyUnavailable
const workspaceState = ref(demo.stores)
const storeZoomCapture = ref(demo.storeZoomCapture)
const rows = computed(() => demo.rows)
const style = computed(() => demo.style)
const styleSummary = computed(() => demo.styleSummary)
</script>

<template>
  <div
    :class="['store-web-workspace', { 'is-hidden': !workspaceState?.['visible'] }]"
    :style="style"
  >
    <div v-show="storeZoomCapture" class="store-zoom-capture" @wheel="__stub('此操作')"></div>
    <template :key="entryIndex" v-for="(item, entryIndex) in rows"
      ><webview
        :class="[
          'store-webview',
          { active: item?.['id'] === workspaceState?.['activeStoreId'], 'is-feige': false },
        ]"
        :style="styleSummary"
        :partition="item?.['webPartition']"
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no,backgroundThrottling=no"
        allowpopups=""
        @domReady="__stub('此操作')"
        @didFinishLoad="__stub('此操作')"
      ></webview
    ></template>
  </div>
</template>
