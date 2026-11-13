<!-- ImageRecognizeSettings：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
interface Props {
  cfg?: { enabled: boolean; prompt: string }
}
const props = withDefaults(defineProps<Props>(), { cfg: () => ({ enabled: false, prompt: '' }) })
const __stub = notifyUnavailable
</script>

<template>
  <div class="image-recognize" data-v-dd1d10c4="">
    <div class="section" data-v-dd1d10c4="">
      <div class="switch-row" data-v-dd1d10c4="">
        <div data-v-dd1d10c4="">
          <strong data-v-dd1d10c4="">启用图片识别提示</strong>
          <p data-v-dd1d10c4="">
            开启后，顾客发图时会把下方提示词交给 AI，按你写的范围识别图片内容。
          </p>
        </div>
        <el-switch
          :model-value="props?.cfg?.enabled"
          @update:modelValue="__stub('此操作')"
          data-v-dd1d10c4=""
        ></el-switch>
      </div>
    </div>
    <div class="section" data-v-dd1d10c4="">
      <div class="section-hd" data-v-dd1d10c4="">
        <h4 data-v-dd1d10c4="">识别提示词</h4>
        <span class="count" data-v-dd1d10c4=""></span>
      </div>
      <p class="tip" data-v-dd1d10c4="">
        用一段话告诉 AI「看什么、怎么判断」。每家店单独保存，可写破损、腐烂、质量问题、是否像 AI
        生成等。
      </p>
      <el-input
        type="textarea"
        rows="12"
        :maxlength="300"
        show-word-limit=""
        :model-value="props?.cfg?.prompt"
        :placeholder="'请用文字描述要重点看的内容，例如：\n1. 包裹外包装是否破损、变形、浸湿\n2. 商品是否有破损、腐烂、污渍、少件\n3. 是否存在明显质量问题（开线、掉漆、裂痕等）\n4. 图片是否像 AI 生成或与实物不符\n请按上述点给出简洁结论，不确定时明确说明看不清。'"
        :disabled="!props?.cfg?.enabled"
        @update:modelValue="__stub('此操作')"
        data-v-dd1d10c4=""
      ></el-input>
    </div>
  </div>
</template>
