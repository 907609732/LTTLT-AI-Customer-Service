<!-- ShopsListPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createShopsListPanelDemo } from '@/modules/shops/demo/ShopsListPanel'
const demo = createShopsListPanelDemo()
interface Props {
  shops?: { length: number }
  loadError?: string
  loading?: boolean
  learnJobs?: string
  learnedCounts?: string
}
const props = withDefaults(defineProps<Props>(), {
  shops: () => ({ length: 0 }),
  loadError: '',
  loading: false,
  learnJobs: '',
  learnedCounts: '',
})
const __stub = notifyUnavailable

const select = ref(demo.select)
const selectState = ref(demo.selectState)
const input = ref(demo.input)
const button = ref(demo.button)
const listPager__size = ref(demo.listPager__size)
const rows = computed(() => demo.rows)
const displayText = computed(() => demo.displayText)
const displayTextSummary = computed(() => demo.displayTextSummary)
const panel__bar = computed(() => demo.panel__bar)
const rowsSummary = computed(() => demo.rowsSummary)
</script>

<template>
  <section id="viewList" class="view is-on shops-board" data-v-ffbd3484="">
    <div class="page-head" data-v-ffbd3484="">
      <div data-v-ffbd3484="">
        <h1 data-v-ffbd3484="">店铺与商品</h1>
        <p data-v-ffbd3484="">
          登录店铺 → 学习商品 → 配置接待。给店铺填分组后，意图和模型定制可以一次勾选整组。
        </p>
      </div>
      <div class="page-head__acts" data-v-ffbd3484="">
        <button class="btn btn--ghost" type="button" @click="__stub('此操作')" data-v-ffbd3484="">
          刷新
        </button>
      </div>
    </div>
    <div class="panel shops-panel" data-v-ffbd3484="">
      <div class="panel__bar shops-panel__bar" data-v-ffbd3484="">
        <div class="panel__title" data-v-ffbd3484="">
          店铺列表 <b data-v-ffbd3484="">{{ panel__bar?.length }}</b
          ><span class="shop-stat" role="group" aria-label="登录状态筛选" data-v-ffbd3484=""
            ><button
              type="button"
              :class="['shop-stat__btn shop-stat__on', { 'is-on': button === 'online' }]"
              @click="__stub('此操作')"
              data-v-ffbd3484=""
            >
              已登录 <b data-v-ffbd3484="">{{ displayText }}</b></button
            ><button
              type="button"
              :class="['shop-stat__btn shop-stat__off', { 'is-on': button === 'offline' }]"
              @click="__stub('此操作')"
              data-v-ffbd3484=""
            >
              未登录 <b data-v-ffbd3484="">{{ displayTextSummary }}</b>
            </button></span
          >
        </div>
        <div class="panel__tools" data-v-ffbd3484="">
          <select v-show="select" @update:modelValue="__stub('此操作')" data-v-ffbd3484="">
            &lt;option value="all" data-v-ffbd3484&gt;全部平台&lt;/option&gt;&lt;option value="pdd"
            data-v-ffbd3484&gt;拼多多&lt;/option&gt;&lt;option value="dy"
            data-v-ffbd3484&gt;抖店&lt;/option&gt;&lt;option value="tb"
            data-v-ffbd3484&gt;淘宝&lt;/option&gt;&lt;option value="jd"
            data-v-ffbd3484&gt;京东&lt;/option&gt;&lt;option value="ks"
            data-v-ffbd3484&gt;快手&lt;/option&gt;&lt;option value="wx"
            data-v-ffbd3484&gt;微信小店&lt;/option&gt;&lt;option value="xhs"
            data-v-ffbd3484&gt;小红书&lt;/option&gt;&lt;option value="dewu"
            data-v-ffbd3484&gt;得物&lt;/option&gt;</select
          ><select
            v-show="selectState"
            @update:modelValue="__stub('此操作')"
            title="按分组查看店铺"
            data-v-ffbd3484=""
          >
            <option value="all" data-v-ffbd3484="">全部分组</option>
            <option value="__none__" data-v-ffbd3484="">未分组</option>
            <template :key="entryIndex" v-for="(item, entryIndex) in rows"
              ><option :value="item?.name" data-v-ffbd3484=""></option
            ></template></select
          ><label class="search" data-v-ffbd3484=""
            ><span data-v-ffbd3484="">⌕</span
            ><input
              v-show="input"
              @update:modelValue="__stub('此操作')"
              type="search"
              placeholder="搜索店名、分组"
              data-v-ffbd3484=""
          /></label>
        </div>
      </div>
      <datalist id="shop-group-options" data-v-ffbd3484="">
        <template :key="entryIndex" v-for="(item, entryIndex) in rows"
          ><option :value="item?.name" data-v-ffbd3484=""></option
        ></template>
      </datalist>
      <div class="shops-list" data-v-ffbd3484="">
        <template :key="entryIndex" v-for="(item, entryIndex) in rowsSummary?.rows"
          ><article
            :class="['shop-card', { 'is-online': item?.online }]"
            :data-id="item?.id"
            data-v-ffbd3484=""
          >
            <div class="shop-card__lead" data-v-ffbd3484="">
              <div class="shop-card__main" data-v-ffbd3484="">
                <img class="shop-card__plat" :src="''" :alt="''" data-v-ffbd3484="" />
                <div class="shop-card__identity" data-v-ffbd3484="">
                  <div class="shop-card__name-row" data-v-ffbd3484="">
                    <strong data-v-ffbd3484="">{{ item?.name }}</strong
                    ><label class="shop-group" @click="__stub('此操作')" data-v-ffbd3484=""
                      ><input
                        :class="{ 'has-value': false }"
                        list="shop-group-options"
                        maxlength="20"
                        placeholder="分组"
                        aria-label="店铺分组"
                        title="分组保存在店铺资料里，跟当前账号走。意图问法和模型定制里可以一次勾选这一组"
                        @input="__stub('此操作')"
                        @blur="__stub('此操作')"
                        @keydown="__stub('此操作')"
                        data-v-ffbd3484=""
                    /></label>
                  </div>
                  <div class="shop-card__meta" data-v-ffbd3484="">
                    <span data-v-ffbd3484=""></span
                    ><span
                      :class="['shop-card__status', item?.online ? 'is-on' : 'is-off']"
                      data-v-ffbd3484=""
                      >{{ item?.online ? '已登录' : '未登录' }}</span
                    >
                  </div>
                </div>
              </div>
            </div>
            <div class="shop-card__col" @click="__stub('此操作')" data-v-ffbd3484="">
              <div class="shop-card__col-hd" data-v-ffbd3484="">
                <b data-v-ffbd3484="">接待配置</b
                ><em
                  title="按店设置转接人工、进店欢迎、自动操作与图片识别，也可同步他店"
                  data-v-ffbd3484=""
                >
                  按店设置接待
                </em>
              </div>
              <div class="shop-card__acts" data-v-ffbd3484="">
                <button type="button" class="chip" @click="__stub('此操作')" data-v-ffbd3484="">
                  转接人工</button
                ><button type="button" class="chip" @click="__stub('此操作')" data-v-ffbd3484="">
                  进店欢迎</button
                ><button type="button" class="chip" @click="__stub('此操作')" data-v-ffbd3484="">
                  自动操作</button
                ><button type="button" class="chip" @click="__stub('此操作')" data-v-ffbd3484="">
                  图片识别</button
                ><button
                  type="button"
                  class="chip chip--sync"
                  title="把本店配置同步到其他店铺"
                  @click="__stub('此操作')"
                  data-v-ffbd3484=""
                >
                  同步他店
                </button>
              </div>
            </div>
            <div
              :class="['shop-card__col', { 'is-learn-empty': false }]"
              @click="__stub('此操作')"
              data-v-ffbd3484=""
            >
              <div class="shop-card__col-hd" data-v-ffbd3484="">
                <b data-v-ffbd3484="">商品知识</b
                ><em title="学习卖点与规格，供 AI 答客" data-v-ffbd3484=""></em>
              </div>
              <div class="shop-card__acts" data-v-ffbd3484="">
                <button type="button" class="chip" @click="__stub('此操作')" data-v-ffbd3484="">
                  查看商品</button
                ><template v-if="true"
                  ><button
                    type="button"
                    class="chip chip--sync"
                    title="点击查看学习进度"
                    @click="__stub('此操作')"
                    data-v-ffbd3484=""
                  ></button></template
                ><template v-else
                  ><button
                    type="button"
                    :class="[
                      'chip',
                      [item?.online ? 'chip--sync' : 'chip--warn', 'is-learn-prompt'],
                    ]"
                    title="请先在接待端登录后再学习"
                    @click="__stub('此操作')"
                    data-v-ffbd3484=""
                  >
                    {{ item?.online ? '手动学习' : '请先登录' }}
                  </button></template
                >
              </div>
            </div>
            <button
              type="button"
              class="shop-card__del"
              title="删除店铺"
              @click="__stub('此操作')"
              data-v-ffbd3484=""
            >
              删除
            </button>
          </article></template
        ><template v-if="!rowsSummary?.rows?.length && !props?.loading"
          ><div
            :class="['shops-empty', { 'is-prompt': !props?.shops?.length && !props?.loadError }]"
            data-v-ffbd3484=""
          >
            <template v-if="props?.loadError">{{ props?.loadError }}</template
            ><template v-else-if="props?.shops?.length">没有符合筛选条件的店铺</template
            ><template v-else><b data-v-ffbd3484="">请先在主界面登录授权店铺</b></template>
          </div></template
        >
      </div>
      <div class="list-pager" data-v-ffbd3484="">
        <template v-if="rowsSummary?.total"
          ><div class="list-pager__left" data-v-ffbd3484="">
            <span class="list-pager__info" data-v-ffbd3484=""></span
            ><select
              v-show="listPager__size"
              @update:modelValue="__stub('此操作')"
              class="list-pager__size"
              title="每页展示数量"
              data-v-ffbd3484=""
            >
              <template :key="entryIndex" v-for="(item, entryIndex) in [5, 10, 20, 50]"
                ><option :value="item" data-v-ffbd3484=""></option
              ></template>
            </select>
          </div>
          <div class="list-pager__acts" data-v-ffbd3484="">
            <button
              type="button"
              class="pager-btn"
              :disabled="rowsSummary?.page <= 1"
              @click="__stub('此操作')"
              data-v-ffbd3484=""
            >
              上一页</button
            ><template :key="entryIndex" v-for="(item, entryIndex) in rowsSummary?.pages"
              ><button
                type="button"
                :class="['pager-btn', { 'is-on': item === rowsSummary?.page }]"
                @click="__stub('此操作')"
                data-v-ffbd3484=""
              >
                {{ item }}
              </button></template
            ><button
              type="button"
              class="pager-btn"
              :disabled="rowsSummary?.page >= rowsSummary?.pages"
              @click="__stub('此操作')"
              data-v-ffbd3484=""
            >
              下一页
            </button>
          </div></template
        ><template v-else
          ><span class="list-pager__info" data-v-ffbd3484="">暂无店铺</span></template
        >
      </div>
    </div>
  </section>
</template>
