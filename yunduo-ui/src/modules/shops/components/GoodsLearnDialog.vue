<!-- GoodsLearnDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { computed } from 'vue'
import { createGoodsLearnDialogDemo } from '@/modules/shops/demo/GoodsLearnDialog'
const demo = createGoodsLearnDialogDemo()
interface Props {
  modelValue?: boolean
  shopName?: string
  pending?: number
  qty?: string
  qtyOptions?: Array<string>
  cost?: string
  costPerItem?: string
  job?: boolean
  syncing?: string
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  shopName: '',
  pending: 0,
  qty: '',
  qtyOptions: () => [],
  cost: '',
  costPerItem: '',
  job: false,
  syncing: '',
})
const __stub = notifyUnavailable
const isTemplate = computed(() => demo.isTemplate)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const isDisabled = computed(() => demo.isDisabled)
const disabled = computed(() => demo.disabled)
const style = computed(() => demo.style)
const gld__panel = computed(() => demo.gld__panel)
const gldBtn = computed(() => demo.gldBtn)
const gld__body = computed(() => demo.gld__body)
const gld__panelSummary = computed(() => demo.gld__panelSummary)
const gld__batch = computed(() => demo.gld__batch)
const gld__kpis = computed(() => demo.gld__kpis)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <Teleport to="body"
    ><template v-if="props.modelValue"
      ><div class="gld" role="presentation">
        <div class="gld__mask" @click="emit('update:modelValue', false)"></div>
        <div class="gld__modal" role="dialog" aria-modal="true" @click="__stub('此操作')">
          <header class="gld__head">
            <div>
              <p class="gld__eyebrow">AI 商品特征分析与训练</p>
              <h3></h3>
            </div>
            <button
              type="button"
              class="gld__close"
              aria-label="关闭"
              title="关闭"
              @click="emit('update:modelValue', false)"
            >
              ×
            </button>
          </header>
          <div class="gld__body">
            <template v-if="props?.pending > 50"
              ><div class="gld__batch">
                <strong>需要分批学习</strong>
                <p>{{ gld__body }}</p>
              </div></template
            >
            <div class="gld__kpis">
              <div class="gld__kpi">
                <span>待学习商品</span
                ><strong
                  ><b>{{ gld__batch }}</b
                  ><em>个</em></strong
                >
              </div>
              <div class="gld__kpi">
                <span>预计消耗回复</span
                ><strong
                  ><b>{{ gld__kpis }}</b
                  ><em>条</em></strong
                >
              </div>
            </div>
            <div class="gld__panel">
              <div class="gld__row">
                <div>
                  <label class="gld__label">本次学习数量</label>
                  <p class="gld__sub">{{ gld__panelSummary }}</p>
                </div>
                <select
                  class="gld__select"
                  :value="props?.qty"
                  :disabled="isDisabled || disabled === 0"
                  @change="__stub('此操作')"
                >
                  <template :key="entryIndex" v-for="(item, entryIndex) in props?.qtyOptions"
                    ><option :value="item">{{ item }}</option></template
                  >
                  <option value="0">0</option>
                </select>
              </div>
              <ul class="gld__tips">
                <li>
                  单个商品学习消耗 <b>{{ props?.costPerItem }}</b> 条 AI 回复数
                </li>
                <li>
                  单次最多支持 <b>{{ 500 }}</b> 个，超出请分批学习
                </li>
                <li>轻量套餐及以上，学习消耗额度可全额返还</li>
              </ul>
            </div>
            <div class="gld__panel gld__panel--progress">
              <div class="gld__row">
                <div>
                  <label class="gld__label">{{
                    isTemplateSummary ? '同步进度' : '学习进度'
                  }}</label>
                  <p class="gld__sub">{{ gld__panel }}</p>
                </div>
                <b class="gld__pct"></b>
              </div>
              <div class="gld__track"><i :style="{ width: `${style}%` }"></i></div>
              <p class="gld__note">
                同步时可随时停止，再用已同步数量开始学习；学习中也可停止。完成后可在商品详情查看配置。
              </p>
            </div>
          </div>
          <footer class="gld__foot">
            <template v-if="isTemplateSummary"
              ><button class="gld-btn gld-btn--soft" type="button" @click="__stub('此操作')">
                停止同步
              </button></template
            ><template v-else-if="isTemplate"
              ><button class="gld-btn gld-btn--soft" type="button" @click="__stub('此操作')">
                停止学习</button
              ><button class="gld-btn gld-btn--ghost" type="button" @click="__stub('此操作')">
                缩小到列表
              </button></template
            ><template v-else
              ><button
                class="gld-btn gld-btn--ghost"
                type="button"
                @click="emit('update:modelValue', false)"
              >
                取消
              </button></template
            ><button
              class="gld-btn gld-btn--primary"
              type="button"
              :disabled="isDisabled || props?.pending === 0"
              @click="__stub('此操作')"
            >
              {{ isTemplate ? '学习中…' : gldBtn }}
            </button>
          </footer>
        </div>
      </div></template
    ></Teleport
  >
</template>
