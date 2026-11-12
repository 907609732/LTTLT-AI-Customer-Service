<!-- QuickReplyDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import IconSearch from '@/shared/icons/IconSearch.vue'
import IconDownload from '@/shared/icons/IconDownload.vue'
import IconUpload from '@/shared/icons/IconUpload.vue'
import IconPlus from '@/shared/icons/IconPlus.vue'
import IconFolderAdd from '@/shared/icons/IconFolderAdd.vue'
import IconEditPen from '@/shared/icons/IconEditPen.vue'
import IconDelete from '@/shared/icons/IconDelete.vue'
import { ref, computed } from 'vue'
import { createQuickReplyDialogDemo } from '@/modules/workbench/demo/QuickReplyDialog'
const demo = createQuickReplyDialogDemo()
interface Props {
  modelValue?: boolean
  enterToSend?: boolean
  clearAfterSend?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  enterToSend: false,
  clearAfterSend: false,
})
const __stub = notifyUnavailable
const qrBody = ref(true)
const inputValue = ref(demo.modelValue)
const button = ref(demo.button)
const rows = ref(demo.rows)
const template = ref(demo.template)
const modelValueState = ref(demo.modelValueState)
const select = ref(demo.select)
const rowsSummary = computed(() => demo.rowsSummary)
const qrItemItems = computed(() => demo.qrItemItems)
const maxlength = ref(demo.maxlength)

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
    title="快捷回复"
    width="680px"
    append-to-body=""
    align-center=""
    :close-on-click-modal="!1"
    class="quick-reply-dialog"
    data-v-7dfc4df5=""
    ><div v-show="qrBody" class="qr-body" data-v-7dfc4df5="">
      <div class="qr-hint" data-v-7dfc4df5="">
        <strong data-v-7dfc4df5="">怎么批量添加？</strong>
        <p data-v-7dfc4df5="">
          1. 点「模板」下载表格 → 2. 用 Excel 填两列「分类」「回复内容」→ 3. 保存后点「导入」。
          每条最多 <b data-v-7dfc4df5="">{{ maxlength }}</b> 字，也支持直接点「新增」手动添加。
        </p>
      </div>
      <div class="qr-toolbar" data-v-7dfc4df5="">
        <el-input
          v-model="inputValue"
          clearable=""
          placeholder="搜索分类或回复内容"
          :prefix-icon="IconSearch"
          data-v-7dfc4df5=""
        ></el-input
        ><button
          type="button"
          class="qr-btn"
          title="下载 Excel 表格模板"
          @click="__stub('此操作')"
          data-v-7dfc4df5=""
        >
          <el-icon data-v-7dfc4df5=""
            ><component :is="IconDownload" data-v-7dfc4df5=""></component
          ></el-icon>
          模板</button
        ><button
          type="button"
          class="qr-btn"
          title="导入 CSV 表格"
          @click="__stub('此操作')"
          data-v-7dfc4df5=""
        >
          <el-icon data-v-7dfc4df5=""
            ><component :is="IconUpload" data-v-7dfc4df5=""></component
          ></el-icon>
          导入</button
        ><button
          type="button"
          class="qr-btn"
          title="导出为 CSV 表格"
          @click="__stub('此操作')"
          data-v-7dfc4df5=""
        >
          <el-icon data-v-7dfc4df5=""
            ><component :is="IconDownload" data-v-7dfc4df5=""></component
          ></el-icon>
          导出</button
        ><button type="button" class="qr-btn primary" @click="__stub('此操作')" data-v-7dfc4df5="">
          <el-icon data-v-7dfc4df5=""
            ><component :is="IconPlus" data-v-7dfc4df5=""></component
          ></el-icon>
          新增</button
        ><input
          type="file"
          accept=".csv,.txt,.tsv,text/csv,application/vnd.ms-excel,application/json,.json"
          hidden=""
          @change="__stub('此操作')"
          data-v-7dfc4df5=""
        />
      </div>
      <div class="qr-cats" data-v-7dfc4df5="">
        <template :key="entryIndex" v-for="(item, entryIndex) in rowsSummary"
          ><button
            type="button"
            :class="['qr-cat', { active: button === item?.['id'] }]"
            @click="__stub('此操作')"
            data-v-7dfc4df5=""
          >
            {{ item?.['name'] + ' ' }}<em data-v-7dfc4df5="">{{ item?.['count'] }}</em>
          </button></template
        ><button type="button" class="qr-cat add" @click="__stub('此操作')" data-v-7dfc4df5="">
          <el-icon data-v-7dfc4df5=""
            ><component :is="IconFolderAdd" data-v-7dfc4df5=""></component
          ></el-icon>
          分类
        </button>
      </div>
      <template v-if="props.modelValue"
        ><div class="qr-cat-actions" data-v-7dfc4df5="">
          <span data-v-7dfc4df5=""></span
          ><button type="button" @click="__stub('此操作')" data-v-7dfc4df5="">重命名</button
          ><button type="button" class="danger" @click="__stub('此操作')" data-v-7dfc4df5="">
            删除分类
          </button>
        </div></template
      >
      <div class="qr-list" data-v-7dfc4df5="">
        <template v-if="template === '__new__'"
          ><div class="qr-edit-card" data-v-7dfc4df5="">
            <div class="qr-edit-meta" data-v-7dfc4df5="">
              <span data-v-7dfc4df5="">分类</span
              ><select v-show="select" @update:modelValue="__stub('此操作')" data-v-7dfc4df5="">
                <template :key="entryIndex" v-for="(item, entryIndex) in rows"
                  ><option :value="item?.['id']" data-v-7dfc4df5="">
                    {{ item?.['name'] }}
                  </option></template
                >
              </select>
            </div>
            <el-input
              :model-value="modelValueState"
              @update:modelValue="__stub('此操作')"
              type="textarea"
              rows="2"
              :maxlength="maxlength"
              show-word-limit=""
              :placeholder="'输入常用回复，最多 ' + maxlength + ' 字'"
              @keydown="__stub('此操作')"
              data-v-7dfc4df5=""
            ></el-input>
            <div class="qr-edit-actions" data-v-7dfc4df5="">
              <el-button size="small" @click="emit('update:modelValue', false)" data-v-7dfc4df5=""
                >取消</el-button
              ><el-button type="primary" size="small" @click="__stub('此操作')" data-v-7dfc4df5=""
                >保存</el-button
              >
            </div>
          </div></template
        ><template :key="entryIndex" v-for="(item, entryIndex) in qrItemItems"
          ><article class="qr-item" data-v-7dfc4df5="">
            <template v-if="template === item?.['id']"
              ><div class="qr-edit-meta" data-v-7dfc4df5="">
                <span data-v-7dfc4df5="">分类</span
                ><select v-show="select" @update:modelValue="__stub('此操作')" data-v-7dfc4df5="">
                  <template :key="entryIndex" v-for="(item, entryIndex) in rows"
                    ><option :value="item?.['id']" data-v-7dfc4df5="">
                      {{ item?.['name'] }}
                    </option></template
                  >
                </select>
              </div>
              <el-input
                :model-value="modelValueState"
                @update:modelValue="__stub('此操作')"
                type="textarea"
                rows="2"
                :maxlength="maxlength"
                show-word-limit=""
                @keydown="__stub('此操作')"
                data-v-7dfc4df5=""
              ></el-input>
              <div class="qr-edit-actions" data-v-7dfc4df5="">
                <el-button size="small" @click="emit('update:modelValue', false)" data-v-7dfc4df5=""
                  >取消</el-button
                ><el-button type="primary" size="small" @click="__stub('此操作')" data-v-7dfc4df5=""
                  >保存</el-button
                >
              </div></template
            ><template v-else
              ><span class="qr-tag" data-v-7dfc4df5=""></span
              ><button
                type="button"
                class="qr-text"
                :title="item?.['text']"
                @click="__stub('此操作')"
                data-v-7dfc4df5=""
              >
                {{ item?.['text'] }}</button
              ><span class="qr-len" data-v-7dfc4df5="">{{ item?.['text']?.['length'] }}</span>
              <div class="qr-item-actions" data-v-7dfc4df5="">
                <button type="button" title="使用" @click="__stub('此操作')" data-v-7dfc4df5="">
                  使用</button
                ><button type="button" title="编辑" @click="__stub('此操作')" data-v-7dfc4df5="">
                  <el-icon data-v-7dfc4df5=""
                    ><component :is="IconEditPen" data-v-7dfc4df5=""></component
                  ></el-icon></button
                ><button
                  type="button"
                  class="danger"
                  title="删除"
                  @click="__stub('此操作')"
                  data-v-7dfc4df5=""
                >
                  <el-icon data-v-7dfc4df5=""
                    ><component :is="IconDelete" data-v-7dfc4df5=""></component
                  ></el-icon>
                </button></div
            ></template></article></template
        ><template v-if="!qrItemItems?.['length'] && template !== '__new__'"
          ><div class="qr-empty" data-v-7dfc4df5="">
            <p data-v-7dfc4df5="">{{ '没有匹配的快捷回复' }}</p>
            <button type="button" class="qr-empty-add" @click="__stub('此操作')" data-v-7dfc4df5="">
              手动添加一条
            </button>
          </div></template
        >
      </div>
      <div class="qr-options" data-v-7dfc4df5="">
        <label class="qr-check" data-v-7dfc4df5=""
          ><input
            type="checkbox"
            :checked="props?.['enterToSend']"
            @change="__stub('此操作')"
            data-v-7dfc4df5=""
          /><span data-v-7dfc4df5="">回车发送</span></label
        ><label class="qr-check" data-v-7dfc4df5=""
          ><input
            type="checkbox"
            :checked="props?.['clearAfterSend']"
            @change="__stub('此操作')"
            data-v-7dfc4df5=""
          /><span data-v-7dfc4df5="">发送后清空输入框</span></label
        >
      </div>
    </div></el-dialog
  >
</template>
