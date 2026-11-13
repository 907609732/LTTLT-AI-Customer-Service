<!-- SnapOverlayView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref } from 'vue'
import { createSnapOverlayViewDemo } from '@/modules/auxiliary/demo/SnapOverlayView'
const demo = createSnapOverlayViewDemo()
const __stub = notifyUnavailable
const x = ref(demo.x)
</script>

<template>
  <div :class="['snap-overlay-root', { 'has-menu': !!x }]" aria-live="polite">
    <template v-if="x"
      ><div
        class="snap-overlay-menu"
        :style="{ left: x?.['x'] + 'px', top: x?.['y'] + 'px', minWidth: x?.['width'] + 'px' }"
      >
        <template :key="entryIndex" v-for="(item, entryIndex) in x?.['items']"
          ><button
            type="button"
            :class="[
              'snap-overlay-menu-item',
              { divided: item?.['divided'], active: item?.['active'], rich: !!item?.['detail'] },
            ]"
            @click="__stub('此操作')"
          >
            <template v-if="item?.['detail']"
              ><strong>{{ item?.['label'] }}</strong>
              <p>{{ item?.['detail'] }}</p></template
            ><template v-else>{{ item?.['label'] }}</template>
          </button></template
        >
      </div></template
    >
  </div>
</template>
