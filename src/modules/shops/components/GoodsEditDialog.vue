<!-- GoodsEditDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { computed } from 'vue'
import { createGoodsEditDialogDemo } from '@/modules/shops/demo/GoodsEditDialog'
const demo = createGoodsEditDialogDemo()
interface Props {
  modelValue?: boolean
  shopName?: string
  batchCount?: number
  name?: string
  detail?: string
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  shopName: '',
  batchCount: 0,
  name: '',
  detail: '',
})
const __stub = notifyUnavailable
const geHead = computed(() => demo.geHead)
const value = computed(() => demo.value)
const isGeEditor = computed(() => demo.isGeEditor)
const span = computed(() => demo.span)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <Teleport to="body"
    ><template v-if="props.modelValue"
      ><div class="shop-manage shop-portal-root">
        <div class="mask" @click="emit('update:modelValue', false)"></div>
        <div
          class="modal modal--goods-edit"
          role="dialog"
          aria-modal="true"
          aria-labelledby="goodsEditTitle"
          @click="__stub('此操作')"
        >
          <header class="ge-head">
            <div class="ge-head__meta">
              <strong id="goodsEditTitle">商品知识配置</strong
              ><span class="ge-shop-pill">{{ geHead }}</span>
            </div>
            <button
              type="button"
              class="ge-close"
              aria-label="关闭"
              title="关闭"
              @click="emit('update:modelValue', false)"
            >
              ×
            </button>
          </header>
          <div class="ge-body">
            <div class="ge-topbar">
              <label class="ge-title-row"
                ><span>商品标题<em>只读</em></span
                ><input type="text" :value="value" maxlength="200" readonly disabled
              /></label>
            </div>
            <div class="ge-editor">
              <div class="ge-editor__hd">
                <strong>商品详情知识库</strong
                ><span :class="['ge-count', span]"
                  ><b>{{ isGeEditor }}</b
                  >{{ ' / ' + 3000 }}</span
                >
              </div>
              <textarea
                :value="props?.detail"
                rows="16"
                maxlength="3000"
                placeholder="填写商品知识库内容，供 AI 接待调用…"
                @input="__stub('此操作')"
              ></textarea>
            </div>
          </div>
          <footer class="ge-foot">
            <button class="btn btn--ghost" type="button" @click="emit('update:modelValue', false)">
              取消</button
            ><button class="btn btn--primary" type="button" @click="__stub('此操作')">
              保存配置
            </button>
          </footer>
        </div>
      </div></template
    ></Teleport
  >
</template>
