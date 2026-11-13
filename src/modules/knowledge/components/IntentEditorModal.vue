<!-- IntentEditorModal：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createIntentEditorModalDemo } from '@/modules/knowledge/demo/IntentEditorModal'
const demo = createIntentEditorModalDemo()
interface Props {
  modelValue?: boolean
}
const props = withDefaults(defineProps<Props>(), { modelValue: false })
const __stub = notifyUnavailable
const asset_Ni = ''

const tagEditor__input = ref(demo.tagEditor__input)
const isDisabled = ref(demo.isDisabled)
const isDisabledState = ref(demo.isDisabledState)
const isDiv = ref(demo.isDiv)
const intentMetaRow__name = computed(() => demo.intentMetaRow__name)
const fieldHint = computed(() => demo.fieldHint)
const fieldHintSummary = computed(() => demo.fieldHintSummary)
const isDivSummary = computed(() => demo.isDivSummary)
const isTemplate = computed(() => demo.isTemplate)
const rows = computed(() => demo.rows)
const fieldHintSummaryDetail = computed(() => demo.fieldHintSummaryDetail)
const intentMediaField = computed(() => demo.intentMediaField)
const count = computed(() => demo.count)
const intentGoodsSide__stats = computed(() => demo.intentGoodsSide__stats)
const displayText = computed(() => demo.displayText)
const disabled = computed(() => demo.disabled)
const isSpan = computed(() => demo.isSpan)
const input = ref(demo.input)
const isDivPreview = ref(demo.isDivPreview)
const div = ref(demo.div)
const intentModalMain = ref(demo.intentModalMain)
const value = ref(demo.value)
const maxlength = ref(demo.maxlength)
const rowsPreview = ref(demo.rowsPreview)
const isSelect = ref(demo.isSelect)
const isSelectPreview = ref(demo.isSelectPreview)
const intentGoodsSearch__input = ref(demo.intentGoodsSearch__input)
const chipChip_EditableItems = ref(demo.chipChip_EditableItems)
const isMaxlength = ref(demo.isMaxlength)
const isDisabledPreview = ref(demo.isDisabledPreview)
const valuePreview = ref(demo.valuePreview)
const maxlengthPreview = ref(demo.maxlengthPreview)
const rowsPreviewDetail = ref(demo.rowsPreviewDetail)
const disabledPreview = ref(demo.disabledPreview)
const isDisabledPreviewDetail = ref(demo.isDisabledPreviewDetail)
const rowsPreviewDetailDetail = ref(demo.rowsPreviewDetailDetail)
const isButton = ref(demo.isButton)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()

const emptyPreviewRowsA = demo.emptyPreviewRowsA
</script>

<template>
  <Teleport to="body" data-v-b3ab9dcb=""
    ><template v-if="props.modelValue"
      ><div class="shop-manage shop-portal-root" data-v-b3ab9dcb="">
        <div class="mask" data-v-b3ab9dcb=""></div>
        <div
          :class="['modal modal--intent', { 'is-goods-side': isDivPreview && div === 'goods' }]"
          role="dialog"
          aria-modal="true"
          @click="__stub('此操作')"
          data-v-b3ab9dcb=""
        >
          <div
            :class="['intent-modal-layout', { 'is-goods-side': isDivPreview && div === 'goods' }]"
            data-v-b3ab9dcb=""
          >
            <div class="intent-modal-main" data-v-b3ab9dcb="">
              <header data-v-b3ab9dcb="">
                <h3 data-v-b3ab9dcb="">{{ intentModalMain }}</h3>
                <button
                  type="button"
                  aria-label="关闭"
                  @click="emit('update:modelValue', false)"
                  data-v-b3ab9dcb=""
                >
                  ×
                </button>
              </header>
              <div class="modal__body" data-v-b3ab9dcb="">
                <div class="intent-meta-row" data-v-b3ab9dcb="">
                  <label class="intent-meta-row__name" data-v-b3ab9dcb=""
                    ><span class="intent-meta-row__label" data-v-b3ab9dcb="">
                      意图名称 <b data-v-b3ab9dcb="">{{ intentMetaRow__name }}</b></span
                    ><input
                      :value="value"
                      placeholder="如：询价、催发货"
                      :maxlength="maxlength"
                      title="顾客咨询到什么问题时触发这条意图"
                      @input="__stub('此操作')"
                      data-v-b3ab9dcb="" /></label
                  ><label class="intent-meta-row__scene" data-v-b3ab9dcb=""
                    ><span class="intent-meta-row__label" data-v-b3ab9dcb="">归类</span
                    ><select
                      v-show="isSelect"
                      @update:modelValue="emit('update:modelValue', $event)"
                      title="只是分组整理，选哪个都能回复；没有合适的就用「自定义知识」"
                      data-v-b3ab9dcb=""
                    >
                      <template :key="entryIndex" v-for="(item, entryIndex) in rowsPreview"
                        ><option :value="item?.id" data-v-b3ab9dcb="">
                          {{ item?.label }}
                        </option></template
                      >
                    </select></label
                  ><label class="intent-meta-row__order" data-v-b3ab9dcb=""
                    ><span class="intent-meta-row__label" data-v-b3ab9dcb="">订单状态</span
                    ><select
                      v-show="isSelectPreview"
                      @update:modelValue="__stub('此操作')"
                      title="「通用」所有人都回复；「已下单」只回已经买过的，「未下单」只回还没买的"
                      data-v-b3ab9dcb=""
                    >
                      <template :key="entryIndex" v-for="(item, entryIndex) in asset_Ni"
                        ><option :value="item" data-v-b3ab9dcb="">{{ item }}</option></template
                      >
                    </select></label
                  >
                  <p class="field-hint intent-meta-row__hint" data-v-b3ab9dcb="">
                    归类只用于整理，不影响回复。通用回复所有人；已下单只回买过的，未下单只回还没买的。
                  </p>
                </div>
                <div class="intent-scope-field" data-v-b3ab9dcb="">
                  <div class="intent-scope-field__hd" data-v-b3ab9dcb="">
                    <span data-v-b3ab9dcb="">适用范围</span
                    ><em data-v-b3ab9dcb="">这条意图管全店，还是只针对部分商品</em>
                  </div>
                  <div class="intent-scope-tabs" data-v-b3ab9dcb="">
                    <button
                      type="button"
                      :class="{ 'is-on': div === 'general' }"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      通用问题</button
                    ><button
                      type="button"
                      :class="{ 'is-on': div === 'goods' }"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      指定商品
                    </button>
                  </div>
                  <p class="field-hint" data-v-b3ab9dcb="">
                    通用问题：全店咨询都能用。指定商品：只回答这些商品相关的问题。
                  </p>
                  <template v-if="div === 'goods'"
                    ><div class="intent-goods-fields" data-v-b3ab9dcb="">
                      <div class="intent-goods-fields__hd" data-v-b3ab9dcb="">已选商品</div>
                      <div
                        :class="[
                          'tag-editor intent-goods-chips',
                          { 'is-expanded': isDiv && isDivSummary > 6 },
                        ]"
                        data-v-b3ab9dcb=""
                      >
                        <template :key="i" v-for="(g, i) in rows"
                          ><span
                            :class="['chip', { 'chip--keyword': !g?.goodsId }]"
                            title="商品关键词：多店标题包含即可命中（点击可改）"
                            @click="__stub('此操作')"
                            data-v-b3ab9dcb=""
                            ><span class="chip__text" data-v-b3ab9dcb="">{{
                              g?.goodsId ? `ID ${g?.goodsId}` : `词·${g?.goodsName}`
                            }}</span
                            ><button
                              type="button"
                              aria-label="移除"
                              @click="emit('update:modelValue', false)"
                              data-v-b3ab9dcb=""
                            >
                              ×
                            </button></span
                          ></template
                        ><template v-if="isTemplate"
                          ><button
                            type="button"
                            class="chip chip--more"
                            :title="`已选 ${isDivSummary} 个，点击展开`"
                            @click="__stub('此操作')"
                            data-v-b3ab9dcb=""
                          ></button></template
                        ><template v-else-if="isDivSummary > 6"
                          ><button
                            type="button"
                            class="chip chip--more"
                            @click="__stub('此操作')"
                            data-v-b3ab9dcb=""
                          >
                            收起
                          </button></template
                        ><span class="intent-goods-fields__empty" data-v-b3ab9dcb=""
                          >可填关键词模糊绑定多店，或搜索后从右侧勾选精确商品</span
                        >
                      </div>
                      <div class="intent-goods-search" data-v-b3ab9dcb="">
                        <input
                          v-show="intentGoodsSearch__input"
                          @update:modelValue="__stub('此操作')"
                          class="intent-goods-search__input"
                          placeholder="填关键词可模糊绑定多店，或搜索标题 / ID / 编码"
                          maxlength="80"
                          @keydown="__stub('此操作')"
                          data-v-b3ab9dcb=""
                        /><button
                          class="btn btn--ghost btn--sm"
                          type="button"
                          @click="__stub('此操作')"
                          data-v-b3ab9dcb=""
                        >
                          搜索</button
                        ><button
                          class="btn btn--primary btn--sm"
                          type="button"
                          @click="__stub('此操作')"
                          data-v-b3ab9dcb=""
                        >
                          绑定关键词
                        </button>
                      </div>
                      <span class="field-hint" data-v-b3ab9dcb="">
                        回车/绑定关键词：多店标题模糊包含即命中；也可搜索后勾选右侧精确商品 ·
                        <b data-v-b3ab9dcb="">{{ fieldHintSummary }}</b></span
                      >
                    </div></template
                  >
                </div>
                <div class="intent-kw-field" data-v-b3ab9dcb="">
                  <div class="intent-kw-field__hd" data-v-b3ab9dcb="">
                    <span data-v-b3ab9dcb="">触发关键词</span
                    ><el-tooltip
                      placement="bottom-start"
                      show-after="120"
                      popper-class="intent-guide-popper"
                      data-v-b3ab9dcb=""
                      ><template #content
                        ><div class="intent-guide-pop" data-v-b3ab9dcb="">
                          <strong data-v-b3ab9dcb="">怎么填关键词</strong>
                          <p data-v-b3ab9dcb="">
                            写成顾客常说的原话，意思接近的都加上，更容易命中。
                          </p>
                          <p data-v-b3ab9dcb="">
                            例如售后破损，可以加：<b data-v-b3ab9dcb=""
                              >破了、烂了、坏了、破损了、收到坏的</b
                            >
                          </p>
                          <p data-v-b3ab9dcb="">命中后会走下面的意图规则。</p>
                        </div></template
                      ><button
                        type="button"
                        class="intent-guide-btn"
                        aria-label="查看关键词填写教程"
                        data-v-b3ab9dcb=""
                      >
                        <i data-v-b3ab9dcb="">?</i>教程
                      </button></el-tooltip
                    ><em class="intent-field-tip" data-v-b3ab9dcb=""
                      >多加几句顾客可能问到的话，匹配范围更广</em
                    >
                  </div>
                  <div class="tag-editor" data-v-b3ab9dcb="">
                    <template :key="index" v-for="(item, index) in chipChip_EditableItems"
                      ><span
                        class="chip chip--editable"
                        title="点击修改"
                        @click="__stub('此操作')"
                        data-v-b3ab9dcb=""
                        >{{ item + ' '
                        }}<button
                          type="button"
                          aria-label="删除关键词"
                          @click="emit('update:modelValue', false)"
                          data-v-b3ab9dcb=""
                        >
                          ×
                        </button></span
                      ></template
                    ><input
                      v-show="tagEditor__input"
                      @update:modelValue="__stub('此操作')"
                      class="tag-editor__input"
                      :maxlength="isMaxlength"
                      placeholder="输入后回车添加"
                      @keydown="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    /><button
                      class="btn btn--ghost btn--sm"
                      type="button"
                      :disabled="chipChip_EditableItems?.length >= isDisabledPreview"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      + 新增关键词</button
                    ><button
                      class="btn btn--ghost btn--sm"
                      type="button"
                      :disabled="
                        isDisabledState || chipChip_EditableItems?.length >= isDisabledPreview
                      "
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      {{ isDisabledState ? '生成中…' : '生成更多问法' }}
                    </button>
                  </div>
                  <span class="field-hint" data-v-b3ab9dcb=""
                    >{{
                      ' 逐个添加，最多 ' +
                      isDisabledPreview +
                      ' 个，每个不超过 ' +
                      isMaxlength +
                      ' 字；生成问法会在现有基础上追加，不会覆盖 · '
                    }}<b data-v-b3ab9dcb="">{{ fieldHint }}</b></span
                  >
                </div>
                <label data-v-b3ab9dcb=""
                  ><span class="intent-field-hd" data-v-b3ab9dcb=""
                    ><span data-v-b3ab9dcb="">意图规则</span
                    ><el-tooltip
                      placement="bottom-start"
                      show-after="120"
                      popper-class="intent-guide-popper"
                      data-v-b3ab9dcb=""
                      ><template #content
                        ><div class="intent-guide-pop" data-v-b3ab9dcb="">
                          <strong data-v-b3ab9dcb="">怎么写回复流程</strong>
                          <p data-v-b3ab9dcb="">顾客问到「破了、烂了、坏了」时，按顺序写：</p>
                          <p data-v-b3ab9dcb="">
                            1. 先道歉，确认商品有破损<br data-v-b3ab9dcb="" />2.
                            请对方发照片，说清件数<br data-v-b3ab9dcb="" />3.
                            给出处理：补发、退款，或转人工
                          </p>
                        </div></template
                      ><button
                        type="button"
                        class="intent-guide-btn"
                        aria-label="查看回复流程教程"
                        data-v-b3ab9dcb=""
                      >
                        <i data-v-b3ab9dcb="">?</i>教程
                      </button></el-tooltip
                    ><em class="intent-field-tip" data-v-b3ab9dcb=""
                      >顾客问到这些问题时，先说什么、再问什么、怎么收口</em
                    ></span
                  ><textarea
                    :value="valuePreview"
                    rows="5"
                    :maxlength="maxlengthPreview"
                    placeholder="按回复流程写：先安抚/给结论，再补细节，必要时引导转人工"
                    @input="__stub('此操作')"
                    data-v-b3ab9dcb=""
                  ></textarea
                  ><span class="field-hint" data-v-b3ab9dcb=""
                    >接待话术 · <b data-v-b3ab9dcb="">{{ fieldHintSummaryDetail }}</b></span
                  ></label
                >
                <div class="intent-media-field" data-v-b3ab9dcb="">
                  <div class="intent-media-field__hd" data-v-b3ab9dcb="">
                    <span data-v-b3ab9dcb="">图片 / 视频</span
                    ><em data-v-b3ab9dcb="">{{ intentMediaField }}</em>
                  </div>
                  <div class="intent-media-field__list" data-v-b3ab9dcb="">
                    <div class="intent-media-empty" data-v-b3ab9dcb="">
                      还没添加。其他平台可直接上传图片/视频
                    </div>
                    <template :key="index" v-for="(item, index) in rowsPreviewDetail"
                      ><div
                        :class="[
                          'intent-media-item',
                          { 'is-video': item?.type === 'video' && true, 'is-pdd': '' },
                        ]"
                        data-v-b3ab9dcb=""
                      >
                        <template v-if="false"
                          ><div class="intent-media-item__pdd" data-v-b3ab9dcb="">
                            <strong data-v-b3ab9dcb="">拼多多视频</strong
                            ><em :title="item?.pddUrl || item?.url" data-v-b3ab9dcb="">{{
                              item?.pddUrl || item?.url
                            }}</em>
                          </div></template
                        ><template v-else-if="item?.type === 'video' && item?.url"
                          ><video
                            :src="item?.url"
                            muted
                            preload="metadata"
                            data-v-b3ab9dcb=""
                          ></video></template
                        ><template v-else-if="item?.type === 'video'"
                          ><div class="intent-media-item__pdd" data-v-b3ab9dcb="">
                            <strong data-v-b3ab9dcb="">视频</strong
                            ><em data-v-b3ab9dcb="">{{ item?.name || '本地视频（待加载）' }}</em>
                          </div></template
                        ><template v-else-if="item?.url"
                          ><img :src="item?.url" alt="" data-v-b3ab9dcb="" /></template
                        ><template v-else
                          ><div class="intent-media-item__pdd" data-v-b3ab9dcb="">
                            <strong data-v-b3ab9dcb="">图片</strong
                            ><em data-v-b3ab9dcb="">{{ item?.name || '待加载' }}</em>
                          </div></template
                        ><span class="intent-media-item__badge" data-v-b3ab9dcb="">{{
                          item?.type === 'video' ? '视频' : '图片'
                        }}</span
                        ><button
                          type="button"
                          class="intent-media-item__del"
                          title="移除"
                          @click="emit('update:modelValue', false)"
                          data-v-b3ab9dcb=""
                        >
                          ×</button
                        ><em :title="item?.name || item?.url || ''" data-v-b3ab9dcb="">{{
                          item?.name || (item?.type === 'video' ? '视频' : '图片')
                        }}</em>
                      </div></template
                    >
                  </div>
                  <div class="intent-media-field__acts" data-v-b3ab9dcb="">
                    <button
                      class="btn btn--ghost btn--sm"
                      type="button"
                      :disabled="rowsPreviewDetail?.length >= disabledPreview"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      + 添加图片</button
                    ><button
                      class="btn btn--ghost btn--sm"
                      type="button"
                      :disabled="rowsPreviewDetail?.length >= disabledPreview"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      + 添加视频</button
                    ><button
                      class="btn btn--ghost btn--sm"
                      type="button"
                      :disabled="rowsPreviewDetail?.length >= disabledPreview"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      + 拼多多视频（贴链接）
                    </button>
                  </div>
                  <div class="intent-media-field__pdd" data-v-b3ab9dcb="">
                    <input
                      v-show="input"
                      @update:modelValue="__stub('此操作')"
                      type="url"
                      placeholder="从拼多多素材库复制视频链接，粘贴到这里"
                      @keydown="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    />
                  </div>
                  <p class="intent-media-field__tip" data-v-b3ab9dcb=""></p>
                  <input
                    type="file"
                    accept="image/*"
                    hidden=""
                    multiple
                    @change="__stub('此操作')"
                    data-v-b3ab9dcb=""
                  /><input
                    type="file"
                    accept="video/*"
                    hidden=""
                    multiple
                    @change="__stub('此操作')"
                    data-v-b3ab9dcb=""
                  />
                </div>
              </div>
              <footer data-v-b3ab9dcb="">
                <button
                  class="btn btn--ghost"
                  type="button"
                  :disabled="isDisabled || isDisabledPreviewDetail"
                  @click="emit('update:modelValue', false)"
                  data-v-b3ab9dcb=""
                >
                  取消</button
                ><button
                  class="btn btn--primary"
                  type="button"
                  :disabled="isDisabled || isDisabledPreviewDetail"
                  @click="__stub('此操作')"
                  data-v-b3ab9dcb=""
                >
                  {{ isDisabled || isDisabledPreviewDetail ? '保存中…' : '保存' }}
                </button>
              </footer>
            </div>
            <aside
              v-show="isDivPreview && div === 'goods'"
              class="intent-goods-side"
              data-v-b3ab9dcb=""
            >
              <div class="intent-goods-side__hd" data-v-b3ab9dcb="">
                <div data-v-b3ab9dcb="">
                  <strong data-v-b3ab9dcb="">选商品</strong
                  ><em data-v-b3ab9dcb="">仅本意图包已绑店铺 · 勾选即可绑定</em>
                </div>
                <span class="intent-goods-side__stats" data-v-b3ab9dcb="">{{
                  intentGoodsSide__stats
                }}</span>
              </div>
              <div class="intent-goods-side__body" data-v-b3ab9dcb="">
                <div class="intent-goods-side__shops" data-v-b3ab9dcb="">
                  <template :key="entryIndex" v-for="(item, entryIndex) in rowsPreviewDetailDetail"
                    ><button
                      type="button"
                      :class="[
                        'intent-goods-side__shop-btn',
                        { 'is-on': String(item?.shopId) === String(isButton) },
                      ]"
                      @click="__stub('此操作')"
                      data-v-b3ab9dcb=""
                    >
                      <b data-v-b3ab9dcb="">{{ item?.shopName || item?.shopId }}</b
                      ><em data-v-b3ab9dcb=""></em></button
                  ></template>
                  <p class="intent-goods-side__empty" data-v-b3ab9dcb="">
                    暂无店铺商品。请先给该意图包绑定店铺，或换个搜索词
                  </p>
                </div>
                <div class="intent-goods-side__goods" data-v-b3ab9dcb="">
                  <div class="intent-goods-side__goods-hd" data-v-b3ab9dcb="">
                    <div class="intent-goods-side__goods-hd-main" data-v-b3ab9dcb="">
                      <button
                        type="button"
                        class="intent-goods-side__select-all"
                        :disabled="!disabled?.length"
                        title="全选本店匹配商品"
                        @click="__stub('此操作')"
                        data-v-b3ab9dcb=""
                      >
                        <span
                          :class="[
                            'intent-goods-side__check',
                            { 'is-on': isSpan, 'is-partial': null },
                          ]"
                          aria-hidden="true"
                          data-v-b3ab9dcb=""
                        ></span
                        ><em data-v-b3ab9dcb="">{{ isSpan ? '取消全选' : '全选' }}</em></button
                      ><span data-v-b3ab9dcb="">{{ '商品名称' }}</span>
                    </div>
                    <em data-v-b3ab9dcb=""
                      >{{ ' 共 ' + displayText + ' 个 '
                      }}<template v-if="count">{{
                        ' · 本店 ' + count?.count + ' 个'
                      }}</template></em
                    >
                  </div>
                  <div class="intent-goods-side__list" data-v-b3ab9dcb="">
                    <template :key="index" v-for="(item, index) in emptyPreviewRowsA"
                      ><div
                        :class="['intent-goods-side__item', { 'is-checked': '' }]"
                        role="checkbox"
                        aria-checked="false"
                        tabindex="0"
                        @click="__stub('此操作')"
                        @keydown="__stub('此操作')"
                        data-v-b3ab9dcb=""
                      >
                        <span
                          :class="['intent-goods-side__check', { 'is-on': '' }]"
                          aria-hidden="true"
                          data-v-b3ab9dcb=""
                        ></span>
                        <div class="intent-goods-side__content" data-v-b3ab9dcb="">
                          <div class="intent-goods-side__name" data-v-b3ab9dcb="">
                            {{ item?.goodsName || item?.goodsId || '未命名商品' }}
                          </div>
                          <template v-if="item?.goodsId || item?.goodsCode"
                            ><div class="intent-goods-side__meta" data-v-b3ab9dcb="">
                              <template v-if="item?.goodsId">{{ 'ID ' + item?.goodsId }}</template
                              ><template v-if="item?.goodsId && item?.goodsCode"> · </template
                              ><template v-if="item?.goodsCode">{{
                                '编码 ' + item?.goodsCode
                              }}</template>
                            </div></template
                          >
                        </div>
                      </div></template
                    >
                    <div class="intent-goods-side__empty" data-v-b3ab9dcb="">
                      {{ '该店铺没有匹配商品，试试别的词' }}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div></template
    ></Teleport
  >
</template>
