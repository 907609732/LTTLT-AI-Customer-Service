<!-- AccountLoginPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createAccountLoginPanelDemo } from '@/modules/account/demo/AccountLoginPanel'
const demo = createAccountLoginPanelDemo()

const __stub = notifyUnavailable
const title = ref(demo.title)
const inputValue = ref(demo.modelValue)
const modelValueState = ref(demo.modelValueState)
const modelValueStateDetail = ref(demo.modelValueStateDetail)
const disabled = ref(demo.disabled)
const isLoading = ref(demo.isLoading)
const isLoadingState = ref(demo.isLoadingState)
const isDisabled = computed(() => demo.isDisabled)
const titleSummary = computed(() => demo.titleSummary)
const displayText = computed(() => demo.displayText)
const isDiv = ref(demo.isDiv)
const acct = computed(() => demo.acct)
const style = computed(() => demo.style)
const div = computed(() => demo.div)
const isTemplate = computed(() => demo.isTemplate)
const displayTextSummary = computed(() => demo.displayTextSummary)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const divSummary = computed(() => demo.divSummary)
</script>

<template>
  <section class="acct" data-v-b5981294="">
    <div class="acct-top" data-v-b5981294="">
      <div class="acct-who" data-v-b5981294="">
        <span class="acct-avatar" data-v-b5981294="">{{ acct }}</span>
        <div class="acct-who__text" data-v-b5981294="">
          <div class="acct-name" data-v-b5981294="">
            <strong :title="title?.nickName" data-v-b5981294="">{{ title?.nickName }}</strong
            ><em data-v-b5981294="">当前登录</em>
          </div>
          <div class="acct-phone" data-v-b5981294=""></div>
        </div>
      </div>
      <div class="acct-actions" data-v-b5981294="">
        <el-button class="acct-btn" @click="__stub('此操作')" data-v-b5981294="">退出登录</el-button
        ><el-button class="acct-btn" type="primary" @click="__stub('此操作')" data-v-b5981294=""
          >去充值</el-button
        >
      </div>
    </div>
    <div class="acct-stats" data-v-b5981294="">
      <div class="acct-stat" data-v-b5981294="">
        <span data-v-b5981294="">当前套餐</span
        ><strong :title="titleSummary" data-v-b5981294="">{{ titleSummary }}</strong>
      </div>
      <div :class="['acct-stat', { 'is-warn': div }]" data-v-b5981294="">
        <span data-v-b5981294="">剩余算力</span
        ><strong data-v-b5981294=""
          >{{ displayTextSummary + ' '
          }}<template v-if="isTemplateSummary"
            ><small data-v-b5981294="">{{ isTemplateSummary }}</small></template
          ></strong
        ><template v-if="isTemplate"
          ><i :class="['acct-bar', { 'is-low': div }]" data-v-b5981294=""
            ><b :style="{ width: `${style}%` }" data-v-b5981294=""></b></i
        ></template>
      </div>
      <div
        :class="[
          'acct-stat',
          { 'is-warn': divSummary === 'soon', 'is-danger': divSummary === 'expired' },
        ]"
        data-v-b5981294=""
      >
        <span data-v-b5981294="">套餐到期</span
        ><strong data-v-b5981294="">{{ title?.expireAt }}</strong
        ><template v-if="divSummary === 'expired'"><em data-v-b5981294="">已到期</em></template
        ><template v-else-if="divSummary === 'soon'"><em data-v-b5981294="">即将到期</em></template>
      </div>
      <div class="acct-stat" data-v-b5981294="">
        <span data-v-b5981294="">联系人</span
        ><strong :title="title?.nickName" data-v-b5981294="">{{ title?.nickName }}</strong>
      </div>
    </div>
    <div :class="['acct-pwd', { 'is-open': isDiv }]" data-v-b5981294="">
      <button type="button" class="acct-pwd__toggle" @click="__stub('此操作')" data-v-b5981294="">
        <span data-v-b5981294=""
          ><strong data-v-b5981294="">修改密码</strong
          ><small data-v-b5981294="">如需改密，先获取短信验证码；不改可留空。</small></span
        ><em data-v-b5981294="">{{ isDiv ? '收起' : '展开' }}</em>
      </button>
      <div v-show="isDiv" class="acct-pwd__form" data-v-b5981294="">
        <div class="acct-sms" data-v-b5981294="">
          <el-input
            :model-value="inputValue"
            @update:modelValue="__stub('此操作')"
            maxlength="6"
            placeholder="请输入短信验证码"
            autocomplete="one-time-code"
            data-v-b5981294=""
          ></el-input
          ><el-button
            :loading="isLoading"
            :disabled="disabled > 0"
            @click="__stub('此操作')"
            data-v-b5981294=""
            >{{ displayText }}</el-button
          >
        </div>
        <div class="acct-pwds" data-v-b5981294="">
          <el-input
            :model-value="modelValueState"
            @update:modelValue="__stub('此操作')"
            type="password"
            show-password=""
            placeholder="输入新密码（至少 6 位）"
            autocomplete="new-password"
            data-v-b5981294=""
          ></el-input
          ><el-input
            :model-value="modelValueStateDetail"
            @update:modelValue="__stub('此操作')"
            type="password"
            show-password=""
            placeholder="再次确认新密码"
            autocomplete="new-password"
            data-v-b5981294=""
          ></el-input
          ><el-button
            type="primary"
            class="acct-confirm"
            :loading="isLoadingState"
            :disabled="!isDisabled"
            @click="__stub('此操作')"
            data-v-b5981294=""
          >
            确认修改密码
          </el-button>
        </div>
      </div>
    </div>
  </section>
</template>
