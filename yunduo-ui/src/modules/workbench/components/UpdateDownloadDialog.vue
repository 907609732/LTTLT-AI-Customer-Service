<!-- UpdateDownloadDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
interface Props {
  modelValue?: boolean
}
import { notifyUnavailable } from '@/shared/ui/feedback'
import IconClose from '@/shared/icons/IconClose.vue'
import IconWarningFilled from '@/shared/icons/IconWarningFilled.vue'
import IconOdometer from '@/shared/icons/IconOdometer.vue'
import IconClock from '@/shared/icons/IconClock.vue'
import BrandMark from '@/shared/ui/BrandMark.vue'
import { ref, computed } from 'vue'
import { createUpdateDownloadDialogDemo } from '@/modules/workbench/demo/UpdateDownloadDialog'
const demo = createUpdateDownloadDialogDemo()
const __stub = notifyUnavailable
const closeOnPressEscape = ref(demo.closeOnPressEscape)
const style = computed(() => demo.style)
const updateDownloadBrand = computed(() => demo.updateDownloadBrand)
const updateDownloadBarFill = computed(() => demo.updateDownloadBarFill)
const src = ref(demo.src)

const props = withDefaults(defineProps<Props>(), { modelValue: false })

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    @update:modelValue="emit('update:modelValue', $event)"
    class="update-download-dialog"
    width="520px"
    align-center=""
    :show-close="!1"
    :close-on-click-modal="!1"
    :close-on-press-escape="
      !closeOnPressEscape?.['dialogForce'] && closeOnPressEscape?.['downloadPhase'] !== 'installing'
    "
    :append-to-body="!0"
    data-v-ca527da7=""
    ><template v-if="props.modelValue"
      ><button
        type="button"
        class="update-download-close"
        aria-label="关闭"
        @click="__stub('此操作')"
        data-v-ca527da7=""
      >
        <el-icon size="16" data-v-ca527da7=""
          ><component :is="IconClose" data-v-ca527da7=""></component
        ></el-icon></button
    ></template>
    <div class="update-download-brand" data-v-ca527da7="">
      <BrandMark size="md" subtitle="" data-v-ca527da7=""></BrandMark>
    </div>
    <h3 data-v-ca527da7="">{{ updateDownloadBrand }}</h3>
    <template v-if="closeOnPressEscape?.['downloadPhase'] === 'error'"
      ><div class="update-download-error" data-v-ca527da7="">
        <el-icon size="28" data-v-ca527da7=""
          ><component :is="IconWarningFilled" data-v-ca527da7=""></component
        ></el-icon>
        <p data-v-ca527da7="">
          {{ closeOnPressEscape?.['downloadError'] || '下载失败，请稍后重试。' }}
        </p>
      </div>
      <div class="update-download-actions" data-v-ca527da7="">
        <button
          type="button"
          class="update-btn update-btn--primary"
          @click="__stub('此操作')"
          data-v-ca527da7=""
        >
          重试下载</button
        ><button
          type="button"
          class="update-btn update-btn--ghost"
          @click="emit('update:modelValue', false)"
          data-v-ca527da7=""
        >
          关闭
        </button>
      </div></template
    ><template v-else
      ><div class="update-download-main" data-v-ca527da7="">
        <div class="update-download-progress-block" data-v-ca527da7="">
          <div class="update-download-percent" data-v-ca527da7="">{{ style }}</div>
          <div class="update-download-bar" data-v-ca527da7="">
            <div
              class="update-download-bar-fill"
              :style="{ width: style }"
              data-v-ca527da7=""
            ></div>
          </div>
          <p class="update-download-bytes" data-v-ca527da7="">{{ updateDownloadBarFill }}</p>
        </div>
        <div class="update-download-mascot" aria-hidden="true" data-v-ca527da7="">
          <img :src="src" alt="" data-v-ca527da7="" /><i
            class="spark spark-a"
            data-v-ca527da7=""
          ></i
          ><i class="spark spark-b" data-v-ca527da7=""></i>
        </div>
      </div>
      <div class="update-download-stats" data-v-ca527da7="">
        <div class="update-download-stat" data-v-ca527da7="">
          <el-icon size="16" data-v-ca527da7=""
            ><component :is="IconOdometer" data-v-ca527da7=""></component
          ></el-icon>
          <div data-v-ca527da7="">
            <span data-v-ca527da7="">下载速度</span
            ><strong data-v-ca527da7="">{{ closeOnPressEscape?.['downloadSpeedLabel'] }}</strong>
          </div>
        </div>
        <div class="update-download-stat" data-v-ca527da7="">
          <el-icon size="16" data-v-ca527da7=""
            ><component :is="IconClock" data-v-ca527da7=""></component
          ></el-icon>
          <div data-v-ca527da7="">
            <span data-v-ca527da7="">预计剩余时间</span
            ><strong data-v-ca527da7="">{{ closeOnPressEscape?.['downloadEtaLabel'] }}</strong>
          </div>
        </div>
      </div>
      <div class="update-download-actions" data-v-ca527da7="">
        <template
          v-if="
            closeOnPressEscape?.['downloadPhase'] === 'downloading' &&
            !closeOnPressEscape?.['dialogForce']
          "
          ><button
            type="button"
            class="update-btn update-btn--ghost"
            @click="emit('update:modelValue', false)"
            data-v-ca527da7=""
          >
            取消下载
          </button></template
        ><template v-else-if="closeOnPressEscape?.['downloadPhase'] === 'installing'"
          ><p class="update-download-hint" data-v-ca527da7="">
            下载完成，正在自动启动安装…
          </p></template
        >
      </div></template
    ></el-dialog
  >
</template>
