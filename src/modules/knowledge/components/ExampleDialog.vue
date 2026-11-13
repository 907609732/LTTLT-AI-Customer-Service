<!-- ExampleDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createExampleDialogDemo } from '@/modules/knowledge/demo/ExampleDialog'
const demo = createExampleDialogDemo()
interface Props {
  modelValue?: boolean
  activeId?: boolean
  packs?: string
}
const props = withDefaults(defineProps<Props>(), { modelValue: false, activeId: false, packs: '' })
const __stub = notifyUnavailable
const rows = computed(() => demo.rows)
const rowsSummary = computed(() => demo.rowsSummary)
const button = ref(demo.button)
const exBtn = computed(() => demo.exBtn)
const exSubline = computed(() => demo.exSubline)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    title="预览品类模板"
    width="720px"
    destroy-on-close=""
    class="aicustom-example-dlg"
    @update:modelValue="emit('update:modelValue', $event)"
    data-v-e5f1af05=""
    ><template #footer
      ><button
        type="button"
        class="ex-btn ex-btn--ghost"
        @click="__stub('此操作')"
        data-v-e5f1af05=""
      >
        暂不采纳</button
      ><button
        type="button"
        class="ex-btn ex-btn--primary"
        @click="__stub('此操作')"
        data-v-e5f1af05=""
      >
        {{ exBtn ? `采纳${exBtn?.name}` : '采纳整类' }}
      </button></template
    >
    <p class="ex-tip" data-v-e5f1af05="">
      先选类目，再选子类目。确认符合本店后再采纳。采纳会覆盖当前编辑框，店名可以改成真实店名后再保存。
    </p>
    <div class="ex-group" data-v-e5f1af05="">
      <span class="ex-label ex-label--hot" data-v-e5f1af05="">热门</span>
      <div class="ex-tabs" data-v-e5f1af05="">
        <template :key="entryIndex" v-for="(item, entryIndex) in rows?.hot"
          ><button
            type="button"
            :class="['ex-tab ex-tab--hot', { 'is-on': item?.id }]"
            @click="__stub('此操作')"
            data-v-e5f1af05=""
          >
            {{ item?.short || item?.name }}
          </button></template
        >
      </div>
    </div>
    <template v-if="props.modelValue"
      ><div class="ex-group" data-v-e5f1af05="">
        <span class="ex-label" data-v-e5f1af05="">更多</span>
        <div class="ex-tabs ex-tabs--more" data-v-e5f1af05="">
          <template :key="entryIndex" v-for="(item, entryIndex) in rows?.more"
            ><button
              type="button"
              :class="['ex-tab', { 'is-on': item?.id }]"
              @click="__stub('此操作')"
              data-v-e5f1af05=""
            >
              {{ item?.short || item?.name }}
            </button></template
          >
        </div>
      </div></template
    ><template v-if="true"
      ><div class="ex-group" data-v-e5f1af05="">
        <span class="ex-label" data-v-e5f1af05="">子类</span>
        <div class="ex-tabs ex-tabs--sub" data-v-e5f1af05="">
          <button
            type="button"
            :class="['ex-tab ex-tab--sub', { 'is-on': !button }]"
            @click="__stub('此操作')"
            data-v-e5f1af05=""
          >
            全部</button
          ><template :key="entryIndex" v-for="(item, entryIndex) in rowsSummary?.subs"
            ><button
              type="button"
              :class="['ex-tab ex-tab--sub', { 'is-on': item?.id === button }]"
              @click="__stub('此操作')"
              data-v-e5f1af05=""
            >
              {{ item?.name }}
            </button></template
          >
        </div>
      </div></template
    ><template v-if="rowsSummary"
      ><div class="ex-card" data-v-e5f1af05="">
        <strong data-v-e5f1af05=""
          >{{ exBtn ? `${rowsSummary?.name} · ${exBtn?.name}` : rowsSummary?.name
          }}<template v-if="rowsSummary?.hot"
            ><em class="ex-hot-tag" data-v-e5f1af05="">热门</em></template
          ></strong
        ><em class="ex-subline" data-v-e5f1af05="">{{ exBtn ? exBtn?.name : rowsSummary?.tip }}</em>
        <pre class="ex-pre" data-v-e5f1af05="">{{ exSubline }}</pre>
      </div></template
    ></el-dialog
  >
</template>
