<!-- RuntimeDownloadToast：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createRuntimeDownloadToastDemo } from '@/modules/workbench/demo/RuntimeDownloadToast'
const demo = createRuntimeDownloadToastDemo()
const __stub = notifyUnavailable
const span = computed(() => demo.span)
const isTemplate = computed(() => demo.isTemplate)
const style = computed(() => demo.style)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const runtimeDownloadToast__body = computed(() => demo.runtimeDownloadToast__body)
const displayText = ref(demo.displayText)
</script>

<template>
  <displayText name="runtime-toast" data-v-8625dcba=""
    ><template v-if="false"
      ><div class="runtime-download-toast" role="status" aria-live="polite" data-v-8625dcba="">
        <span
          :class="[
            'runtime-download-toast__icon',
            { error: span === 'error', done: span === 'done' },
          ]"
          data-v-8625dcba=""
          >{{ span === 'error' ? '!' : span === 'done' ? '✓' : 'i' }}</span
        >
        <div class="runtime-download-toast__body" data-v-8625dcba="">
          <p class="runtime-download-toast__msg" data-v-8625dcba="">
            {{ runtimeDownloadToast__body }}
          </p>
          <template v-if="isTemplate"
            ><div class="runtime-download-toast__bar" data-v-8625dcba="">
              <i :style="{ width: style + '%' }" data-v-8625dcba=""></i></div></template
          ><template v-if="isTemplateSummary"
            ><div class="runtime-download-toast__detail" data-v-8625dcba="">
              {{ isTemplateSummary }}
            </div></template
          >
        </div>
        <button
          type="button"
          class="runtime-download-toast__close"
          aria-label="关闭"
          @click="__stub('此操作')"
          data-v-8625dcba=""
        >
          ×
        </button>
      </div></template
    ></displayText
  >
</template>
