<!-- MascotFloatView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createMascotFloatViewDemo } from '@/modules/auxiliary/demo/MascotFloatView'
const demo = createMascotFloatViewDemo()
const __stub = notifyUnavailable
const div = ref(demo.div)
const button = ref(demo.button)
const isDiv = ref(demo.isDiv)
const title = ref(demo.title)
const buttonState = ref(demo.buttonState)
const isTemplate = ref(demo.isTemplate)
const style = ref(demo.style)
const styleState = ref(demo.styleState)
const isDivSummary = computed(() => demo.isDivSummary)
const divSummary = computed(() => demo.divSummary)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const src = ref(demo.src)
</script>

<template>
  <div
    :class="[
      'mascot-float',
      ['is-' + divSummary, { 'has-tip': isDiv && div, 'has-badge': !!isDivSummary }],
    ]"
    @pointerenter="__stub('此操作')"
    @pointerleave="__stub('此操作')"
    @contextmenu="__stub('此操作')"
    data-v-bb61a4be=""
  >
    <div class="mascot-float-drag" title="按住拖动" data-v-bb61a4be=""></div>
    <button
      type="button"
      class="mascot-float-unpin"
      title="收回主界面"
      @click="__stub('此操作')"
      data-v-bb61a4be=""
    >
      ×</button
    ><template v-if="isTemplateSummary"
      ><span class="mascot-float-filter-tag" data-v-bb61a4be="">{{
        isTemplateSummary
      }}</span></template
    ><template v-if="isDiv && div"
      ><button
        type="button"
        :class="['mascot-float-tip', 'is-' + button]"
        :title="title ? div + '（' + title + '）' : div"
        @click="__stub('此操作')"
        data-v-bb61a4be=""
      >
        <strong data-v-bb61a4be="">{{ div }}</strong
        ><template v-if="title"
          ><span data-v-bb61a4be="">{{ title }}</span></template
        >
      </button></template
    ><button
      type="button"
      class="mascot-float-avatar"
      title="打开 AI 辅助中心 · 右键筛选"
      @click="__stub('此操作')"
      data-v-bb61a4be=""
    >
      <img :src="src" alt="云朵" draggable="false" data-v-bb61a4be="" /><template
        v-if="isDivSummary"
        ><span class="mascot-float-badge" data-v-bb61a4be="">{{ isDivSummary }}</span></template
      ></button
    ><template v-if="isTemplate"
      ><div
        class="mascot-float-menu"
        :style="{ left: style + 'px', top: styleState + 'px' }"
        data-v-bb61a4be=""
      >
        <button
          type="button"
          :class="{ active: buttonState === 'consult' }"
          @click="__stub('此操作')"
          data-v-bb61a4be=""
        >
          只看咨询</button
        ><button
          type="button"
          :class="{ active: buttonState === 'warn' }"
          @click="__stub('此操作')"
          data-v-bb61a4be=""
        >
          只看预警</button
        ><template v-if="buttonState !== 'all'"
          ><button
            type="button"
            :class="{ active: buttonState === 'all' }"
            @click="__stub('此操作')"
            data-v-bb61a4be=""
          >
            全部提醒
          </button></template
        ><button type="button" class="is-danger" @click="__stub('此操作')" data-v-bb61a4be="">
          收回主界面
        </button>
      </div></template
    >
  </div>
</template>
