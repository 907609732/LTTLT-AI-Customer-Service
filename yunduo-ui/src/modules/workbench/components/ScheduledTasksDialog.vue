<!-- ScheduledTasksDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import IconPlus from '@/shared/icons/IconPlus.vue'
import IconEditPen from '@/shared/icons/IconEditPen.vue'
import IconDelete from '@/shared/icons/IconDelete.vue'
import { ref } from 'vue'
import { createScheduledTasksDialogDemo } from '@/modules/workbench/demo/ScheduledTasksDialog'
const demo = createScheduledTasksDialogDemo()
interface Props {
  modelValue?: boolean
}
const props = withDefaults(defineProps<Props>(), { modelValue: false })
const __stub = notifyUnavailable
const stRowItems = ref(demo.stRowItems)
const select = ref(demo.select)
const rows = ref(demo.rows)
const rowsState = ref(demo.rowsState)
const rowsStateDetail = ref(demo.rowsStateDetail)

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
    title="定时任务"
    width="560px"
    append-to-body=""
    align-center=""
    :close-on-click-modal="!1"
    class="scheduled-tasks-dialog"
    data-v-6379a767=""
    ><div class="st-toolbar" data-v-6379a767="">
      <p class="st-tip" data-v-6379a767="">到点后自动执行一键上线 / 小休 / 离线 / AI 开关等操作</p>
      <button type="button" class="st-add" @click="__stub('此操作')" data-v-6379a767="">
        <el-icon data-v-6379a767=""
          ><component :is="IconPlus" data-v-6379a767=""></component
        ></el-icon>
        添加定时任务
      </button>
    </div>
    <div class="st-table" data-v-6379a767="">
      <div class="st-head" data-v-6379a767="">
        <span data-v-6379a767="">设定时间</span><span data-v-6379a767="">任务</span
        ><span data-v-6379a767="">状态</span><span data-v-6379a767="">操作</span>
      </div>
      <div class="st-empty" data-v-6379a767="">暂无定时任务，点击右上角添加</div>
      <template :key="entryIndex" v-for="(item, entryIndex) in stRowItems"
        ><div class="st-row" data-v-6379a767="">
          <div class="st-time" data-v-6379a767="">
            <strong data-v-6379a767=""></strong><em data-v-6379a767=""></em>
          </div>
          <div class="st-task" data-v-6379a767=""></div>
          <div class="st-status" data-v-6379a767="">
            <el-switch
              :model-value="item?.['enabled']"
              size="small"
              inline-prompt=""
              active-text="开"
              inactive-text="关"
              @update:modelValue="__stub('此操作')"
              data-v-6379a767=""
            ></el-switch>
          </div>
          <div class="st-actions" data-v-6379a767="">
            <button type="button" title="编辑" @click="__stub('此操作')" data-v-6379a767="">
              <el-icon data-v-6379a767=""
                ><component :is="IconEditPen" data-v-6379a767=""></component
              ></el-icon></button
            ><button
              type="button"
              class="danger"
              title="删除"
              @click="__stub('此操作')"
              data-v-6379a767=""
            >
              <el-icon data-v-6379a767=""
                ><component :is="IconDelete" data-v-6379a767=""></component
              ></el-icon>
            </button>
          </div></div
      ></template>
    </div>
    <el-dialog
      :model-value="false"
      @update:modelValue="__stub('此操作')"
      title="设置任务时间"
      width="420px"
      append-to-body=""
      align-center=""
      :close-on-click-modal="!1"
      class="scheduled-task-editor"
      data-v-6379a767=""
      ><template #footer
        ><el-button @click="emit('update:modelValue', false)" data-v-6379a767="">取消</el-button
        ><el-button type="primary" @click="__stub('此操作')" data-v-6379a767=""
          >保存设置</el-button
        ></template
      >
      <div class="st-form" data-v-6379a767="">
        <label class="st-field" data-v-6379a767=""
          ><span data-v-6379a767="">调度方式</span
          ><select
            v-show="select?.['scheduleType']"
            @update:modelValue="__stub('此操作')"
            data-v-6379a767=""
          >
            <template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                { value: 'daily', label: '每天固定时间' },
                { value: 'once', label: '仅执行一次' },
                { value: 'interval', label: '固定间隔重复' },
              ]"
              ><option :value="item" data-v-6379a767="">{{ item?.['label'] }}</option></template
            >
          </select></label
        ><template v-if="props.modelValue"
          ><label class="st-field" data-v-6379a767=""
            ><span data-v-6379a767="">执行日期</span
            ><input
              v-show="select?.['onceDate']"
              @update:modelValue="__stub('此操作')"
              type="date"
              data-v-6379a767="" /></label></template
        ><template v-if="select?.['scheduleType'] === 'interval'"
          ><div class="st-field" data-v-6379a767="">
            <span data-v-6379a767="">间隔</span>
            <div class="st-time-row" data-v-6379a767="">
              <input
                v-show="select?.['intervalValue']"
                @update:modelValue="__stub('此操作')"
                type="number"
                min="1"
                max="99999"
                class="st-interval-input"
                data-v-6379a767=""
              /><select
                v-show="select?.['intervalUnit']"
                @update:modelValue="__stub('此操作')"
                data-v-6379a767=""
              >
                <template
                  :key="entryIndex"
                  v-for="(item, entryIndex) in [
                    { value: 'second', label: '秒' },
                    { value: 'minute', label: '分钟' },
                    { value: 'hour', label: '小时' },
                  ]"
                  ><option :value="item" data-v-6379a767="">{{ item?.['label'] }}</option></template
                >
              </select>
            </div>
          </div></template
        ><template v-else
          ><div class="st-field" data-v-6379a767="">
            <span data-v-6379a767="">操作时间</span>
            <div class="st-time-row" data-v-6379a767="">
              <select
                v-show="select?.['hour']"
                @update:modelValue="__stub('此操作')"
                data-v-6379a767=""
              >
                <template :key="entryIndex" v-for="(item, entryIndex) in rows"
                  ><option :value="item" data-v-6379a767="">{{ item }}</option></template
                ></select
              ><em data-v-6379a767="">时</em
              ><select
                v-show="select?.['minute']"
                @update:modelValue="__stub('此操作')"
                data-v-6379a767=""
              >
                <template :key="entryIndex" v-for="(item, entryIndex) in rowsState"
                  ><option :value="item" data-v-6379a767="">{{ item }}</option></template
                ></select
              ><em data-v-6379a767="">分</em
              ><select
                v-show="select?.['second']"
                @update:modelValue="__stub('此操作')"
                data-v-6379a767=""
              >
                <template :key="entryIndex" v-for="(item, entryIndex) in rowsStateDetail"
                  ><option :value="item" data-v-6379a767="">{{ item }}</option></template
                ></select
              ><em data-v-6379a767="">秒</em>
            </div>
          </div></template
        ><label class="st-field" data-v-6379a767=""
          ><span data-v-6379a767="">任务类型</span
          ><select
            v-show="select?.['command']"
            @update:modelValue="__stub('此操作')"
            data-v-6379a767=""
          >
            <template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                { command: 'online', label: '一键上线' },
                { command: 'busy', label: '一键小休' },
                { command: 'offline', label: '一键离线' },
                { command: 'enable-ai', label: '一键开启AI' },
                { command: 'disable-ai', label: '一键关闭AI' },
                { command: 'load-stores', label: '一键加载店铺' },
              ]"
              ><option :value="item?.['command']" data-v-6379a767="">
                {{ item?.['label'] }}
              </option></template
            >
          </select></label
        >
      </div></el-dialog
    ></el-dialog
  >
</template>
