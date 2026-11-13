<!-- UpdateAvailableDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
interface Props {
  modelValue?: boolean
}
import { notifyUnavailable } from '@/shared/ui/feedback'
import IconClose from '@/shared/icons/IconClose.vue'
import IconPromotion from '@/shared/icons/IconPromotion.vue'
import IconDocument from '@/shared/icons/IconDocument.vue'
import IconConnection from '@/shared/icons/IconConnection.vue'
import IconDataLine from '@/shared/icons/IconDataLine.vue'
import IconInfoFilled from '@/shared/icons/IconInfoFilled.vue'
import BrandMark from '@/shared/ui/BrandMark.vue'
import { ref } from 'vue'
import { createUpdateAvailableDialogDemo } from '@/modules/workbench/demo/UpdateAvailableDialog'
const demo = createUpdateAvailableDialogDemo()
const __stub = notifyUnavailable
const closeOnClickModalItems = ref(demo.closeOnClickModalItems)
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
    class="update-available-dialog"
    width="560px"
    align-center=""
    :show-close="!1"
    :close-on-click-modal="!closeOnClickModalItems?.['dialogForce']"
    :close-on-press-escape="!closeOnClickModalItems?.['dialogForce']"
    :append-to-body="!0"
    data-v-9372a261=""
    ><button
      type="button"
      class="update-dialog-close"
      aria-label="关闭"
      @click="__stub('此操作')"
      data-v-9372a261=""
    >
      <el-icon size="16" data-v-9372a261=""
        ><component :is="IconClose" data-v-9372a261=""></component
      ></el-icon>
    </button>
    <div class="update-dialog-brand" data-v-9372a261="">
      <BrandMark size="md" subtitle="" data-v-9372a261=""></BrandMark>
    </div>
    <div class="update-dialog-title-row" data-v-9372a261="">
      <h2 data-v-9372a261="">发现新版本</h2>
      <span class="update-new-badge" data-v-9372a261="">NEW</span>
    </div>
    <div class="update-version-row" data-v-9372a261="">
      <span class="update-version-pill" data-v-9372a261=""></span
      ><span class="update-version-arrow" data-v-9372a261="">→</span
      ><span class="update-version-pill update-version-pill--next" data-v-9372a261=""></span>
    </div>
    <template v-if="props.modelValue"
      ><p class="update-force-tip" data-v-9372a261="">
        当前版本过低，必须更新后才能继续使用。
      </p></template
    >
    <div class="update-body" data-v-9372a261="">
      <ul class="update-changelog" data-v-9372a261="">
        <template :key="index" v-for="(item, index) in closeOnClickModalItems?.['changelog']"
          ><li data-v-9372a261="">
            <span class="update-change-icon" :data-tone="item?.['icon']" data-v-9372a261=""
              ><el-icon size="14" data-v-9372a261=""
                ><component
                  :is="
                    {
                      rocket: IconPromotion,
                      document: IconDocument,
                      flow: IconConnection,
                      chart: IconDataLine,
                    }?.[item?.['icon']] || IconPromotion
                  "
                  data-v-9372a261=""
                ></component></el-icon></span
            ><span data-v-9372a261="">{{ item?.['text'] }}</span>
          </li></template
        >
      </ul>
      <div class="update-mascot" aria-hidden="true" data-v-9372a261="">
        <img :src="src" alt="" data-v-9372a261="" /><i class="spark spark-a" data-v-9372a261=""></i
        ><i class="spark spark-b" data-v-9372a261=""></i
        ><i class="spark spark-c" data-v-9372a261=""></i>
      </div>
    </div>
    <div class="update-dialog-footer" data-v-9372a261="">
      <template v-if="closeOnClickModalItems?.['packageSizeLabel']"
        ><div class="update-meta" data-v-9372a261="">
          <div class="update-size" data-v-9372a261="">
            <el-icon size="14" data-v-9372a261=""
              ><component :is="IconInfoFilled" data-v-9372a261=""></component></el-icon
            ><span data-v-9372a261=""></span>
          </div></div
      ></template>
      <div class="update-actions" data-v-9372a261="">
        <button
          type="button"
          class="update-btn update-btn--ghost"
          @click="__stub('此操作')"
          data-v-9372a261=""
        >
          稍后提醒</button
        ><button
          type="button"
          class="update-btn update-btn--primary"
          @click="__stub('此操作')"
          data-v-9372a261=""
        >
          立即更新
        </button>
      </div>
    </div></el-dialog
  >
</template>
