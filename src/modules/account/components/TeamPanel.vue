<!-- TeamPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createTeamPanelDemo } from '@/modules/account/demo/TeamPanel'
const demo = createTeamPanelDemo()

const __stub = notifyUnavailable

const asset_Sn = ''
const tp = ref(demo.tp)
const template = ref(demo.template)
const teamName = ref(demo.teamName)
const inputValue = ref(demo.modelValue)
const modelValueState = ref(demo.modelValueState)
const label = ref(demo.label)
const isFooter = ref(demo.isFooter)
const isLoading = ref(demo.isLoading)
const templateItems = ref(demo.templateItems)
const isModelValue = ref(demo.isModelValue)
const input = ref(demo.input)
const isLoadingState = ref(demo.isLoadingState)
const mobile = ref(demo.mobile)
const isLoadingStateDetail = ref(demo.isLoadingStateDetail)
const disabled = ref(demo.disabled)
const displayText = computed(() => demo.displayText)
const isTemplate = computed(() => demo.isTemplate)
const tpSeat__label = computed(() => demo.tpSeat__label)
const isDisabled = computed(() => demo.isDisabled)
const rows = computed(() => demo.rows)
const mobileSummary = computed(() => demo.mobileSummary)
const isSpan = computed(() => demo.isSpan)
const tpOwnerRowItems = computed(() => demo.tpOwnerRowItems)
const displayTextSummary = computed(() => demo.displayTextSummary)
const style = computed(() => demo.style)
const isSection = computed(() => demo.isSection)
const button = ref(demo.button)
const buttonState = ref(demo.buttonState)
const templateItemsSummary = computed(() => demo.templateItemsSummary)
const templateItemsSummaryDetail = computed(() => demo.templateItemsSummaryDetail)
const isModelValueSummary = computed(() => demo.isModelValueSummary)
const isTemplateSummary = computed(() => demo.isTemplateSummary)
const tpSeat__track = computed(() => demo.tpSeat__track)
</script>

<template>
  <div v-show="tp" class="tp" data-v-2b4c59f2="">
    <header class="tp-head" data-v-2b4c59f2="">
      <div class="tp-head__text" data-v-2b4c59f2="">
        <h1 data-v-2b4c59f2="">团队成员</h1>
        <p data-v-2b4c59f2="">
          主账号拥有全部权限；子账号占用协作席位，可分配可见店铺并按模块开关权限。
        </p>
      </div>
      <template v-if="teamName && !isTemplate"
        ><el-button
          type="primary"
          class="tp-add-btn"
          :disabled="isDisabled"
          @click="__stub('此操作')"
          data-v-2b4c59f2=""
          >{{ isDisabled ? '席位已满' : '+ 添加子账号' }}</el-button
        ></template
      >
    </header>
    <template v-if="template"
      ><div class="tp-card tp-notice" data-v-2b4c59f2="">
        <el-empty :description="template" data-v-2b4c59f2=""
          ><el-button type="primary" @click="__stub('此操作')" data-v-2b4c59f2=""
            >重新加载</el-button
          ></el-empty
        >
      </div></template
    ><template v-else-if="isTemplate"
      ><div class="tp-card tp-notice" data-v-2b4c59f2="">
        <el-result icon="info" title="当前为子账号" data-v-2b4c59f2=""
          ><template #sub-title
            >{{
              ' 你已加入「' +
              teamName?.teamName +
              '」，团队由主账号 ' +
              teamName?.ownerMobile +
              ' 管理。'
            }}<br data-v-2b4c59f2="" />
            如需调整权限或退出团队，请联系主账号。
          </template></el-result
        >
      </div></template
    ><template v-else-if="teamName"
      ><section
        :class="['tp-seat', { 'is-over': isSection, 'is-full': !isSection && isDisabled }]"
        data-v-2b4c59f2=""
      >
        <div class="tp-seat__main" data-v-2b4c59f2="">
          <span class="tp-seat__label" data-v-2b4c59f2="">协作席位</span>
          <div class="tp-seat__num" data-v-2b4c59f2="">
            <strong data-v-2b4c59f2="">{{ tpSeat__label }}</strong
            ><span data-v-2b4c59f2=""></span>
          </div>
        </div>
        <div class="tp-seat__bar" data-v-2b4c59f2="">
          <div class="tp-seat__track" data-v-2b4c59f2="">
            <i :style="{ width: `${isSection ? 100 : style}%` }" data-v-2b4c59f2=""></i>
          </div>
          <p data-v-2b4c59f2="">{{ tpSeat__track }}</p>
        </div>
        <button type="button" class="tp-seat__buy" @click="__stub('此操作')" data-v-2b4c59f2="">
          加购席位
        </button>
      </section>
      <div class="tp-layout" data-v-2b4c59f2="">
        <aside class="tp-card tp-list" data-v-2b4c59f2="">
          <div class="tp-list__search" data-v-2b4c59f2="">
            <el-input
              :model-value="inputValue"
              @update:modelValue="__stub('此操作')"
              clearable=""
              placeholder="搜索手机号或备注名"
              data-v-2b4c59f2=""
              ><template #prefix
                ><svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  data-v-2b4c59f2=""
                >
                  <circle cx="11" cy="11" r="7" data-v-2b4c59f2=""></circle>
                  <path
                    d="m20 20-3.5-3.5"
                    stroke-linecap="round"
                    data-v-2b4c59f2=""
                  ></path></svg></template
            ></el-input>
          </div>
          <div class="tp-list__body" data-v-2b4c59f2="">
            <template :key="entryIndex" v-for="(item, entryIndex) in rows"
              ><button
                type="button"
                :class="['tp-member', { 'is-on': item?.userId }]"
                @click="__stub('此操作')"
                data-v-2b4c59f2=""
              >
                <span class="tp-avatar" data-v-2b4c59f2=""></span
                ><span class="tp-member__info" data-v-2b4c59f2=""
                  ><span class="tp-member__name" data-v-2b4c59f2=""></span
                  ><span class="tp-member__phone" data-v-2b4c59f2=""></span></span
                ><span
                  :class="['tp-badge', item?.role === 'owner' ? 'is-owner' : 'is-sub']"
                  data-v-2b4c59f2=""
                  >{{ item?.role === 'owner' ? '管理员' : '子账号' }}</span
                >
              </button></template
            ><el-empty image-size="72" description="暂无子账号" data-v-2b4c59f2=""></el-empty>
          </div>
        </aside>
        <section class="tp-card tp-detail" data-v-2b4c59f2="">
          <template v-if="mobileSummary"
            ><div class="tp-profile" data-v-2b4c59f2="">
              <span class="tp-avatar tp-avatar--lg" data-v-2b4c59f2=""></span>
              <div class="tp-profile__info" data-v-2b4c59f2="">
                <div class="tp-profile__name" data-v-2b4c59f2="">
                  {{ ' '
                  }}<span
                    :class="['tp-badge', isSpan ? 'is-owner' : 'is-sub']"
                    data-v-2b4c59f2=""
                    >{{ isSpan ? '管理员' : '子账号' }}</span
                  >
                </div>
                <div class="tp-profile__meta" data-v-2b4c59f2="">
                  {{ ' 登录手机号 ' + '' + ' '
                  }}<template v-if="mobileSummary?.joinTime">{{ ' · 加入于 ' }}</template>
                </div>
              </div>
              <div class="tp-profile__nick" data-v-2b4c59f2="">
                <label data-v-2b4c59f2="">备注名</label
                ><el-input
                  :model-value="modelValueState"
                  @update:modelValue="__stub('此操作')"
                  maxlength="50"
                  placeholder="如：售前小云"
                  @input="__stub('此操作')"
                  data-v-2b4c59f2=""
                ></el-input>
              </div>
            </div>
            <nav class="tp-tabs" data-v-2b4c59f2="">
              <button
                type="button"
                :class="{ 'is-on': button === 'perm' }"
                @click="__stub('此操作')"
                data-v-2b4c59f2=""
              >
                功能权限
                <em data-v-2b4c59f2="">{{
                  isSpan ? '全部' : `${displayTextSummary}/${asset_Sn?.length}`
                }}</em></button
              ><button
                type="button"
                :class="{ 'is-on': button === 'store' }"
                @click="__stub('此操作')"
                data-v-2b4c59f2=""
              >
                负责店铺
                <em data-v-2b4c59f2="">{{
                  isSpan || isModelValue ? '全部' : `${isTemplateSummary}/${templateItems?.length}`
                }}</em>
              </button>
            </nav>
            <template v-if="button === 'store'"
              ><div class="tp-store-tip" data-v-2b4c59f2="">
                {{
                  isSpan
                    ? '主账号负责名下全部店铺。'
                    : '设置该子账号负责哪些店铺：只能登录、接待被分配的店铺，未分配的店铺在他的工作台中不显示。'
                }}
              </div>
              <div class="tp-store-all" @click="__stub('此操作')" data-v-2b4c59f2="">
                <div class="tp-store-all__text" data-v-2b4c59f2="">
                  <strong data-v-2b4c59f2="">负责全部店铺</strong><small data-v-2b4c59f2=""></small>
                </div>
                <el-switch
                  :model-value="isModelValue"
                  class="tp-row__check"
                  data-v-2b4c59f2=""
                ></el-switch>
              </div>
              <template v-if="isSpan || !isModelValue"
                ><div class="tp-stores" data-v-2b4c59f2="">
                  <template v-if="isSpan"
                    ><div class="tp-stores__all" data-v-2b4c59f2="">
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        data-v-2b4c59f2=""
                      >
                        <path
                          d="M4 10h16l-1.5-5h-13L4 10Z"
                          stroke-linejoin="round"
                          data-v-2b4c59f2=""
                        ></path>
                        <path
                          d="M5 10v9h14v-9M9 19v-5h6v5"
                          stroke-linejoin="round"
                          data-v-2b4c59f2=""
                        ></path></svg
                      ><span data-v-2b4c59f2=""></span></div></template
                  ><template v-else
                    ><div class="tp-stores__tools" data-v-2b4c59f2="">
                      <label class="tp-stores__search" data-v-2b4c59f2=""
                        ><svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          data-v-2b4c59f2=""
                        >
                          <circle cx="11" cy="11" r="7" data-v-2b4c59f2=""></circle>
                          <path
                            d="m20 20-3.5-3.5"
                            stroke-linecap="round"
                            data-v-2b4c59f2=""
                          ></path></svg
                        ><input
                          v-show="input"
                          @update:modelValue="__stub('此操作')"
                          type="text"
                          placeholder="搜索店铺名或平台"
                          data-v-2b4c59f2=""
                        /><template v-if="input"
                          ><button
                            type="button"
                            class="tp-stores__clear"
                            @click="__stub('此操作')"
                            data-v-2b4c59f2=""
                          >
                            ×
                          </button></template
                        ></label
                      ><template v-if="isTemplateSummary"
                        ><button
                          type="button"
                          class="tp-link"
                          @click="__stub('此操作')"
                          data-v-2b4c59f2=""
                        >
                          清空已选
                        </button></template
                      >
                    </div>
                    <template v-if="templateItemsSummary?.length > 1"
                      ><div class="tp-platforms" data-v-2b4c59f2="">
                        <button
                          type="button"
                          :class="['tp-platform', { 'is-on': !buttonState }]"
                          @click="__stub('此操作')"
                          data-v-2b4c59f2=""
                        >
                          全部<em data-v-2b4c59f2=""></em></button
                        ><template
                          :key="entryIndex"
                          v-for="(item, entryIndex) in templateItemsSummary"
                          ><button
                            type="button"
                            :class="['tp-platform', { 'is-on': buttonState === item?.type }]"
                            @click="__stub('此操作')"
                            data-v-2b4c59f2=""
                          >
                            {{ item?.type }}<em data-v-2b4c59f2=""></em></button
                        ></template></div></template
                    ><template v-if="templateItems?.length && !isTemplateSummary"
                      ><div class="tp-stores__warn" data-v-2b4c59f2="">
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          data-v-2b4c59f2=""
                        >
                          <path
                            d="M12 9v4M12 17h.01"
                            stroke-linecap="round"
                            data-v-2b4c59f2=""
                          ></path>
                          <path
                            d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                            data-v-2b4c59f2=""
                          ></path>
                        </svg>
                        尚未选择店铺，该子账号将无法登录主账号名下的任何店铺
                      </div></template
                    >
                    <div class="tp-stores__body" data-v-2b4c59f2="">
                      <template v-if="templateItems?.length"
                        ><template v-if="templateItemsSummaryDetail?.length"
                          ><div
                            class="tp-row tp-row--head"
                            @click="__stub('此操作')"
                            data-v-2b4c59f2=""
                          >
                            <el-checkbox
                              class="tp-row__check"
                              :model-value="
                                isModelValueSummary === templateItemsSummaryDetail?.length
                              "
                              :indeterminate="
                                isModelValueSummary > 0 &&
                                isModelValueSummary < templateItemsSummaryDetail?.length
                              "
                              data-v-2b4c59f2=""
                            ></el-checkbox
                            ><span class="tp-row__name" data-v-2b4c59f2="">{{
                              input || buttonState ? '全选当前结果' : '全选'
                            }}</span
                            ><span class="tp-row__meta" data-v-2b4c59f2=""></span>
                          </div>
                          <div class="tp-rows" data-v-2b4c59f2="">
                            <template
                              :key="entryIndex"
                              v-for="(item, entryIndex) in templateItemsSummaryDetail"
                              ><div
                                :class="['tp-row', { 'is-on': false }]"
                                :title="item?.name"
                                @click="__stub('此操作')"
                                data-v-2b4c59f2=""
                              >
                                <el-checkbox class="tp-row__check" data-v-2b4c59f2=""></el-checkbox
                                ><span class="tp-row__name" data-v-2b4c59f2="">{{
                                  item?.name
                                }}</span
                                ><span class="tp-row__tag" data-v-2b4c59f2=""
                                  ><i data-v-2b4c59f2=""></i>{{ item?.type || '其他平台' }}</span
                                >
                              </div></template
                            >
                          </div></template
                        ><template v-else
                          ><div class="tp-stores__empty" data-v-2b4c59f2="">
                            没有匹配的店铺
                          </div></template
                        ></template
                      ><template v-else
                        ><div class="tp-stores__empty" data-v-2b4c59f2="">
                          还没有店铺。主账号登录店铺后会出现在这里；子账号自己新登录的店铺会自动分配给他。
                        </div></template
                      >
                    </div></template
                  >
                </div></template
              ></template
            ><template v-else
              ><template v-if="isSpan"
                ><div class="tp-owner-tip" data-v-2b4c59f2="">
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    data-v-2b4c59f2=""
                  >
                    <path
                      d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"
                      stroke-linejoin="round"
                      data-v-2b4c59f2=""
                    ></path>
                    <path
                      d="m9 12 2 2 4-4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      data-v-2b4c59f2=""
                    ></path>
                  </svg>
                  主账号默认拥有全部功能权限，不可停用或删除。
                </div></template
              >
              <div class="tp-perm-bar" data-v-2b4c59f2="">
                <div class="tp-perm-bar__title" data-v-2b4c59f2="">
                  功能权限
                  <span data-v-2b4c59f2="">{{
                    isSpan ? '全部模块' : `已开启 ${displayTextSummary} / ${asset_Sn?.length}`
                  }}</span>
                </div>
                <div class="tp-seg" data-v-2b4c59f2="">
                  <button type="button" @click="__stub('此操作')" data-v-2b4c59f2="">
                    全部开启</button
                  ><button type="button" @click="__stub('此操作')" data-v-2b4c59f2="">
                    全部关闭
                  </button>
                </div>
              </div>
              <template v-if="isSpan"
                ><div class="tp-owner-perms" data-v-2b4c59f2="">
                  <template :key="entryIndex" v-for="(item, entryIndex) in tpOwnerRowItems"
                    ><div class="tp-owner-row" data-v-2b4c59f2="">
                      <span class="tp-owner-row__title" data-v-2b4c59f2="">{{ item?.title }}</span>
                      <div class="tp-chips" data-v-2b4c59f2="">
                        <template :key="entryIndex" v-for="(childItem, entryIndex) in item?.items"
                          ><span class="tp-chip" data-v-2b4c59f2=""
                            ><svg
                              viewBox="0 0 24 24"
                              width="12"
                              height="12"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="3"
                              data-v-2b4c59f2=""
                            >
                              <path
                                d="m5 12 5 5 9-10"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                data-v-2b4c59f2=""
                              ></path></svg
                            >{{ ' ' + childItem?.label }}</span
                          ></template
                        >
                      </div>
                    </div></template
                  >
                </div></template
              ><template v-else
                ><div class="tp-perm-scroll" data-v-2b4c59f2="">
                  <template :key="entryIndex" v-for="(item, entryIndex) in tpOwnerRowItems"
                    ><div class="tp-group" data-v-2b4c59f2="">
                      <div class="tp-group__head" data-v-2b4c59f2="">
                        <span class="tp-group__title" data-v-2b4c59f2="">{{ item?.title }}</span
                        ><span class="tp-group__count" data-v-2b4c59f2=""></span
                        ><button
                          type="button"
                          class="tp-group__toggle"
                          @click="__stub('此操作')"
                          data-v-2b4c59f2=""
                        >
                          {{ item?.items?.length ? '全开' : '全关' }}
                        </button>
                      </div>
                      <div class="tp-grid" data-v-2b4c59f2="">
                        <template :key="entryIndex" v-for="(childItem, entryIndex) in item?.items"
                          ><label
                            :class="['tp-perm', { 'is-off': !label?.[childItem?.key] }]"
                            data-v-2b4c59f2=""
                            ><span class="tp-perm__text" data-v-2b4c59f2=""
                              ><strong data-v-2b4c59f2="">{{ childItem?.label }}</strong
                              ><small data-v-2b4c59f2="">{{ childItem?.tip }}</small></span
                            ><el-switch
                              :model-value="label?.[childItem?.key]"
                              @update:modelValue="__stub('此操作')"
                              size="small"
                              @change="__stub('此操作')"
                              data-v-2b4c59f2=""
                            ></el-switch></label
                        ></template>
                      </div></div
                  ></template></div></template
            ></template>
            <footer :class="['tp-foot', { 'is-dirty': isFooter }]" data-v-2b4c59f2="">
              <el-button
                text=""
                type="danger"
                class="tp-del"
                @click="__stub('此操作')"
                data-v-2b4c59f2=""
                >删除账号</el-button
              >
              <div class="tp-foot__right" data-v-2b4c59f2="">
                <template v-if="isFooter"
                  ><span class="tp-foot__hint" data-v-2b4c59f2="">有未保存的修改</span></template
                ><el-button :disabled="!isFooter" @click="__stub('此操作')" data-v-2b4c59f2=""
                  >撤销</el-button
                ><el-button
                  type="primary"
                  :loading="isLoading"
                  :disabled="!isFooter"
                  @click="__stub('此操作')"
                  data-v-2b4c59f2=""
                >
                  保存修改
                </el-button>
              </div>
            </footer></template
          ><template v-else
            ><el-empty description="请选择左侧账号" data-v-2b4c59f2=""></el-empty
          ></template>
        </section></div></template
    ><el-dialog
      :model-value="false"
      @update:modelValue="__stub('此操作')"
      title="添加子账号"
      width="440px"
      append-to-body=""
      class="tp-dialog"
      data-v-2b4c59f2=""
      ><template #footer
        ><el-button @click="__stub('此操作')" data-v-2b4c59f2="">取消</el-button
        ><el-button
          type="primary"
          :loading="isLoadingState"
          @click="__stub('此操作')"
          data-v-2b4c59f2=""
          >添加</el-button
        ></template
      >
      <div class="tp-dialog__tip" data-v-2b4c59f2="">
        还可绑定
        <b data-v-2b4c59f2=""></b>
        个子账号。需向该手机号发送验证码确认；未注册的手机号在验证码正确后会自动建号（不赠送试用套餐）。
      </div>
      <el-form label-position="top" @submit="__stub('此操作')" data-v-2b4c59f2=""
        ><el-form-item label="子账号手机号" data-v-2b4c59f2=""
          ><el-input
            :model-value="mobile?.mobile"
            @update:modelValue="__stub('此操作')"
            maxlength="11"
            placeholder="请输入 11 位手机号"
            data-v-2b4c59f2=""
          ></el-input></el-form-item
        ><el-form-item label="短信验证码" data-v-2b4c59f2=""
          ><div class="tp-add-sms" data-v-2b4c59f2="">
            <el-input
              :model-value="mobile?.smsCode"
              @update:modelValue="__stub('此操作')"
              maxlength="8"
              placeholder="请输入验证码"
              data-v-2b4c59f2=""
            ></el-input
            ><el-button
              :loading="isLoadingStateDetail"
              :disabled="disabled > 0"
              @click="__stub('此操作')"
              data-v-2b4c59f2=""
              >{{ displayText }}</el-button
            >
          </div></el-form-item
        ><el-form-item label="备注名（选填）" data-v-2b4c59f2=""
          ><el-input
            :model-value="mobile?.nickname"
            @update:modelValue="__stub('此操作')"
            maxlength="50"
            placeholder="如：售前小云"
            data-v-2b4c59f2=""
          ></el-input></el-form-item></el-form
    ></el-dialog>
  </div>
</template>
