<!-- ConsultPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import IconEditPen from '@/shared/icons/IconEditPen.vue'
import IconDelete from '@/shared/icons/IconDelete.vue'
import IconVideoPause from '@/shared/icons/IconVideoPause.vue'
import IconChatDotRound from '@/shared/icons/IconChatDotRound.vue'
import IconSetting from '@/shared/icons/IconSetting.vue'
import IconCirclePlus from '@/shared/icons/IconCirclePlus.vue'
import { ref, computed } from 'vue'
import { createConsultPanelDemo } from '@/modules/auxiliary/demo/ConsultPanel'
const demo = createConsultPanelDemo()
interface Props {
  live?: boolean
  hotkeysActive?: boolean
  switchNextLabel?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  live: false,
  hotkeysActive: false,
  switchNextLabel: false,
})
const __stub = notifyUnavailable
const div = ref(demo.div)
const toolChip = ref(demo.toolChip)
const input = ref(demo.input)
const isDisabled = ref(demo.isDisabled)
const templateItems = ref(demo.templateItems)
const li = ref(demo.li)
const isTemplate = ref(demo.isTemplate)
const isDiv = ref(demo.isDiv)
const red = computed(() => demo.red)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const title = computed(() => demo.title)
const rows = computed(() => demo.rows)
const goodsName = computed(() => demo.goodsName)
const placeholder = computed(() => demo.placeholder)
const titleSummary = computed(() => demo.titleSummary)
const templateItemsSummary = computed(() => demo.templateItemsSummary)
const isCorrectBubble = computed(() => demo.isCorrectBubble)
const isTemplateState = ref(demo.isTemplateState)
const rowsState = ref(demo.rowsState)
const savePackWarn = ref(demo.savePackWarn)
const select = ref(demo.select)
const button = ref(demo.button)
const inputState = ref(demo.inputState)
const isSaveField = ref(demo.isSaveField)
const saveSheetA = ref(demo.saveSheetA)
const saveSheetQ = ref(demo.saveSheetQ)
const rowsStateDetail = ref(demo.rowsStateDetail)
const saveKwChipItems = ref(demo.saveKwChipItems)
const saveKwInput = ref(demo.saveKwInput)
const isTemplateStateDetail = ref(demo.isTemplateStateDetail)
const isDisabledState = ref(demo.isDisabledState)
const isDisabledStateDetail = ref(demo.isDisabledStateDetail)
const templateItemsState = ref(demo.templateItemsState)
const isTemplateSummaryDetail = computed(() => demo.isTemplateSummaryDetail)
const isDisabledSummary = computed(() => demo.isDisabledSummary)
const saveSheet = computed(() => demo.saveSheet)
const isP = computed(() => demo.isP)
const isTemplateSummaryDetailDetail = computed(() => demo.isTemplateSummaryDetailDetail)
const buttonSummary = computed(() => demo.buttonSummary)
const src = ref(demo.src)
const alt = ref(demo.alt)
</script>

<template>
  <div :class="['consult-panel', { 'is-correcting': div === 'replied' }]" data-v-708f5c4b="">
    <div class="msg-toolbar" data-v-708f5c4b="">
      <div class="msg-toolbar-row" data-v-708f5c4b="">
        <div class="status-tabs" data-v-708f5c4b="">
          <button
            type="button"
            :class="{ active: div === 'pending' }"
            @click="__stub('此操作')"
            data-v-708f5c4b=""
          >
            待回复 <b class="red" data-v-708f5c4b="">{{ red }}</b></button
          ><button
            type="button"
            :class="{ active: div === 'replied' }"
            @click="__stub('此操作')"
            data-v-708f5c4b=""
          >
            已回复 <b data-v-708f5c4b="">{{ isTemplateSummary }}</b>
          </button>
        </div>
        <div class="toolbar-actions" data-v-708f5c4b="">
          <template v-if="div !== 'replied'"
            ><button
              type="button"
              class="tool-chip"
              title="进入已回复，对 AI 回复纠错学习"
              @click="__stub('此操作')"
              data-v-708f5c4b=""
            >
              <el-icon data-v-708f5c4b=""
                ><component :is="IconEditPen" data-v-708f5c4b=""></component></el-icon
              ><span data-v-708f5c4b="">纠错</span>
            </button></template
          ><template v-else-if="isTemplateSummary"
            ><button
              type="button"
              class="tool-chip is-muted is-danger"
              :disabled="isDisabled"
              title="一键清除已回复记录"
              @click="__stub('此操作')"
              data-v-708f5c4b=""
            >
              <el-icon data-v-708f5c4b=""
                ><component :is="IconDelete" data-v-708f5c4b=""></component></el-icon
              ><span data-v-708f5c4b="">{{ isDisabled ? '清除中' : '清除' }}</span>
            </button></template
          ><button
            type="button"
            class="tool-chip is-muted"
            :title="titleSummary"
            @click="__stub('此操作')"
            data-v-708f5c4b=""
          >
            {{ toolChip === 'latest' ? '最新优先' : '超时优先' }}
          </button>
        </div>
      </div>
    </div>
    <section class="msg-stream" data-v-708f5c4b="">
      <template :key="entryIndex" v-for="(item, entryIndex) in rows"
        ><article
          :class="['msg-card', { active: item?.['id'], 'is-timeout': item?.['timeout'] }]"
          @click="__stub('此操作')"
          data-v-708f5c4b=""
        >
          <img
            class="plat-avatar"
            :src="src?.[item?.['plat']]"
            :alt="alt?.[item?.['plat']]"
            data-v-708f5c4b=""
          />
          <div class="msg-body-info" data-v-708f5c4b="">
            <div class="row1" data-v-708f5c4b="">
              <div class="row1-main" data-v-708f5c4b="">
                <span class="name" data-v-708f5c4b="">{{ item?.['name'] }}</span
                ><template v-if="item?.['storeName']"
                  ><span class="shop" data-v-708f5c4b=""></span></template
                ><template v-if="item?.['timeout']"
                  ><span class="timeout-dot" title="已超时" data-v-708f5c4b=""></span
                ></template>
              </div>
              <div class="row1-meta" data-v-708f5c4b="">
                <template v-if="item?.['orderTag']"
                  ><span :class="['order-tag', item?.['orderTag']?.['tone']]" data-v-708f5c4b="">{{
                    item?.['orderTag']?.['text']
                  }}</span></template
                ><button
                  type="button"
                  :class="['pause-tag', item?.['paused'] ? 'is-paused' : 'is-normal']"
                  title="AI 接待中 · 点击暂停"
                  aria-label="AI 接待中，点击暂停"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  <template v-if="item?.['paused']"
                    ><el-icon data-v-708f5c4b=""
                      ><component
                        :is="IconVideoPause"
                        data-v-708f5c4b=""
                      ></component></el-icon></template
                  ><template v-else
                    ><svg
                      class="ai-glyph"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                      data-v-708f5c4b=""
                    >
                      <circle cx="8" cy="1.7" r="1.05" data-v-708f5c4b=""></circle>
                      <rect
                        x="7.35"
                        y="2.4"
                        width="1.3"
                        height="1.7"
                        rx="0.4"
                        data-v-708f5c4b=""
                      ></rect>
                      <path
                        fill-rule="evenodd"
                        d="M4.2 4.1h7.6A2.2 2.2 0 0 1 14 6.3v5.1A2.2 2.2 0 0 1 11.8 13.6H4.2A2.2 2.2 0 0 1 2 11.4V6.3A2.2 2.2 0 0 1 4.2 4.1zm1.7 3.35a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3zm4.2 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z"
                        data-v-708f5c4b=""
                      ></path></svg></template
                  ><em class="pause-text" data-v-708f5c4b="">{{
                    item?.['paused'] ? '暂停' : '接待'
                  }}</em>
                </button>
              </div>
            </div>
            <div class="preview" data-v-708f5c4b="">{{ item?.['preview'] }}</div>
          </div>
          <div class="msg-side" data-v-708f5c4b="">
            <div class="msg-side-top" data-v-708f5c4b="">
              <span class="time" data-v-708f5c4b="">{{ item?.['time'] }}</span
              ><template v-if="item?.['filter'] === 'pending'"
                ><button
                  type="button"
                  class="msg-dismiss"
                  title="标记为已回复"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  ×
                </button></template
              >
            </div>
            <template v-if="item?.['filter'] === 'pending' && item?.['unread']"
              ><span class="unread" data-v-708f5c4b="">{{ item?.['unread'] }}</span></template
            ><template v-else-if="item?.['filter'] === 'replied'"
              ><span class="ai-ok" data-v-708f5c4b="">✓</span></template
            >
          </div>
        </article></template
      >
      <div class="empty" data-v-708f5c4b="">
        <div class="empty-card" data-v-708f5c4b="">
          <div
            :class="['empty-icon', { soft: div === 'replied' }]"
            aria-hidden="true"
            data-v-708f5c4b=""
          >
            <el-icon data-v-708f5c4b=""
              ><component :is="IconChatDotRound" data-v-708f5c4b=""></component
            ></el-icon>
          </div>
          <strong data-v-708f5c4b="">{{ title?.['title'] }}</strong>
          <p data-v-708f5c4b="">{{ title?.['tip'] }}</p>
        </div>
      </div>
    </section>
    <template v-if="div === 'replied'"
      ><section
        :class="['correct-pane', { idle: !goodsName }]"
        @click="__stub('此操作')"
        data-v-708f5c4b=""
      >
        <template v-if="goodsName"
          ><div class="correct-head" data-v-708f5c4b="">
            <strong data-v-708f5c4b="">{{ goodsName?.['name'] || '—' }}</strong
            ><template v-if="goodsName?.['storeName']"
              ><span class="shop" data-v-708f5c4b="">{{ goodsName?.['storeName'] }}</span></template
            >
          </div>
          <div class="correct-thread" data-v-708f5c4b="">
            <template v-if="templateItemsSummary?.['length']"
              ><template :key="index" v-for="(item, index) in templateItemsSummary"
                ><div
                  :class="['correct-pair', { 'is-focus': isDiv, 'is-corrected': false }]"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  <template v-if="item?.['buyer'] && item?.['showBuyer']"
                    ><div class="correct-bubble is-buyer" data-v-708f5c4b="">
                      <em data-v-708f5c4b="">{{
                        item?.['buyerIndex'] === isCorrectBubble ? '最新' : '顾客'
                      }}</em>
                      <p data-v-708f5c4b="">{{ item?.['buyer']?.['text'] }}</p>
                    </div></template
                  ><template v-if="item?.['ai']"
                    ><div
                      :class="[
                        'correct-bubble is-staff',
                        [
                          item?.['ai']?.['role'] === 'human' ? 'is-human' : 'is-ai',
                          { 'is-saved': false },
                        ],
                      ]"
                      data-v-708f5c4b=""
                    >
                      <em data-v-708f5c4b="">{{
                        item?.['ai']?.['role'] === 'human' ? '人工' : 'AI'
                      }}</em>
                      <p data-v-708f5c4b="">{{ item?.['ai']?.['text'] }}</p>
                      <template v-if="true"
                        ><button
                          type="button"
                          class="correct-saved-badge"
                          title="打开意图问法，查看已保存的意图"
                          @click="__stub('此操作')"
                          data-v-708f5c4b=""
                        >
                          <span class="correct-saved-title" data-v-708f5c4b="">已纠错</span
                          ><template v-if="true"
                            ><span class="correct-saved-pack" data-v-708f5c4b=""></span
                          ></template></button></template
                      ><template v-else
                        ><button
                          type="button"
                          class="correct-btn"
                          title="纠错这句回复"
                          @click="__stub('此操作')"
                          data-v-708f5c4b=""
                        >
                          纠错
                        </button></template
                      >
                    </div></template
                  >
                </div></template
              ></template
            ><template v-else
              ><div class="correct-bubble is-buyer" data-v-708f5c4b="">
                <em data-v-708f5c4b="">最新消息</em>
                <p data-v-708f5c4b="">暂无顾客消息</p>
              </div></template
            >
          </div></template
        ><template v-else
          ><p class="qs-idle-hint" data-v-708f5c4b="">选择会话后，点回复旁的「纠错」</p></template
        >
      </section></template
    >
    <section
      :class="['quick-send', { idle: !goodsName, 'with-correct': div === 'replied' }]"
      @click="__stub('此操作')"
      data-v-708f5c4b=""
    >
      <div class="qs-head" data-v-708f5c4b="">
        <div class="qs-target" data-v-708f5c4b="">
          <template v-if="goodsName"
            ><span class="qs-label" data-v-708f5c4b="">发给</span
            ><strong data-v-708f5c4b="">{{ goodsName?.['name'] || '—' }}</strong
            ><template v-if="goodsName?.['storeName']"
              ><span class="qs-shop" data-v-708f5c4b="">{{
                goodsName?.['storeName']
              }}</span></template
            ></template
          ><template v-else
            ><span class="qs-idle-hint" data-v-708f5c4b="">选择会话后回复</span></template
          >
        </div>
        <div class="qs-meta" data-v-708f5c4b="">
          <template v-if="goodsName"
            ><template v-if="goodsName?.['orderTag']"
              ><span :class="['order-tag', goodsName?.['orderTag']?.['tone']]" data-v-708f5c4b="">{{
                goodsName?.['orderTag']?.['text']
              }}</span></template
            ><button
              type="button"
              :class="['pause-tag', goodsName?.['paused'] ? 'is-paused' : 'is-normal']"
              title="AI 接待中 · 点击暂停"
              aria-label="AI 接待中，点击暂停"
              @click="__stub('此操作')"
              data-v-708f5c4b=""
            >
              <template v-if="goodsName?.['paused']"
                ><el-icon data-v-708f5c4b=""
                  ><component
                    :is="IconVideoPause"
                    data-v-708f5c4b=""
                  ></component></el-icon></template
              ><template v-else
                ><svg
                  class="ai-glyph"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                  data-v-708f5c4b=""
                >
                  <circle cx="8" cy="1.7" r="1.05" data-v-708f5c4b=""></circle>
                  <rect
                    x="7.35"
                    y="2.4"
                    width="1.3"
                    height="1.7"
                    rx="0.4"
                    data-v-708f5c4b=""
                  ></rect>
                  <path
                    fill-rule="evenodd"
                    d="M4.2 4.1h7.6A2.2 2.2 0 0 1 14 6.3v5.1A2.2 2.2 0 0 1 11.8 13.6H4.2A2.2 2.2 0 0 1 2 11.4V6.3A2.2 2.2 0 0 1 4.2 4.1zm1.7 3.35a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3zm4.2 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z"
                    data-v-708f5c4b=""
                  ></path></svg></template
              ><em class="pause-text" data-v-708f5c4b="">{{
                goodsName?.['paused'] ? '暂停' : '接待'
              }}</em>
            </button></template
          ><span
            class="qs-hotkey-tip"
            :title="'向下切换会话 · ' + props?.['switchNextLabel']"
            data-v-708f5c4b=""
            >{{ props?.['switchNextLabel'] }}</span
          ><button
            type="button"
            class="quick-setting"
            title="导入和管理快捷话术，也可设置发送偏好"
            @click="__stub('此操作')"
            data-v-708f5c4b=""
          >
            <el-icon data-v-708f5c4b=""
              ><component :is="IconSetting" data-v-708f5c4b=""></component></el-icon
            ><span data-v-708f5c4b="">快捷</span>
          </button>
        </div>
      </div>
      <div class="qs-compose" data-v-708f5c4b="">
        <div class="qs-input-wrap" data-v-708f5c4b="">
          <template v-if="isTemplate && templateItems?.['length']"
            ><ul class="script-candidates" data-v-708f5c4b="">
              <template :key="index" v-for="(item, index) in templateItems"
                ><li
                  :class="['script-candidate', { active: index === li }]"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  <template v-if="item?.['categoryName']"
                    ><span class="script-cat" data-v-708f5c4b="">{{
                      item?.['categoryName']
                    }}</span></template
                  ><span class="script-text" data-v-708f5c4b="">{{ item?.['text'] }}</span>
                </li></template
              >
            </ul></template
          ><input
            v-show="input"
            @update:modelValue="__stub('此操作')"
            type="text"
            :disabled="!goodsName"
            :placeholder="placeholder"
            autocomplete="off"
            @keydown="__stub('此操作')"
            @blur="__stub('此操作')"
            data-v-708f5c4b=""
          />
        </div>
        <button
          type="button"
          class="send"
          :disabled="!goodsName"
          @click="__stub('此操作')"
          data-v-708f5c4b=""
        >
          发送
        </button>
      </div>
    </section>
    <template v-if="isTemplateState"
      ><div class="save-mask" @click="__stub('此操作')" data-v-708f5c4b="">
        <div class="save-sheet" @click="__stub('此操作')" data-v-708f5c4b="">
          <div class="save-sheet-hd" data-v-708f5c4b="">
            <strong data-v-708f5c4b="">{{ saveSheet }}</strong
            ><button
              type="button"
              class="save-sheet-x"
              aria-label="关闭"
              @click="__stub('此操作')"
              data-v-708f5c4b=""
            >
              ×
            </button>
          </div>
          <template v-if="isTemplateSummaryDetailDetail"
            ><div class="save-field save-buyer-pick" data-v-708f5c4b="">
              <span class="save-field-label" data-v-708f5c4b="">
                顾客原话 <i class="save-field-hint" data-v-708f5c4b="">选一句，或合并成完整问题</i
                ><button
                  type="button"
                  :class="['save-buyer-merge', { active: buttonSummary }]"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  合并以上
                </button></span
              >
              <div class="save-buyer-opts" data-v-708f5c4b="">
                <template :key="index" v-for="(item, index) in rowsStateDetail"
                  ><button
                    type="button"
                    :class="['save-buyer-opt', { active: false }]"
                    :title="item?.['text']"
                    @click="__stub('此操作')"
                    data-v-708f5c4b=""
                  >
                    <em data-v-708f5c4b="">{{
                      index === rowsStateDetail?.['length'] - 1 ? '最新' : '顾客'
                    }}</em
                    ><span data-v-708f5c4b="">{{ item?.['text'] }}</span>
                  </button></template
                >
              </div>
            </div></template
          ><label class="save-field save-q-field" data-v-708f5c4b=""
            ><span class="save-field-label" data-v-708f5c4b="">
              意图名称 <i class="save-field-hint" data-v-708f5c4b="">可修改</i></span
            ><textarea
              v-show="saveSheetQ"
              @update:modelValue="__stub('此操作')"
              class="save-sheet-q"
              rows="2"
              maxlength="120"
              placeholder="简短好认，如「尺码咨询」"
              @change="__stub('此操作')"
              data-v-708f5c4b=""
            ></textarea>
          </label>
          <div class="save-field" data-v-708f5c4b="">
            <span class="save-field-label" data-v-708f5c4b="">
              触发问法 <em data-v-708f5c4b=""></em
              ><i class="save-field-hint" data-v-708f5c4b="">顾客常这样问</i></span
            >
            <div class="save-kw-box" data-v-708f5c4b="">
              <template :key="index" v-for="(item, index) in saveKwChipItems"
                ><span class="save-kw-chip" data-v-708f5c4b=""
                  >{{ item + ' '
                  }}<button type="button" title="删除" @click="__stub('此操作')" data-v-708f5c4b="">
                    ×
                  </button></span
                ></template
              ><span class="save-kw-compose" data-v-708f5c4b=""
                ><input
                  v-show="saveKwInput"
                  @update:modelValue="__stub('此操作')"
                  class="save-kw-input"
                  maxlength="16"
                  placeholder="输入后回车或点加号添加"
                  @keydown="__stub('此操作')"
                  data-v-708f5c4b="" /><button
                  type="button"
                  class="save-kw-add"
                  title="添加问法"
                  :disabled="saveKwChipItems?.['length'] >= 10"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  <el-icon data-v-708f5c4b=""
                    ><component :is="IconCirclePlus" data-v-708f5c4b=""></component
                  ></el-icon></button
              ></span>
            </div>
            <button
              type="button"
              class="save-kw-expand"
              :disabled="isDisabledState || saveKwChipItems?.['length'] >= 10"
              @click="__stub('此操作')"
              data-v-708f5c4b=""
            >
              {{ isDisabledState ? '生成中…' : '生成更多问法' }}
            </button>
          </div>
          <label class="save-field save-a-field" data-v-708f5c4b=""
            ><span class="save-field-label" data-v-708f5c4b="">
              纠正后的话术 <i class="save-field-hint" data-v-708f5c4b="">正确回复</i></span
            ><textarea
              v-show="saveSheetA"
              @update:modelValue="__stub('此操作')"
              class="save-sheet-a"
              rows="4"
              maxlength="500"
              placeholder="【当用户咨询意图名称时】
填写正确回复"
              data-v-708f5c4b=""
            ></textarea>
          </label>
          <div class="save-field" data-v-708f5c4b="">
            <span class="save-field-label" data-v-708f5c4b="">
              意图包
              <template v-if="!isTemplateSummaryDetail && !isTemplateStateDetail"
                ><i class="save-field-hint" data-v-708f5c4b="">在意图问法中管理</i></template
              ></span
            ><template v-if="isTemplateStateDetail"
              ><div class="save-pack-loading" data-v-708f5c4b="">意图包加载中…</div></template
            ><template v-else-if="isTemplateSummaryDetail"
              ><div class="save-pack-warn" data-v-708f5c4b="">
                <div class="save-pack-warn-main" data-v-708f5c4b="">
                  <strong data-v-708f5c4b="">{{
                    savePackWarn || '当前店铺未绑定意图包，纠错无法保存'
                  }}</strong
                  ><span data-v-708f5c4b="">去「意图问法」创建并绑定</span>
                </div>
                <button
                  type="button"
                  class="save-pack-bind"
                  @click="__stub('此操作')"
                  data-v-708f5c4b=""
                >
                  去绑定
                </button>
              </div></template
            ><template v-else
              ><select v-show="select" @update:modelValue="__stub('此操作')" data-v-708f5c4b="">
                <template :key="entryIndex" v-for="(item, entryIndex) in rowsState"
                  ><option :value="item?.['id']" data-v-708f5c4b="">
                    {{ item?.['name'] }}
                  </option></template
                >
              </select></template
            >
          </div>
          <div class="save-field" data-v-708f5c4b="">
            <span class="save-field-label" data-v-708f5c4b="">问题类型</span>
            <div class="save-scope" data-v-708f5c4b="">
              <button
                type="button"
                :class="{ active: button === 'general' }"
                @click="__stub('此操作')"
                data-v-708f5c4b=""
              >
                通用问题</button
              ><button
                type="button"
                :class="{ active: button === 'goods' }"
                @click="__stub('此操作')"
                data-v-708f5c4b=""
              >
                商品问题
              </button>
            </div>
          </div>
          <template v-if="button === 'goods'"
            ><label class="save-field" data-v-708f5c4b=""
              ><span class="save-field-label" data-v-708f5c4b="">
                商品模糊词或商品 ID
                <i class="save-field-hint" data-v-708f5c4b="">{{
                  isSaveField ? '正在获取当前咨询商品' : '可自行修改或填商品关键词'
                }}</i></span
              ><input
                v-show="inputState"
                @update:modelValue="__stub('此操作')"
                type="text"
                maxlength="80"
                placeholder="模糊词或商品 ID，填一个即可"
                data-v-708f5c4b="" /></label></template
          ><template v-if="button === 'goods'"
            ><div class="save-field" data-v-708f5c4b="">
              <span class="save-field-label" data-v-708f5c4b="">
                商品名称 <i class="save-field-hint" data-v-708f5c4b="">当前咨询商品</i></span
              >
              <p :class="['save-goods-name', { empty: !isP }]" :title="isP" data-v-708f5c4b="">
                {{ isP || (isSaveField ? '正在获取当前咨询商品…' : '未获取到商品名称') }}
              </p>
            </div></template
          >
          <div class="save-field" data-v-708f5c4b="">
            <span data-v-708f5c4b="">图片 / 视频 <em data-v-708f5c4b=""></em></span
            ><template v-if="templateItemsState?.['length']"
              ><div class="save-media-list" data-v-708f5c4b="">
                <template :key="index" v-for="(item, index) in templateItemsState"
                  ><div class="save-media-item" data-v-708f5c4b="">
                    <template v-if="item?.['type'] === 'video' && item?.['url']"
                      ><video
                        :src="item?.['url']"
                        muted
                        preload="metadata"
                        data-v-708f5c4b=""
                      ></video></template
                    ><template v-else-if="item?.['url']"
                      ><img :src="item?.['url']" alt="" data-v-708f5c4b="" /></template
                    ><template v-else
                      ><span data-v-708f5c4b="">{{
                        item?.['type'] === 'video' ? '视频' : '图片'
                      }}</span></template
                    ><button
                      type="button"
                      class="save-media-del"
                      title="移除"
                      @click="__stub('此操作')"
                      data-v-708f5c4b=""
                    >
                      ×
                    </button>
                  </div></template
                >
              </div></template
            >
            <div class="save-media-acts" data-v-708f5c4b="">
              <button
                type="button"
                :disabled="templateItemsState?.['length'] >= 4"
                @click="__stub('此操作')"
                data-v-708f5c4b=""
              >
                + 图片</button
              ><button
                type="button"
                :disabled="templateItemsState?.['length'] >= 4"
                @click="__stub('此操作')"
                data-v-708f5c4b=""
              >
                + 视频
              </button>
            </div>
            <input
              type="file"
              accept="image/*"
              hidden=""
              multiple
              @change="__stub('此操作')"
              data-v-708f5c4b=""
            /><input
              type="file"
              accept="video/*"
              hidden=""
              multiple
              @change="__stub('此操作')"
              data-v-708f5c4b=""
            />
          </div>
          <div class="save-sheet-actions" data-v-708f5c4b="">
            <button
              type="button"
              class="save-cancel"
              :disabled="isDisabledStateDetail"
              @click="__stub('此操作')"
              data-v-708f5c4b=""
            >
              取消
            </button>
            <div class="save-confirm-wrap" data-v-708f5c4b="">
              <button
                type="button"
                class="send"
                :disabled="!isDisabledSummary"
                @click="__stub('此操作')"
                data-v-708f5c4b=""
              >
                {{ isDisabledStateDetail ? '提交中…' : '确认纠错' }}</button
              ><template v-if="isTemplateSummaryDetail"
                ><em class="save-confirm-tip" data-v-708f5c4b="">请先绑定意图包</em></template
              >
            </div>
          </div>
        </div>
      </div></template
    >
  </div>
</template>
