<!-- TrainingCorrectModal：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createTrainingCorrectModalDemo } from '@/modules/knowledge/demo/TrainingCorrectModal'
const demo = createTrainingCorrectModalDemo()
interface Props {
  modelValue?: boolean
  open?: string
  message?: string
  store?: { cls: string; short: string }
  goods?: string
  correctScope?: boolean
  visible?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  open: '',
  message: '',
  store: () => ({ cls: '', short: '' }),
  goods: '',
  correctScope: false,
  visible: false,
})
const __stub = notifyUnavailable
const asset_Cn = ''
// 本地演示输入上限，真实业务接入时由服务契约决定。
const asset_Mt = 20
const asset_dn = ''
const tcInput = ref(demo.tcInput)
const tcTextarea = ref(demo.tcTextarea)
const tcChipItems = ref(demo.tcChipItems)
const tcChipInput = ref(demo.tcChipInput)
const button = ref(demo.button)
const templateItems = ref(demo.templateItems)
const tcInputState = ref(demo.tcInputState)
const isTemplate = ref(demo.isTemplate)
const tcPack = ref(demo.tcPack)
const isDisabled = ref(demo.isDisabled)
const isDisabledState = ref(demo.isDisabledState)
const tcChipTcGoods__chip = ref(demo.tcChipTcGoods__chip)
const isTemplateState = ref(demo.isTemplateState)
const tcGoods__search = ref(demo.tcGoods__search)
const templateItemsState = ref(demo.templateItemsState)
const isTemplateStateDetail = ref(demo.isTemplateStateDetail)
const template = ref(demo.template)
const buttonState = ref(demo.buttonState)
const buttonStateDetail = ref(demo.buttonStateDetail)
const tcField = ref(demo.tcField)
const isTcPack = ref(demo.isTcPack)
const templateState = ref(demo.templateState)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const isDiv = computed(() => demo.isDiv)
const disabledItems = computed(() => demo.disabledItems)
const isTcPackSummary = computed(() => demo.isTcPackSummary)
const isTcField = computed(() => demo.isTcField)
const tcFieldSummary = computed(() => demo.tcFieldSummary)
const isDisabledSummary = computed(() => demo.isDisabledSummary)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()
</script>

<template>
  <Teleport to="body" data-v-4873d925=""
    ><template v-if="props.modelValue"
      ><div class="tc-mask" @click="emit('update:modelValue', false)" data-v-4873d925="">
        <div class="tc-dialog" role="dialog" aria-modal="true" data-v-4873d925="">
          <header class="tc-hd" data-v-4873d925="">
            <div class="tc-hd__title" data-v-4873d925="">
              <span class="tc-hd__icon" data-v-4873d925="">✎</span>
              <div data-v-4873d925="">
                <h3 data-v-4873d925="">纠正 AI 回复</h3>
                <p data-v-4873d925="">保存后写入意图问法，下次买家这样问就按正确回答回复</p>
              </div>
            </div>
            <button
              type="button"
              class="tc-x"
              aria-label="关闭"
              @click="emit('update:modelValue', false)"
              data-v-4873d925=""
            >
              ×
            </button>
          </header>
          <div class="tc-body" data-v-4873d925="">
            <div class="tc-mode" data-v-4873d925="">
              <button
                type="button"
                :class="['tc-mode__card', { 'is-on': buttonState === 'edit' }]"
                :disabled="!disabledItems?.length"
                title="本轮 AI 没有命中意图，只能新建"
                @click="__stub('此操作')"
                data-v-4873d925=""
              >
                <span class="tc-mode__title" data-v-4873d925="">在原意图上修改</span
                ><span class="tc-mode__desc" data-v-4873d925="">{{
                  disabledItems?.length
                    ? '改本轮命中意图的回答，并补上这句问法'
                    : '本轮未命中意图，只能新建'
                }}</span></button
              ><button
                type="button"
                :class="['tc-mode__card', { 'is-on': buttonState === 'new' }]"
                @click="__stub('此操作')"
                data-v-4873d925=""
              >
                <span class="tc-mode__title" data-v-4873d925="">新建意图</span
                ><span class="tc-mode__desc" data-v-4873d925="">按这句买家问题新建一条意图</span>
              </button>
            </div>
            <template v-if="buttonState === 'edit'"
              ><div class="tc-field" data-v-4873d925="">
                <span class="tc-label" data-v-4873d925="">命中的意图</span
                ><template v-if="disabledItems?.length > 1"
                  ><div class="tc-hits" data-v-4873d925="">
                    <template :key="entryIndex" v-for="(item, entryIndex) in disabledItems"
                      ><button
                        type="button"
                        :class="['tc-hit', { 'is-on': String(item?.id) === buttonStateDetail }]"
                        @click="__stub('此操作')"
                        data-v-4873d925=""
                      >
                        {{ item?.name || `意图 ${item?.id}` }}
                      </button></template
                    >
                  </div></template
                ><template v-else
                  ><div class="tc-pack tc-hit-name" data-v-4873d925="">
                    <span class="tc-tag tc-tag--hit" data-v-4873d925="">本轮命中</span
                    >{{ ' ' + (isTcPack ? '加载中…' : isTcPackSummary || '—') }}
                  </div></template
                ><template v-if="templateState"
                  ><div class="tc-warn" data-v-4873d925="">{{ templateState }}</div></template
                >
              </div></template
            ><label class="tc-field" data-v-4873d925=""
              ><span class="tc-label" data-v-4873d925="">买家问题</span
              ><input
                v-show="tcInput"
                @update:modelValue="emit('update:modelValue', $event)"
                class="tc-input"
                maxlength="200"
                placeholder="买家问的是什么"
                data-v-4873d925=""
              /><template v-if="buttonState === 'new'"
                ><span class="tc-help" data-v-4873d925=""></span></template
              ><template v-else
                ><span class="tc-help" data-v-4873d925=""
                  >已加入下方触发问法，意图名称保持不变</span
                ></template
              ></label
            >
            <div class="tc-field" data-v-4873d925="">
              <span class="tc-label" data-v-4873d925="">AI 原回答</span>
              <div :class="['tc-origin', { 'is-empty': !isDiv }]" data-v-4873d925="">
                {{ isDiv || '（本轮 AI 未回复）' }}
              </div>
            </div>
            <label class="tc-field" data-v-4873d925=""
              ><span class="tc-label" data-v-4873d925=""
                >正确回答 <em data-v-4873d925="">*</em></span
              >
              <div class="tc-textarea-wrap" data-v-4873d925="">
                <textarea
                  v-show="tcTextarea"
                  @update:modelValue="__stub('此操作')"
                  class="tc-textarea"
                  :maxlength="asset_Cn"
                  rows="5"
                  placeholder="【当用户咨询意图名称时】
写下你希望 AI 怎么回答这个问题"
                  data-v-4873d925=""
                ></textarea
                ><span class="tc-count" data-v-4873d925=""></span>
              </div>
              <template v-if="buttonState === 'new'"
                ><span class="tc-help" data-v-4873d925=""
                  >首行【当用户咨询…时】说明适用场景，会随买家问题自动更新；下面写对买家说的话</span
                ></template
              ><template v-else
                ><span class="tc-help" data-v-4873d925=""
                  >已填入该意图原来的回答，在此基础上修改；图片 / 视频不受影响</span
                ></template
              ></label
            >
            <div class="tc-field" data-v-4873d925="">
              <div class="tc-label-row" data-v-4873d925="">
                <span class="tc-label" data-v-4873d925=""
                  >触发问法 <em data-v-4873d925="">*</em></span
                ><span class="tc-help" data-v-4873d925=""></span>
              </div>
              <div class="tc-chips" data-v-4873d925="">
                <template :key="index" v-for="(item, index) in tcChipItems"
                  ><span class="tc-chip" data-v-4873d925=""
                    >{{ item + ' '
                    }}<button
                      type="button"
                      class="tc-chip__x"
                      aria-label="删除"
                      @click="emit('update:modelValue', false)"
                      data-v-4873d925=""
                    >
                      ×
                    </button></span
                  ></template
                ><template v-if="tcChipItems?.length < asset_Mt"
                  ><input
                    v-show="tcChipInput"
                    @update:modelValue="__stub('此操作')"
                    class="tc-chip-input"
                    :maxlength="asset_dn"
                    placeholder="+ 添加问法，回车确认"
                    @keydown="__stub('此操作')"
                    data-v-4873d925=""
                /></template>
              </div>
              <button
                type="button"
                class="tc-ai-btn"
                :disabled="isDisabled || tcChipItems?.length >= asset_Mt"
                @click="__stub('此操作')"
                data-v-4873d925=""
              >
                {{ isDisabled ? '生成中…' : '✨ AI 扩写问法' }}
              </button>
            </div>
            <template v-if="buttonState === 'edit'"
              ><div class="tc-field" data-v-4873d925="">
                <span class="tc-label" data-v-4873d925="">生效范围与意图包</span>
                <div class="tc-pack" data-v-4873d925="">
                  {{ tcField ? `${tcFieldSummary} · ${isTcField || '未关联意图包'}` : '—' }}
                </div>
                <span class="tc-help" data-v-4873d925=""
                  >沿用原意图设置，如需调整请到意图问法里编辑</span
                >
              </div></template
            ><template v-if="buttonState === 'new'"
              ><div class="tc-field" data-v-4873d925="">
                <div class="tc-label-row" data-v-4873d925="">
                  <span class="tc-label" data-v-4873d925="">生效范围</span
                  ><span class="tc-help" data-v-4873d925=""
                    >勾选的商品会同步为本训练的纠错默认商品</span
                  >
                </div>
                <div class="tc-seg" data-v-4873d925="">
                  <button
                    type="button"
                    :class="['tc-seg__btn', { 'is-on': button === 'goods' }]"
                    @click="__stub('此操作')"
                    data-v-4873d925=""
                  >
                    指定商品</button
                  ><button
                    type="button"
                    :class="['tc-seg__btn', { 'is-on': button === 'store' }]"
                    @click="__stub('此操作')"
                    data-v-4873d925=""
                  >
                    全店通用
                  </button>
                </div>
                <template v-if="button === 'goods'"
                  ><div class="tc-goods" data-v-4873d925="">
                    <template :key="index" v-for="(item, index) in tcChipTcGoods__chip"
                      ><span class="tc-chip tc-goods__chip" :title="item?.name" data-v-4873d925=""
                        ><template v-if="item?.type === 'keyword'"
                          ><span class="tc-tag tc-tag--kw" data-v-4873d925=""
                            >关键词</span
                          ></template
                        ><template
                          v-else-if="
                            item?.storeName && item?.storeId && item?.storeId !== isTemplateSummary
                          "
                          ><span class="tc-tag tc-tag--store" data-v-4873d925="">{{
                            item?.storeName
                          }}</span></template
                        ><span class="tc-goods__name" data-v-4873d925="">{{ item?.name }}</span
                        ><button
                          type="button"
                          class="tc-chip__x"
                          aria-label="移除"
                          @click="emit('update:modelValue', false)"
                          data-v-4873d925=""
                        >
                          ×
                        </button></span
                      ></template
                    ><span class="tc-help" data-v-4873d925="">还没选商品</span>
                  </div>
                  <div class="tc-goods__ops" data-v-4873d925="">
                    <button
                      type="button"
                      class="tc-link tc-link--plain"
                      @click="__stub('此操作')"
                      data-v-4873d925=""
                    >
                      {{ isTemplateState ? '收起' : '+ 选择商品' }}</button
                    ><template v-if="false"
                      ><button
                        type="button"
                        class="tc-link tc-link--plain"
                        @click="__stub('此操作')"
                        data-v-4873d925=""
                      >
                        + 加入当前咨询商品
                      </button></template
                    >
                  </div>
                  <template v-if="isTemplateState"
                    ><div class="tc-goods__panel" data-v-4873d925="">
                      <input
                        v-show="tcGoods__search"
                        @update:modelValue="__stub('此操作')"
                        class="tc-goods__search"
                        placeholder="搜索商品名称"
                        @input="__stub('此操作')"
                        data-v-4873d925=""
                      />
                      <div class="tc-goods__list" data-v-4873d925="">
                        <template v-if="isTemplateStateDetail"
                          ><div class="tc-help tc-goods__empty" data-v-4873d925="">
                            加载中…
                          </div></template
                        ><template v-else-if="template"
                          ><div class="tc-help tc-goods__empty" data-v-4873d925="">
                            {{ template }}
                          </div></template
                        ><template v-else-if="templateItemsState?.length"
                          ><template
                            :key="entryIndex"
                            v-for="(item, entryIndex) in templateItemsState"
                            ><label class="tc-goods__opt" data-v-4873d925=""
                              ><input
                                type="checkbox"
                                @change="__stub('此操作')"
                                data-v-4873d925="" /><span
                                class="tc-goods__opt-name"
                                data-v-4873d925=""
                                >{{ item?.name }}</span
                              ><span
                                class="tc-goods__opt-id"
                                data-v-4873d925=""
                              ></span></label></template></template
                        ><template v-else
                          ><div class="tc-help tc-goods__empty" data-v-4873d925="">
                            没有找到商品
                          </div></template
                        >
                      </div>
                    </div></template
                  ></template
                >
              </div></template
            ><template v-if="buttonState === 'new'"
              ><div class="tc-field" data-v-4873d925="">
                <span class="tc-label" data-v-4873d925="">保存到意图包</span
                ><template v-if="isTemplate"
                  ><div class="tc-help" data-v-4873d925="">意图包加载中…</div></template
                ><template v-else-if="templateItems?.length"
                  ><template v-if="templateItems?.length > 1"
                    ><select
                      v-show="tcInputState"
                      @update:modelValue="__stub('此操作')"
                      class="tc-input"
                      data-v-4873d925=""
                    >
                      <template :key="entryIndex" v-for="(item, entryIndex) in templateItems"
                        ><option :value="item?.id" data-v-4873d925="">
                          {{ item?.name }}
                        </option></template
                      >
                    </select></template
                  ><template v-else
                    ><div class="tc-pack" data-v-4873d925="">
                      {{ templateItems?.[0]?.name }}
                    </div></template
                  ></template
                ><template v-else
                  ><div class="tc-warn" data-v-4873d925="">
                    {{ tcPack + ' '
                    }}<button
                      type="button"
                      class="tc-link"
                      @click="__stub('此操作')"
                      data-v-4873d925=""
                    >
                      去意图问法绑定
                    </button>
                  </div></template
                >
              </div></template
            >
          </div>
          <footer class="tc-ft" data-v-4873d925="">
            <button
              type="button"
              class="tc-btn tc-btn--ghost"
              :disabled="isDisabledState"
              @click="emit('update:modelValue', false)"
              data-v-4873d925=""
            >
              取消</button
            ><button
              type="button"
              class="tc-btn"
              :disabled="!isDisabledSummary"
              @click="__stub('此操作')"
              data-v-4873d925=""
            >
              {{
                isDisabledState
                  ? '保存中…'
                  : buttonState === 'edit'
                    ? '更新意图并生效'
                    : '保存并立即生效'
              }}
            </button>
          </footer>
        </div>
      </div></template
    ></Teleport
  >
</template>
