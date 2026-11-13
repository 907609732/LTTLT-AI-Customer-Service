<!-- ModelSwitchModal：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
interface Props {
  modelValue?: boolean
}
import { notifyUnavailable } from '@/shared/ui/feedback'
import productIcon from '@/assets/lingtu-ai-icon.png'
import { ref } from 'vue'
import { createModelSwitchModalDemo } from '@/modules/knowledge/demo/ModelSwitchModal'
const demo = createModelSwitchModalDemo()
const __stub = notifyUnavailable
const isMsMask = ref(demo.isMsMask)
const rows = ref(demo.rows)
const modeId = ref(demo.modeId)
const isTemplate = ref(demo.isTemplate)
const msPromoCard = ref(demo.msPromoCard)
const msContactLink = ref(demo.msContactLink)
const isTemplatePreview = ref(demo.isTemplatePreview)
const preset = ref(demo.preset)
const rowsPreview = ref(demo.rowsPreview)
const msToast = ref(demo.msToast)
const msToastPreview = ref(demo.msToastPreview)
const link = ref(demo.link)
const rowsState = ref(demo.rowsState)
const min = ref(demo.min)
const max = ref(demo.max)

const props = withDefaults(defineProps<Props>(), { modelValue: false })

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <Teleport to="body"
    ><div
      v-show="isMsMask"
      class="ms-mask"
      id="msMask"
      @click="emit('update:modelValue', false)"
    ></div>
    <div
      v-show="isMsMask"
      class="ms-modal"
      id="msModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="msTitle"
    >
      <header class="ms-modal__head">
        <div>
          <h2 id="msTitle">选择接待模型</h2>
          <p class="ms-modal__sub">
            接待策略选口径，模型风格选语气和字数。点左侧换策略，右侧换风格。
          </p>
        </div>
        <button
          class="ms-modal__close"
          type="button"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        >
          ×
        </button>
      </header>
      <div class="ms-modal__body">
        <aside class="ms-side" id="msSide">
          <div class="ms-side__title">接待策略</div>
          <p class="ms-side__intro">选策略：通用接待适合大多数店，系统规则包生效。</p>
          <template :key="entryIndex" v-for="(item, entryIndex) in rows"
            ><button
              type="button"
              :class="[
                'ms-cat',
                { active: item?.['id'] === modeId?.['modeId'], 'is-locked': item?.['locked'] },
              ]"
              @click="__stub('此操作')"
            >
              <strong
                >{{ item?.['name'] + ' '
                }}<template v-if="props.modelValue"
                  ><span class="ms-cat__tag ms-cat__tag--lock">专属</span></template
                ><template v-else-if="false"
                  ><span class="ms-cat__tag ms-cat__tag--ok">规则生效</span></template
                ></strong
              ><em>{{ item?.['tip'] }}</em>
            </button></template
          >
        </aside>
        <div class="ms-main" id="msMain">
          <template v-if="isTemplate"
            ><div class="ms-hero">
              <strong>企业深度定制</strong>
              <p>适合大型电商团队与多品牌矩阵，按你们的业务做专属模型与流程。</p>
            </div>
            <p class="ms-one">{{ msPromoCard?.['one'] }}</p>
            <div class="ms-promo-grid">
              <template :key="index" v-for="(item, index) in msPromoCard?.['highlights'] || []"
                ><div class="ms-promo-card">
                  <span>{{ item?.['tag'] }}</span>
                  <p>{{ item?.['text'] }}</p>
                </div></template
              >
            </div>
            <template v-if="link?.['link']"
              ><p class="ms-contact">
                开通请
                <button type="button" class="ms-contact-link" @click="__stub('此操作')">
                  查看客服二维码
                </button>
                ，备注「深度定制」
              </p></template
            ><template v-else
              ><p class="ms-contact">
                开通请加客服微信 <b>{{ msContactLink }}</b
                >，备注「深度定制」
              </p></template
            ></template
          ><template v-else
            ><template v-if="isTemplatePreview"
              ><div class="ms-banner ms-banner--ok">
                「通用接待」下可在「模型定制」中用品类模板包配置店铺说话规范。
              </div></template
            ><template v-else
              ><div class="ms-banner ms-banner--warn">
                切换到本模式后，<strong>系统规则包将失效</strong>；仅按该专用模型策略接待。若需系统规则，请改回「通用接待」。
              </div></template
            >
            <div class="ms-step">
              <div class="ms-step__hd"><b>1</b><span>接待策略说明</span></div>
              <p class="ms-one">{{ msPromoCard?.['one'] }}</p>
            </div>
            <div class="ms-step">
              <div class="ms-step__hd"><b>2</b><span>模型风格</span></div>
              <p class="ms-step__intro">只改语气和回复长短，不会换成别的接待策略。</p>
              <div class="ms-tones">
                <template :key="entryIndex" v-for="(item, entryIndex) in rowsState"
                  ><button
                    type="button"
                    :class="['ms-tone', { active: preset?.['preset'] === item?.['id'] }]"
                    @click="__stub('此操作')"
                  >
                    <strong>{{ item?.['name'] }}</strong
                    ><em>{{ item?.['tip'] }}</em
                    ><span class="ms-tone__len"></span></button
                ></template>
              </div>
              <div class="ms-len">
                <div class="ms-len__meta"><strong>回复字数</strong><span></span></div>
                <div class="ms-len__ctrl">
                  <label class="ms-len__box"
                    ><em>最少</em
                    ><input
                      v-show="preset?.['lenMin']"
                      id="msLenMin"
                      @update:modelValue="emit('update:modelValue', $event)"
                      type="number"
                      :min="min"
                      :max="max"
                      @change="__stub('此操作')" /></label
                  ><span class="ms-len__dash" aria-hidden="true"></span
                  ><label class="ms-len__box"
                    ><em>最多</em
                    ><input
                      v-show="preset?.['lenMax']"
                      id="msLenMax"
                      @update:modelValue="__stub('此操作')"
                      type="number"
                      :min="min"
                      :max="max"
                      @change="__stub('此操作')" /></label
                  ><i>字</i>
                </div>
              </div>
            </div>
            <div class="ms-step">
              <div class="ms-step__hd"><b>3</b><span>回答引擎</span></div>
              <div class="ms-engines">
                <template :key="entryIndex" v-for="(item, entryIndex) in rowsPreview"
                  ><button
                    type="button"
                    :class="['ms-engine', { active: item?.['id'] === modeId?.['llmId'] }]"
                    @click="__stub('此操作')"
                  >
                    <span class="ms-ico" aria-hidden="true"
                      ><template v-if="item?.['icon'] === 'yunduo'"
                        ><img :src="productIcon" alt="" /></template
                      ><template v-else-if="item?.['icon'] === 'qwen'"
                        ><svg viewBox="0 0 24 24" fill="none">
                          <rect width="24" height="24" rx="6" fill="#6B5CFF"></rect>
                          <path d="M7 16.5 12 6.5l5 10H7z" fill="#fff"></path>
                          <path
                            d="M9.2 12.8h5.6"
                            stroke="#6B5CFF"
                            stroke-width="1.4"
                          ></path></svg></template
                      ><template v-else-if="item?.['icon'] === 'doubao'"
                        ><svg viewBox="0 0 24 24" fill="none">
                          <rect width="24" height="24" rx="6" fill="#FFF3E0"></rect>
                          <circle cx="12" cy="11" r="6.2" fill="#FF8A3D"></circle>
                          <circle cx="9.8" cy="10.2" r="1.1" fill="#fff"></circle>
                          <circle cx="14.2" cy="10.2" r="1.1" fill="#fff"></circle>
                          <path
                            d="M10 13.4c.6.7 1.3 1 2 1s1.4-.3 2-1"
                            stroke="#fff"
                            stroke-width="1.2"
                            stroke-linecap="round"
                          ></path></svg></template
                      ><template v-else-if="item?.['icon'] === 'deepseek'"
                        ><svg viewBox="0 0 24 24" fill="none">
                          <rect width="24" height="24" rx="6" fill="#E8F3FF"></rect>
                          <path
                            d="M5.5 13.5c1.2-4.2 4-6.8 6.5-6.8 3.2 0 5.8 3.6 5.2 7.4-.4 2.4-2.2 4.2-4.6 4.2-2.6 0-4.4-1.6-5.4-3.4-.4.9-1 1.6-1.7 2"
                            stroke="#3B82F6"
                            stroke-width="1.6"
                            stroke-linecap="round"
                          ></path>
                          <circle
                            cx="14.2"
                            cy="11.2"
                            r="1.15"
                            fill="#3B82F6"
                          ></circle></svg></template></span
                    ><span
                      ><b>{{ item?.['name'] }}</b
                      ><i>{{ item?.['tip'] }}</i></span
                    >
                  </button></template
                >
              </div>
            </div></template
          >
        </div>
      </div>
      <footer class="ms-modal__foot">
        <button class="ms-btn ms-btn--cancel" type="button" @click="__stub('此操作')">
          {{ isTemplate ? '关闭' : '取消' }}</button
        ><button class="ms-btn ms-btn--primary" type="button" @click="__stub('此操作')">
          {{ isTemplate ? '联系客服开通' : '用这个' }}
        </button>
      </footer>
    </div>
    <div v-show="msToastPreview" class="ms-toast" id="msToast">{{ msToast }}</div></Teleport
  >
</template>
