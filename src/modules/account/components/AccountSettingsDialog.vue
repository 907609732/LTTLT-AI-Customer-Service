<!-- AccountSettingsDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import IconSearch from '@/shared/icons/IconSearch.vue'
import IconEditPen from '@/shared/icons/IconEditPen.vue'
import IconDelete from '@/shared/icons/IconDelete.vue'
import { ref, computed } from 'vue'
import { createAccountSettingsDialogDemo } from '@/modules/account/demo/AccountSettingsDialog'
const demo = createAccountSettingsDialogDemo()
interface Props {
  modelValue?: boolean
}
const props = withDefaults(defineProps<Props>(), { modelValue: false })
const __stub = notifyUnavailable
const isAsTableBody = ref(demo.isAsTableBody)
const asTableBodyItems = ref(demo.asTableBodyItems)
const input = ref(demo.input)
const asSelect = ref(demo.asSelect)
const asSelectState = ref(demo.asSelectState)
const isDisabled = ref(demo.isDisabled)
const id = ref(demo.id)
const rows = computed(() => demo.rows)
const asRowItems = computed(() => demo.asRowItems)
const inputState = ref(demo.inputState)

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
    width="1000px"
    top="6vh"
    class="account-settings-dialog"
    destroy-on-close=""
    append-to-body=""
    data-v-d5d12cab=""
    ><template #header
      ><div class="as-dialog-hd" data-v-d5d12cab="">
        <h3 data-v-d5d12cab="">全电商账户管理平台</h3>
        <p class="as-dialog-tip" data-v-d5d12cab="">
          设置账号密码可以自动输入账号密码，掉线自动登录。目前支持抖店和拼多多，建议用店铺子账号，子账号一般不需要验证码。
        </p>
      </div></template
    >
    <div class="as-toolbar" data-v-d5d12cab="">
      <select
        v-show="asSelect"
        @update:modelValue="__stub('此操作')"
        class="as-select"
        data-v-d5d12cab=""
      >
        <option value="all" data-v-d5d12cab="">所有平台</option>
        <template :key="entryIndex" v-for="(item, entryIndex) in rows"
          ><option :value="item?.['id']" data-v-d5d12cab="">{{ item?.['name'] }}</option></template
        ></select
      ><select
        v-show="asSelectState"
        @update:modelValue="__stub('此操作')"
        class="as-select"
        data-v-d5d12cab=""
      >
        <option value="all" data-v-d5d12cab="">全部状态</option>
        <option value="online" data-v-d5d12cab=""></option>
        <option value="offline" data-v-d5d12cab=""></option>
      </select>
      <div class="as-search" data-v-d5d12cab="">
        <el-icon data-v-d5d12cab=""
          ><component :is="IconSearch" data-v-d5d12cab=""></component></el-icon
        ><input
          v-show="input"
          @update:modelValue="__stub('此操作')"
          type="text"
          placeholder="搜索店铺名称/客服名称/账号"
          data-v-d5d12cab=""
        />
      </div>
      <button type="button" class="as-batch-del" @click="__stub('此操作')" data-v-d5d12cab="">
        批量删除
      </button>
    </div>
    <div class="as-table-head" data-v-d5d12cab="">
      <label class="as-check" data-v-d5d12cab=""
        ><input
          v-show="inputState"
          @update:modelValue="__stub('此操作')"
          type="checkbox"
          data-v-d5d12cab="" /></label
      ><span data-v-d5d12cab="">店铺名称</span><span data-v-d5d12cab="">登录状态</span
      ><span data-v-d5d12cab="">客服名称</span><span data-v-d5d12cab="">店铺平台</span
      ><span data-v-d5d12cab="">店铺账号</span><span data-v-d5d12cab="">店铺密码</span
      ><span class="as-ops" data-v-d5d12cab="">操作</span>
    </div>
    <div v-show="isAsTableBody" class="as-table-body" data-v-d5d12cab="">
      <template v-if="props.modelValue"
        ><div class="as-empty" data-v-d5d12cab="">
          {{ asTableBodyItems?.['length'] ? '没有符合筛选的账号' : '暂无账号档案' }}
        </div></template
      ><template :key="entryIndex" v-for="(item, entryIndex) in asRowItems"
        ><div class="as-row" data-v-d5d12cab="">
          <label class="as-check" data-v-d5d12cab=""
            ><input type="checkbox" @change="__stub('此操作')" data-v-d5d12cab=""
          /></label>
          <div class="as-shop" :title="item?.['name']" data-v-d5d12cab="">
            <template v-if="true"><img class="as-shop-icon" alt="" data-v-d5d12cab="" /></template
            ><span data-v-d5d12cab="">{{ item?.['name'] || '—' }}</span>
          </div>
          <span :class="['as-status', false]" data-v-d5d12cab=""></span
          ><span :title="item?.['userName']" data-v-d5d12cab="">{{
            item?.['userName'] || '—'
          }}</span
          ><span :title="item?.['platformName']" data-v-d5d12cab="">{{
            item?.['platformName'] || '—'
          }}</span>
          <div
            :class="['as-cred', { error: item?.['credentialAutoLoginDisabled'] }]"
            data-v-d5d12cab=""
          >
            <span :title="item?.['account']" data-v-d5d12cab="">{{ item?.['account'] || '—' }}</span
            ><template v-if="item?.['credentialAutoLoginDisabled']"
              ><em
                :title="item?.['credentialAutoLoginError'] || '账号或密码错误'"
                data-v-d5d12cab=""
                >{{ item?.['credentialAutoLoginError'] || '账号或密码错误' }}</em
              ></template
            >
          </div>
          <div
            :class="['as-cred', { error: item?.['credentialAutoLoginDisabled'] }]"
            data-v-d5d12cab=""
          >
            <span data-v-d5d12cab="">{{ item?.['hasPassword'] ? '******' : '—' }}</span
            ><template v-if="item?.['credentialAutoLoginDisabled']"
              ><em data-v-d5d12cab="">自动登录已停用</em></template
            >
          </div>
          <span class="as-ops" data-v-d5d12cab=""
            ><template v-if="true"
              ><button
                type="button"
                class="as-icon edit"
                title="设置账号密码"
                @click="__stub('此操作')"
                data-v-d5d12cab=""
              >
                <el-icon data-v-d5d12cab=""
                  ><component :is="IconEditPen" data-v-d5d12cab=""></component
                ></el-icon></button></template
            ><button
              type="button"
              class="as-icon danger"
              title="删除"
              @click="__stub('此操作')"
              data-v-d5d12cab=""
            >
              <el-icon data-v-d5d12cab=""
                ><component :is="IconDelete" data-v-d5d12cab=""></component
              ></el-icon></button
          ></span></div
      ></template></div></el-dialog
  ><el-dialog
    :model-value="false"
    @update:modelValue="__stub('此操作')"
    title="编辑店铺账号"
    width="440px"
    append-to-body=""
    class="account-edit-dialog"
    data-v-d5d12cab=""
    ><template #footer
      ><button
        type="button"
        class="as-btn ghost"
        @click="emit('update:modelValue', false)"
        data-v-d5d12cab=""
      >
        取消</button
      ><button
        type="button"
        class="as-btn primary"
        :disabled="isDisabled"
        @click="__stub('此操作')"
        data-v-d5d12cab=""
      >
        {{ isDisabled ? '保存中…' : '保存' }}
      </button></template
    >
    <div class="as-edit-form" data-v-d5d12cab="">
      <template v-if="id?.['credentialAutoLoginDisabled']"
        ><p class="as-edit-warn" data-v-d5d12cab=""></p></template
      ><label data-v-d5d12cab=""
        ><span data-v-d5d12cab="">店铺名称</span
        ><input
          v-show="id?.['name']"
          @update:modelValue="__stub('此操作')"
          type="text"
          data-v-d5d12cab="" /></label
      ><label data-v-d5d12cab=""
        ><span data-v-d5d12cab="">客服名称</span
        ><input
          v-show="id?.['userName']"
          @update:modelValue="__stub('此操作')"
          type="text"
          data-v-d5d12cab="" /></label
      ><label data-v-d5d12cab=""
        ><span data-v-d5d12cab="">店铺平台</span
        ><input :value="id?.['platformName']" type="text" disabled data-v-d5d12cab="" /></label
      ><label data-v-d5d12cab=""
        ><span data-v-d5d12cab="">店铺账号</span
        ><input
          v-show="id?.['account']"
          @update:modelValue="__stub('此操作')"
          type="text"
          autocomplete="off"
          data-v-d5d12cab="" /></label
      ><label data-v-d5d12cab=""
        ><span data-v-d5d12cab="">店铺密码</span
        ><input
          v-show="id?.['password']"
          @update:modelValue="__stub('此操作')"
          type="password"
          autocomplete="new-password"
          placeholder="留空并保存可清空密码"
          data-v-d5d12cab=""
      /></label></div
  ></el-dialog>
</template>
