<!-- EnvHealthBanner：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createEnvHealthBannerDemo } from '@/modules/workbench/demo/EnvHealthBanner'
const demo = createEnvHealthBannerDemo()
const __stub = notifyUnavailable
const missing = ref(demo.missing)
const isTemplate = computed(() => demo.isTemplate)
const div = computed(() => demo.div)
const envHealthBanner__mark = computed(() => demo.envHealthBanner__mark)
const envHealthBanner__body = computed(() => demo.envHealthBanner__body)
const envHealthBanner__action = computed(() => demo.envHealthBanner__action)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
</script>

<template>
  <template v-if="isTemplate"
    ><div :class="['env-health-banner', div]" role="status" data-v-cdeeb7c1="">
      <span class="env-health-banner__mark" data-v-cdeeb7c1="">!</span>
      <div class="env-health-banner__body" data-v-cdeeb7c1="">
        <strong data-v-cdeeb7c1="">{{ envHealthBanner__mark }}</strong>
        <p data-v-cdeeb7c1="">{{ envHealthBanner__body }}</p>
        <template v-if="missing?.['repairError']"
          ><p class="env-health-banner__err" data-v-cdeeb7c1="">
            {{ missing?.['repairError'] }}
          </p></template
        >
      </div>
      <div class="env-health-banner__acts" data-v-cdeeb7c1="">
        <template v-if="isTemplateSummary"
          ><button
            type="button"
            class="env-health-banner__action"
            :disabled="missing?.['repairing']"
            @click="__stub('此操作')"
            data-v-cdeeb7c1=""
          >
            {{ envHealthBanner__action }}
          </button></template
        ><button
          type="button"
          class="env-health-banner__close"
          aria-label="关闭"
          @click="__stub('此操作')"
          data-v-cdeeb7c1=""
        >
          ×
        </button>
      </div>
    </div></template
  >
</template>
