<!-- GeneralPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref } from 'vue'
import { createGeneralPanelDemo } from '@/modules/settings/demo/GeneralPanel'
const demo = createGeneralPanelDemo()

const __stub = notifyUnavailable
const useHumanHistory = ref(demo.useHumanHistory)
const isDisabled = ref(demo.isDisabled)
</script>

<template>
  <div class="general-panel" data-v-d1a1feed="">
    <div class="page-head" data-v-d1a1feed="">
      <div data-v-d1a1feed="">
        <h1 data-v-d1a1feed="">软件偏好</h1>
        <p data-v-d1a1feed="">客户端性能与使用相关偏好</p>
      </div>
      <div class="acts" data-v-d1a1feed="">
        <el-button :disabled="!isDisabled" @click="__stub('此操作')" data-v-d1a1feed=""
          >还原</el-button
        ><el-button
          type="primary"
          :disabled="!isDisabled"
          @click="__stub('此操作')"
          data-v-d1a1feed=""
          >保存偏好</el-button
        >
      </div>
    </div>
    <div class="card soft-settings" data-v-d1a1feed="">
      <div class="soft-item" data-v-d1a1feed="">
        <div class="text" data-v-d1a1feed="">
          <strong data-v-d1a1feed="">使用人工客服对话历史</strong>
          <p data-v-d1a1feed="">默认关闭。开启后，AI 回复时携带人工客服历史对话。</p>
        </div>
        <el-switch
          :model-value="useHumanHistory?.useHumanHistory"
          @update:modelValue="__stub('此操作')"
          data-v-d1a1feed=""
        ></el-switch>
      </div>
      <div class="soft-item" data-v-d1a1feed="">
        <div class="text" data-v-d1a1feed="">
          <strong data-v-d1a1feed="">AI 回复链接过滤</strong>
          <p data-v-d1a1feed="">
            默认开启。开启后，AI 生成的回复会去掉 http 链接。关闭后保留链接。
          </p>
        </div>
        <el-switch
          :model-value="useHumanHistory?.filterReplyLink"
          @update:modelValue="__stub('此操作')"
          data-v-d1a1feed=""
        ></el-switch>
      </div>
      <div class="soft-item" data-v-d1a1feed="">
        <div class="text" data-v-d1a1feed="">
          <strong data-v-d1a1feed="">是否推理</strong>
          <p data-v-d1a1feed="">默认关闭。开启后，AI 回复会先推理再回答。未传该参数时也不推理。</p>
        </div>
        <el-switch
          :model-value="useHumanHistory?.enableThinking"
          @update:modelValue="__stub('此操作')"
          data-v-d1a1feed=""
        ></el-switch>
      </div>
      <div class="soft-item" data-v-d1a1feed="">
        <div class="text" data-v-d1a1feed="">
          <strong data-v-d1a1feed="">客户端版本吸附</strong>
          <p data-v-d1a1feed="">
            开启后工作台/千牛等客户端窗口跟随主界面店铺区；关闭后仅呼出独立客户端窗。
          </p>
        </div>
        <el-switch
          :model-value="useHumanHistory?.windowSnap"
          @update:modelValue="__stub('此操作')"
          data-v-d1a1feed=""
        ></el-switch>
      </div>
    </div>
  </div>
</template>
