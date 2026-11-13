<!-- CookieLoginDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
interface Props {
  modelValue?: boolean
}
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createCookieLoginDialogDemo } from '@/modules/account/demo/CookieLoginDialog'
const demo = createCookieLoginDialogDemo()
const __stub = notifyUnavailable
const template = ref(demo.template)
const inputValue = ref(demo.modelValue)
const isModelValue = ref(demo.isModelValue)
const modelValueState = ref(demo.modelValueState)
const cookieLoginHeader = computed(() => demo.cookieLoginHeader)

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
    class="cookie-login-dialog"
    width="520px"
    align-center=""
    append-to-body=""
    :close-on-click-modal="!1"
    ><template #header
      ><div class="cookie-login-header">
        <span class="cookie-login-title">{{ cookieLoginHeader }}</span>
      </div></template
    ><template #footer
      ><el-button @click="emit('update:modelValue', false)">取消</el-button
      ><el-button type="primary" @click="__stub('此操作')">确定</el-button></template
    >
    <div class="cookie-login-body">
      <template v-if="props.modelValue"
        ><div class="cookie-login-landing">
          <div class="cookie-login-landing-label">启动后进入</div>
          <el-radio-group
            :model-value="inputValue"
            @update:modelValue="__stub('此操作')"
            class="cookie-login-landing-group"
            ><el-radio-button label="workbench">工作台聚合</el-radio-button
            ><el-radio-button label="chat">聊天界面</el-radio-button></el-radio-group
          >
          <p class="cookie-login-hint">
            工作台聚合进入商家后台首页，可在后台内跳转；聊天界面进入客服接待页。
          </p>
        </div></template
      ><el-checkbox
        :model-value="isModelValue"
        @update:modelValue="__stub('此操作')"
        class="cookie-login-check"
      >
        使用 Cookie 登录（从浏览器开发者工具复制）
      </el-checkbox>
      <p class="cookie-login-hint">
        勾选后可粘贴 JSON（如 {"name":"value"}）或 Cookie 字符串（a=b; c=d）。
        <template v-if="template"><br />{{ ' ' + template }}</template>
      </p>
      <el-input
        :model-value="modelValueState"
        @update:modelValue="__stub('此操作')"
        type="textarea"
        rows="5"
        :disabled="!isModelValue"
        class="cookie-login-input"
        placeholder='{ "键": "值" }
或
name=value; name2=value2'
      ></el-input></div
  ></el-dialog>
</template>
