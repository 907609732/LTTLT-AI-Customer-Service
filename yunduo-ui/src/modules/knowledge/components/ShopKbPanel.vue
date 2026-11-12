<!-- ShopKbPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createShopKbPanelDemo } from '@/modules/knowledge/demo/ShopKbPanel'
const demo = createShopKbPanelDemo()
interface Props {
  viewKey?: string
}
const props = withDefaults(defineProps<Props>(), { viewKey: '' })
const __stub = notifyUnavailable
const fieldHint = computed(() => demo.fieldHint)
const isTemplate = ref(demo.isTemplate)
const isTemplatePreview = ref(demo.isTemplatePreview)
const length = ref(demo.length)
const input = ref(demo.input)
const rows = ref(demo.rows)
const div = ref(demo.div)
const name = ref(demo.name)
const maxlength = ref(demo.maxlength)
const maxlengthPreview = ref(demo.maxlengthPreview)
const button = ref(demo.button)
const lengthPreview = ref(demo.lengthPreview)
const lengthPreviewDetail = ref(demo.lengthPreviewDetail)
const rowsPreview = ref(demo.rowsPreview)
const divPreview = ref(demo.divPreview)
const isTemplatePreviewDetail = ref(demo.isTemplatePreviewDetail)
const buttonPreview = ref(demo.buttonPreview)
const isInput = ref(demo.isInput)
const isInputPreview = ref(demo.isInputPreview)
const isInputPreviewDetail = ref(demo.isInputPreviewDetail)
const isTemplatePreviewDetailDetail = ref(demo.isTemplatePreviewDetailDetail)
const isTemplatePreviewDetailDetailDetail = ref(demo.isTemplatePreviewDetailDetailDetail)
const isButton = ref(demo.isButton)
const buttonPreviewDetail = ref(demo.buttonPreviewDetail)
const lengthPreviewDetailDetail = ref(demo.lengthPreviewDetailDetail)
const lengthPreviewDetailDetailDetail = ref(demo.lengthPreviewDetailDetailDetail)
const templateItems = ref(demo.templateItems)

const kbBindDialog__body = ref(demo.kbBindDialog__body)
const isTemplatePreviewDetailDetailDetailDetail = ref(
  demo.isTemplatePreviewDetailDetailDetailDetail,
)

const emptyPreviewRowsA = demo.emptyPreviewRowsA
</script>

<template>
  <section id="viewKb" class="view is-on" data-v-5f3c24c3="">
    <div class="page-head" data-v-5f3c24c3="">
      <div data-v-5f3c24c3="">
        <h1 data-v-5f3c24c3="">尺码规格表</h1>
        <p data-v-5f3c24c3="">
          一条尺码/规格可跨平台绑多店多商品，不用每个商品重复填。商品绑进一条后不能再绑第二条。
          <template v-if="isTemplate"
            ><span class="tag demo" :style="{ 'margin-left': '8px' }" data-v-5f3c24c3=""
              >演示数据</span
            ></template
          ><template v-if="isTemplatePreview"
            ><span class="tag uncfg" :style="{ 'margin-left': '8px' }" data-v-5f3c24c3=""
              >未保存</span
            ></template
          >
        </p>
      </div>
      <div class="page-head__acts" data-v-5f3c24c3="">
        <button class="btn btn--ghost" type="button" @click="__stub('此操作')" data-v-5f3c24c3="">
          保存当前规则</button
        ><button
          class="btn btn--primary"
          type="button"
          @click="__stub('此操作')"
          data-v-5f3c24c3=""
        >
          + 新建规则
        </button>
      </div>
    </div>
    <div
      v-show="divPreview"
      :class="['kb-frame', { 'is-empty': !length?.length }]"
      data-v-5f3c24c3=""
    >
      <template v-if="length?.length"
        ><aside class="kb-col kb-col--list" data-v-5f3c24c3="">
          <div class="kb-col__hd" data-v-5f3c24c3="">
            <div data-v-5f3c24c3="">
              <div class="kb-col__title" data-v-5f3c24c3="">
                规则 <b data-v-5f3c24c3="">{{ length?.length }}</b
                ><span class="kb-col__meta" data-v-5f3c24c3="">筛选中</span>
              </div>
            </div>
          </div>
          <div class="kb-list-tools" data-v-5f3c24c3="">
            <label class="search kb-search" data-v-5f3c24c3=""
              ><span data-v-5f3c24c3="">⌕</span
              ><input
                v-show="input?.q"
                @update:modelValue="__stub('此操作')"
                type="search"
                placeholder="搜索规则名称"
                @input="__stub('此操作')"
                data-v-5f3c24c3="" /></label
            ><select
              v-show="input?.status"
              @update:modelValue="__stub('此操作')"
              class="kb-status-select"
              data-v-5f3c24c3=""
            >
              <option value="all" data-v-5f3c24c3="">全部状态</option>
              <option value="on" data-v-5f3c24c3="">已启用</option>
              <option value="off" data-v-5f3c24c3="">已停用</option>
            </select>
          </div>
          <div class="kb-list" data-v-5f3c24c3="">
            <template :key="entryIndex" v-for="(item, entryIndex) in rows"
              ><div
                :class="[
                  'kb-rule-card',
                  { 'is-on': String(item?.id) === String(div), 'is-dim': item?.status === 'off' },
                ]"
                role="button"
                tabindex="0"
                @click="__stub('此操作')"
                @keydown="__stub('此操作')"
                data-v-5f3c24c3=""
              >
                <div class="kb-rule-card__body" data-v-5f3c24c3="">
                  <div class="kb-rule-card__top" data-v-5f3c24c3="">
                    <strong data-v-5f3c24c3="">{{ item?.name }}</strong
                    ><span
                      :class="['tag', item?.status === 'on' ? 'on' : 'off']"
                      data-v-5f3c24c3=""
                      >{{ item?.status === 'on' ? '启用' : '停用' }}</span
                    >
                  </div>
                  <p data-v-5f3c24c3=""></p>
                  <div class="kb-rule-card__meta" data-v-5f3c24c3="">
                    <span data-v-5f3c24c3=""></span><span data-v-5f3c24c3=""></span
                    ><button
                      class="btn btn--ghost btn--sm kb-rule-card__bind"
                      type="button"
                      title="管理该规则的店铺与商品绑定"
                      @click="__stub('此操作')"
                      data-v-5f3c24c3=""
                    >
                      管理绑定
                    </button>
                  </div>
                </div>
              </div></template
            >
            <div class="kb-empty" data-v-5f3c24c3="">没有匹配的规则</div>
          </div>
          <button
            class="btn btn--ghost btn--sm kb-list-example-btn"
            type="button"
            @click="__stub('此操作')"
            data-v-5f3c24c3=""
          >
            查看添加示例
          </button>
        </aside>
        <section class="kb-col kb-col--edit" data-v-5f3c24c3="">
          <template v-if="name"
            ><div class="kb-col__hd" data-v-5f3c24c3="">
              <div data-v-5f3c24c3="">
                <div class="kb-col__title" data-v-5f3c24c3="">编辑规则</div>
                <div class="kb-col__sub" data-v-5f3c24c3="">
                  写给 AI 看的尺码/规格资料 · 可跨店共用
                </div>
              </div>
              <div class="kb-col__acts" data-v-5f3c24c3="">
                <button
                  class="btn btn--danger btn--sm"
                  type="button"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  删除
                </button>
              </div>
            </div>
            <div class="kb-editor" data-v-5f3c24c3="">
              <div class="kb-tip" data-v-5f3c24c3="">
                <strong data-v-5f3c24c3="">怎么写更好？</strong>
                <p data-v-5f3c24c3="">
                  先贴尺码表（可用 |
                  分列），再写选码建议。点右侧「管理绑定」勾选多店多商品即可，不必每个商品重复添加。
                </p>
              </div>
              <div class="kb-form-simple" data-v-5f3c24c3="">
                <label class="kb-name-field" data-v-5f3c24c3=""
                  ><span data-v-5f3c24c3="">
                    规则名称 <span class="field-hint kb-name-count" data-v-5f3c24c3=""></span></span
                  ><input
                    :value="name?.name"
                    type="text"
                    :maxlength="maxlength"
                    placeholder="如：女装尺码表"
                    @input="__stub('此操作')"
                    data-v-5f3c24c3=""
                /></label>
                <div class="kb-switch-field" data-v-5f3c24c3="">
                  <span data-v-5f3c24c3="">启用</span
                  ><span class="kb-switch-line" data-v-5f3c24c3=""
                    ><label class="toggle" data-v-5f3c24c3=""
                      ><input
                        type="checkbox"
                        :checked="name?.status === 'on'"
                        @change="__stub('此操作')"
                        data-v-5f3c24c3="" /><i data-v-5f3c24c3=""></i></label
                  ></span>
                </div>
              </div>
              <label class="kb-content-field" data-v-5f3c24c3="">
                规则内容
                <textarea
                  :value="name?.content"
                  rows="14"
                  :maxlength="maxlengthPreview"
                  placeholder="例如：
尺码 | 胸围 | 腰围
S | 84 | 66
M | 88 | 70

偏宽松，两码之间选大一码。"
                  @input="__stub('此操作')"
                  data-v-5f3c24c3=""
                ></textarea
                ><span class="field-hint" data-v-5f3c24c3=""
                  ><b data-v-5f3c24c3="">{{ fieldHint }}</b
                  >{{ ' / ' + maxlengthPreview }}</span
                ></label
              >
            </div></template
          ><template v-else
            ><div class="kb-empty" data-v-5f3c24c3="">请选择或新建一条规则</div></template
          >
        </section>
        <template v-if="name"
          ><aside class="kb-col kb-col--bind kb-col--bind-summary" data-v-5f3c24c3="">
            <div class="kb-col__hd" data-v-5f3c24c3="">
              <div data-v-5f3c24c3="">
                <div class="kb-col__title" data-v-5f3c24c3="">绑定概览</div>
                <div class="kb-col__sub" data-v-5f3c24c3="">
                  点规则即可看已绑 / 未绑，改绑定请开弹窗
                </div>
              </div>
            </div>
            <div class="kb-bind-stats" data-v-5f3c24c3="">
              <button
                :class="['kb-bind-stat', { 'is-on': button === 'bound' }]"
                type="button"
                @click="__stub('此操作')"
                data-v-5f3c24c3=""
              >
                <b data-v-5f3c24c3="">{{ lengthPreview?.length }}</b
                ><span data-v-5f3c24c3="">已绑店铺</span></button
              ><button
                class="kb-bind-stat"
                type="button"
                title="打开管理绑定查看商品"
                @click="__stub('此操作')"
                data-v-5f3c24c3=""
              >
                <b data-v-5f3c24c3="">{{
                  Number(name?.bindGoodsCount ?? (name?.goodsIds || [])?.length) || 0
                }}</b
                ><span data-v-5f3c24c3="">已绑商品</span></button
              ><button
                :class="[
                  'kb-bind-stat',
                  { 'is-on': button === 'unbound', 'kb-bind-stat--mute': button !== 'unbound' },
                ]"
                type="button"
                @click="__stub('此操作')"
                data-v-5f3c24c3=""
              >
                <b data-v-5f3c24c3="">{{ lengthPreviewDetail?.length }}</b
                ><span data-v-5f3c24c3="">未绑店铺</span>
              </button>
            </div>
            <div class="kb-bind-summary-list" data-v-5f3c24c3="">
              <div class="kb-bind-summary-label" data-v-5f3c24c3="">
                {{
                  button === 'unbound'
                    ? `未绑定店铺 · ${lengthPreviewDetail?.length}`
                    : '已绑定店铺'
                }}
              </div>
              <template :key="entryIndex" v-for="(item, entryIndex) in rowsPreview"
                ><button
                  type="button"
                  :class="[
                    'kb-bind-item kb-bind-item--shop',
                    button === 'bound' ? 'is-on' : 'kb-bind-item--off',
                  ]"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  <img class="plat-ico" data-v-5f3c24c3="" /><span
                    class="kb-bind-item__meta"
                    data-v-5f3c24c3=""
                    ><strong data-v-5f3c24c3="">{{ item?.name }}</strong
                    ><em data-v-5f3c24c3=""></em
                  ></span></button
              ></template>
              <div class="kb-empty kb-empty--sm" data-v-5f3c24c3="">
                {{ button === 'unbound' ? '没有未绑定店铺' : '这条规则还没绑店铺或商品' }}
              </div>
            </div>
            <div class="kb-bind-summary-acts" data-v-5f3c24c3="">
              <button
                class="btn btn--primary"
                type="button"
                @click="__stub('此操作')"
                data-v-5f3c24c3=""
              >
                管理绑定
              </button>
            </div>
          </aside></template
        ></template
      ><template v-else
        ><div class="kb-guide" data-v-5f3c24c3="">
          &lt;div class="kb-guide__hero" data-v-5f3c24c3&gt;&lt;strong
          data-v-5f3c24c3&gt;还没有规则，先学怎么加一条尺码表&lt;/strong&gt;&lt;p
          data-v-5f3c24c3&gt;一条规则可以跨平台绑定多个店铺、多个商品，不用每个商品单独填尺码。商品绑进
          A 规则后，就不能再绑 B 规则。&lt;/p&gt;&lt;/div&gt;&lt;ol class="kb-guide__steps"
          data-v-5f3c24c3&gt;&lt;li data-v-5f3c24c3&gt;&lt;b data-v-5f3c24c3&gt;1&lt;/b&gt;&lt;span
          data-v-5f3c24c3&gt;点下方示例一键创建，或右上角「新建规则」自己写&lt;/span&gt;&lt;/li&gt;&lt;li
          data-v-5f3c24c3&gt;&lt;b data-v-5f3c24c3&gt;2&lt;/b&gt;&lt;span
          data-v-5f3c24c3&gt;在编辑区粘贴尺码表，再写选码建议&lt;/span&gt;&lt;/li&gt;&lt;li
          data-v-5f3c24c3&gt;&lt;b data-v-5f3c24c3&gt;3&lt;/b&gt;&lt;span
          data-v-5f3c24c3&gt;点「管理绑定」勾选店铺和商品，保存后即可接待调用&lt;/span&gt;&lt;/li&gt;&lt;/ol&gt;
          <div class="kb-guide__ex" data-v-5f3c24c3="">
            <div class="kb-guide__ex-title" data-v-5f3c24c3="">推荐示例（点一下即可创建）</div>
            <div class="kb-guide__ex-grid" data-v-5f3c24c3="">
              <template
                :key="entryIndex"
                v-for="(item, entryIndex) in [
                  {
                    id: 'ex-women',
                    name: '女装尺码表',
                    tip: '适合连衣裙、上衣等女装，一表绑多店多款',
                    content:
                      '尺码 | 胸围 | 腰围 | 肩宽 | 衣长\nS | 84 | 66 | 37 | 92\nM | 88 | 70 | 38 | 93\nL | 92 | 74 | 39 | 94\nXL | 96 | 78 | 40 | 95\n\n偏宽松版型，介于两码选大一码。单位：cm。',
                  },
                  {
                    id: 'ex-men',
                    name: '男装尺码表',
                    tip: '适合 T 恤、衬衫、外套等男装',
                    content:
                      '尺码 | 胸围 | 肩宽 | 衣长 | 建议身高\nM | 98 | 43 | 68 | 165-172\nL | 102 | 45 | 70 | 170-178\nXL | 106 | 47 | 72 | 175-182\nXXL | 110 | 49 | 74 | 180-188\n\n运动款略修身，喜欢宽松可大一码。',
                  },
                  {
                    id: 'ex-shoes',
                    name: '鞋子尺码表',
                    tip: '板鞋、运动鞋等按脚长选码',
                    content:
                      '欧码 | 脚长(cm) | 适合脚宽\n36 | 23.0 | 标准\n37 | 23.5 | 标准\n38 | 24.0 | 标准\n39 | 24.5 | 标准略宽\n40 | 25.0 | 标准略宽\n\n正码正拍；脚背偏高或脚宽建议大半码。',
                  },
                  {
                    id: 'ex-box',
                    name: '收纳箱规格',
                    tip: '非尺码类：规格参数 + 使用注意',
                    content:
                      '规格：外径约 150×150×高可选；铝合金框体，抗摔防潮。\n可叠放收纳，单层建议承重 ≤15kg。\n发货含说明书，细节以详情页实测图为准。',
                  },
                ]"
                ><button
                  type="button"
                  class="kb-ex-card"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  <strong data-v-5f3c24c3="">{{ item?.name }}</strong
                  ><em data-v-5f3c24c3="">{{ item?.tip }}</em
                  ><span data-v-5f3c24c3="">使用此示例</span>
                </button></template
              >
            </div>
          </div>
          <div class="kb-guide__acts" data-v-5f3c24c3="">
            <button
              class="btn btn--primary"
              type="button"
              @click="__stub('此操作')"
              data-v-5f3c24c3=""
            >
              + 空白新建
            </button>
          </div>
        </div></template
      >
    </div>
    <Teleport to="body" data-v-5f3c24c3=""
      ><template v-if="isTemplatePreviewDetail && name"
        ><div class="shop-manage kb-bind-overlay" @click="__stub('此操作')" data-v-5f3c24c3="">
          <div
            class="kb-bind-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kbBindDlgTitle"
            data-v-5f3c24c3=""
          >
            <div class="kb-bind-dialog__hd" data-v-5f3c24c3="">
              <div data-v-5f3c24c3="">
                <strong id="kbBindDlgTitle" data-v-5f3c24c3=""></strong>
                <p data-v-5f3c24c3="">
                  已绑 <b data-v-5f3c24c3="">{{ lengthPreview?.length }}</b> 店 /
                  <b data-v-5f3c24c3="">{{
                    Number(name?.bindGoodsCount ?? (name?.goodsIds || [])?.length) || 0
                  }}</b>
                  商品 · 未绑
                  <b data-v-5f3c24c3="">{{ lengthPreviewDetail?.length }}</b>
                  店。灰色商品已被其他规则占用。
                </p>
              </div>
              <div class="kb-bind-dialog__hd-acts" data-v-5f3c24c3="">
                <template v-if="isTemplatePreview"
                  ><span class="tag uncfg" data-v-5f3c24c3="">未保存</span></template
                ><button
                  class="btn btn--ghost btn--sm"
                  type="button"
                  title="关闭"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  关闭
                </button>
              </div>
            </div>
            <div class="kb-bind-dialog__toolbar" data-v-5f3c24c3="">
              <div class="kb-bind-scope" data-v-5f3c24c3="">
                <button
                  type="button"
                  :class="{ 'is-on': buttonPreview === 'all' }"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  全部</button
                ><button
                  type="button"
                  :class="{ 'is-on': buttonPreview === 'bound' }"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  已绑定</button
                ><button
                  type="button"
                  :class="{ 'is-on': buttonPreview === 'unbound' }"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  未绑定
                </button>
              </div>
              <label class="search kb-search" data-v-5f3c24c3=""
                ><span data-v-5f3c24c3="">⌕</span
                ><input
                  v-show="isInput"
                  @update:modelValue="__stub('此操作')"
                  type="search"
                  placeholder="搜索店铺名称"
                  @input="__stub('此操作')"
                  data-v-5f3c24c3="" /></label
              ><label class="search kb-search" data-v-5f3c24c3=""
                ><span data-v-5f3c24c3="">⌕</span
                ><input
                  v-show="isInputPreview"
                  @update:modelValue="__stub('此操作')"
                  type="search"
                  placeholder="商品ID / 名称"
                  @input="__stub('此操作')"
                  data-v-5f3c24c3="" /></label
              ><label class="search kb-search" data-v-5f3c24c3=""
                ><span data-v-5f3c24c3="">⌕</span
                ><input
                  v-show="isInputPreviewDetail"
                  @update:modelValue="__stub('此操作')"
                  type="search"
                  placeholder="商品编码"
                  @input="__stub('此操作')"
                  data-v-5f3c24c3="" /></label
              ><template v-if="isTemplatePreviewDetailDetail || isTemplatePreviewDetailDetailDetail"
                ><button
                  class="btn btn--ghost btn--sm"
                  type="button"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  重置
                </button></template
              >
            </div>
            <div v-show="kbBindDialog__body" class="kb-bind-dialog__body" data-v-5f3c24c3="">
              <div class="kb-bind-pane" data-v-5f3c24c3="">
                <div class="kb-bind-pane__hd" data-v-5f3c24c3="">
                  <strong data-v-5f3c24c3="">店铺</strong><em data-v-5f3c24c3=""></em>
                </div>
                <div class="kb-bind-list kb-bind-list--pane" data-v-5f3c24c3="">
                  <button
                    type="button"
                    :class="['kb-bind-item kb-bind-item--shop', { 'is-current': isButton }]"
                    @click="__stub('此操作')"
                    data-v-5f3c24c3=""
                  >
                    <span class="kb-bind-item__meta" data-v-5f3c24c3=""
                      ><strong data-v-5f3c24c3="">全部店铺</strong
                      ><em data-v-5f3c24c3="">跨店一起勾选商品</em></span
                    ></button
                  ><template :key="entryIndex" v-for="(item, entryIndex) in emptyPreviewRowsA"
                    ><button
                      type="button"
                      :class="[
                        'kb-bind-item kb-bind-item--shop',
                        {
                          'is-on': Number(item?.bindGoodsCount || 0) > 0,
                          'is-current': String(buttonPreviewDetail) === String(item?.storeId),
                          'kb-bind-item--off': Number(item?.bindGoodsCount || 0) <= 0,
                        },
                      ]"
                      @click="__stub('此操作')"
                      data-v-5f3c24c3=""
                    >
                      <img class="plat-ico" data-v-5f3c24c3="" /><span
                        class="kb-bind-item__meta"
                        data-v-5f3c24c3=""
                        ><strong data-v-5f3c24c3="">{{ item?.name }}</strong
                        ><em data-v-5f3c24c3=""></em></span
                      ><span
                        :class="[
                          'kb-bind-pill',
                          Number(item?.bindGoodsCount || 0) > 0 ? 'is-on' : 'is-off',
                        ]"
                        data-v-5f3c24c3=""
                        >{{
                          Number(item?.bindGoodsCount || 0) > 0
                            ? `已绑 ${Number(item?.bindGoodsCount || 0)}`
                            : '未绑'
                        }}</span
                      >
                    </button></template
                  >
                  <div class="kb-empty" data-v-5f3c24c3="">
                    {{
                      isTemplatePreviewDetailDetailDetail
                        ? '没有匹配的店铺'
                        : buttonPreview === 'bound'
                          ? '还没有已绑定的店铺'
                          : buttonPreview === 'unbound'
                            ? '没有未绑定店铺'
                            : '没有可绑定店铺'
                    }}
                  </div>
                </div>
              </div>
              <div class="kb-bind-pane" data-v-5f3c24c3="">
                <div class="kb-bind-pane__hd" data-v-5f3c24c3="">
                  <strong data-v-5f3c24c3="">{{ isButton ? '全部店铺商品' : '本店商品' }}</strong
                  ><em data-v-5f3c24c3=""></em>
                </div>
                <div class="kb-bind-list kb-bind-list--pane kb-bind-list--goods" data-v-5f3c24c3="">
                  <template v-if="lengthPreviewDetailDetail?.length"
                    ><template v-if="lengthPreviewDetailDetailDetail?.length"
                      ><template v-if="templateItems?.length"
                        ><template :key="entryIndex" v-for="(item, entryIndex) in templateItems"
                          ><label
                            :class="[
                              'kb-bind-item kb-bind-item--goods',
                              { 'is-on': '', 'is-locked': item?.disabled && true },
                            ]"
                            title=""
                            data-v-5f3c24c3=""
                            ><input
                              type="checkbox"
                              :checked="false"
                              :disabled="!!item?.disabled && true"
                              @change="__stub('此操作')"
                              data-v-5f3c24c3=""
                            /><template v-if="isButton"
                              ><img class="plat-ico" data-v-5f3c24c3="" /></template
                            ><span class="kb-bind-item__meta" data-v-5f3c24c3=""
                              ><strong data-v-5f3c24c3="">{{ item?.name }}</strong
                              ><em data-v-5f3c24c3=""
                                ><template v-if="isButton && item?.storeName">{{
                                  item?.storeName + ' · '
                                }}</template
                                >{{
                                  ' ' +
                                  item?.goodsId +
                                  (item?.outGoodsSn ? ` · ${item?.outGoodsSn}` : '')
                                }}</em
                              ><template v-if="item?.disabled && true"
                                ><i class="kb-bound-tip" data-v-5f3c24c3=""></i></template></span
                            ><span
                              :class="['kb-bind-pill', item?.disabled ? 'is-lock' : 'is-off']"
                              data-v-5f3c24c3=""
                              >{{ item?.disabled ? '他规则' : '未绑' }}</span
                            ></label
                          ></template
                        ></template
                      ><template v-else
                        ><div class="kb-empty" data-v-5f3c24c3="">
                          {{
                            buttonPreview === 'bound'
                              ? '当前范围没有已绑定商品'
                              : '当前范围没有未绑定商品'
                          }}
                        </div></template
                      ></template
                    ><template v-else
                      ><div class="kb-empty" data-v-5f3c24c3="">
                        {{
                          isTemplatePreviewDetailDetail
                            ? '没有匹配的商品'
                            : isButton
                              ? '全部店铺暂无商品'
                              : '该店暂无商品'
                        }}
                      </div></template
                    ></template
                  ><template v-else
                    ><div class="kb-empty" data-v-5f3c24c3="">没有可绑定店铺</div></template
                  >
                </div>
              </div>
            </div>
            <div class="kb-bind-dialog__ft" data-v-5f3c24c3="">
              <p data-v-5f3c24c3="">
                左侧点店铺看商品；勾选后点「保存绑定」。商品名称/编码会筛所有店铺。
              </p>
              <div class="kb-bind-dialog__ft-acts" data-v-5f3c24c3="">
                <button
                  class="btn btn--soft"
                  type="button"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  刷新</button
                ><button
                  class="btn btn--ghost"
                  type="button"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  全选筛选结果</button
                ><button
                  class="btn btn--primary"
                  type="button"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  保存绑定
                </button>
              </div>
            </div>
          </div>
        </div></template
      ><template v-if="isTemplatePreviewDetailDetailDetailDetail"
        ><div class="kb-ex-overlay" @click="__stub('此操作')" data-v-5f3c24c3="">
          <div class="kb-ex-dialog" role="dialog" aria-modal="true" data-v-5f3c24c3="">
            <div class="kb-ex-dialog__hd" data-v-5f3c24c3="">
              <div data-v-5f3c24c3="">
                <strong data-v-5f3c24c3="">从示例添加规则</strong>
                <p data-v-5f3c24c3="">选一个模板创建后，再到「管理绑定」勾选多店多商品</p>
              </div>
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                @click="__stub('此操作')"
                data-v-5f3c24c3=""
              >
                关闭
              </button>
            </div>
            <div class="kb-guide__ex-grid" data-v-5f3c24c3="">
              <template
                :key="entryIndex"
                v-for="(item, entryIndex) in [
                  {
                    id: 'ex-women',
                    name: '女装尺码表',
                    tip: '适合连衣裙、上衣等女装，一表绑多店多款',
                    content:
                      '尺码 | 胸围 | 腰围 | 肩宽 | 衣长\nS | 84 | 66 | 37 | 92\nM | 88 | 70 | 38 | 93\nL | 92 | 74 | 39 | 94\nXL | 96 | 78 | 40 | 95\n\n偏宽松版型，介于两码选大一码。单位：cm。',
                  },
                  {
                    id: 'ex-men',
                    name: '男装尺码表',
                    tip: '适合 T 恤、衬衫、外套等男装',
                    content:
                      '尺码 | 胸围 | 肩宽 | 衣长 | 建议身高\nM | 98 | 43 | 68 | 165-172\nL | 102 | 45 | 70 | 170-178\nXL | 106 | 47 | 72 | 175-182\nXXL | 110 | 49 | 74 | 180-188\n\n运动款略修身，喜欢宽松可大一码。',
                  },
                  {
                    id: 'ex-shoes',
                    name: '鞋子尺码表',
                    tip: '板鞋、运动鞋等按脚长选码',
                    content:
                      '欧码 | 脚长(cm) | 适合脚宽\n36 | 23.0 | 标准\n37 | 23.5 | 标准\n38 | 24.0 | 标准\n39 | 24.5 | 标准略宽\n40 | 25.0 | 标准略宽\n\n正码正拍；脚背偏高或脚宽建议大半码。',
                  },
                  {
                    id: 'ex-box',
                    name: '收纳箱规格',
                    tip: '非尺码类：规格参数 + 使用注意',
                    content:
                      '规格：外径约 150×150×高可选；铝合金框体，抗摔防潮。\n可叠放收纳，单层建议承重 ≤15kg。\n发货含说明书，细节以详情页实测图为准。',
                  },
                ]"
                ><button
                  type="button"
                  class="kb-ex-card"
                  @click="__stub('此操作')"
                  data-v-5f3c24c3=""
                >
                  <strong data-v-5f3c24c3="">{{ item?.name }}</strong
                  ><em data-v-5f3c24c3="">{{ item?.tip }}</em
                  ><span data-v-5f3c24c3="">使用此示例</span>
                </button></template
              >
            </div>
          </div>
        </div></template
      ></Teleport
    >
  </section>
</template>
