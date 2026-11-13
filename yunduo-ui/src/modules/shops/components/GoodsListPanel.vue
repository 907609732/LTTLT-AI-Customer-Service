<!-- GoodsListPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import type { GoodsRow } from '../contracts'
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createGoodsListPanelDemo } from '@/modules/shops/demo/GoodsListPanel'
const demo = createGoodsListPanelDemo()
interface Props {
  shopName?: string
  loading?: boolean
  rows?: GoodsRow[]
  total?: number
  page?: number
  pageSize?: string
  nameQuery?: string
  codeQuery?: string
  allPageSelected?: boolean
  isSelected?: string
}
const props = withDefaults(defineProps<Props>(), {
  shopName: '',
  loading: false,
  rows: () => [],
  total: 0,
  page: 0,
  pageSize: '',
  nameQuery: '',
  codeQuery: '',
  allPageSelected: false,
  isSelected: '',
})
const __stub = notifyUnavailable

const disabled = computed(() => demo.disabled)
const listPager__left = computed(() => demo.listPager__left)
const listPager__leftSummary = computed(() => demo.listPager__leftSummary)
const pageNumbers = computed(() => demo.rows)
const target = ref(demo.target)

const emptyPreviewRowsA = demo.emptyPreviewRowsA
</script>

<template>
  <section class="goods-page view is-on" data-v-35cea54b="">
    <div class="page-head" data-v-35cea54b="">
      <div data-v-35cea54b="">
        <h1 data-v-35cea54b="">店铺商品</h1>
        <p data-v-35cea54b=""></p>
      </div>
      <div class="page-head__acts" data-v-35cea54b="">
        <button class="btn btn--ghost" type="button" @click="__stub('此操作')" data-v-35cea54b="">
          ← 返回店铺列表
        </button>
      </div>
    </div>
    <div class="panel goods-panel" data-v-35cea54b="">
      <div class="panel__bar goods-panel__bar" data-v-35cea54b="">
        <div class="panel__title" data-v-35cea54b="">
          商品列表 <b data-v-35cea54b="">{{ props?.total }}</b>
        </div>
        <div class="panel__tools" data-v-35cea54b="">
          <label class="search" data-v-35cea54b=""
            ><span data-v-35cea54b="">⌕</span
            ><input
              :value="props?.nameQuery"
              type="search"
              placeholder="商品名称 / 编号"
              @input="__stub('此操作')"
              @keydown="__stub('此操作')"
              data-v-35cea54b="" /></label
          ><label class="search search--code" data-v-35cea54b=""
            ><span data-v-35cea54b="">#</span
            ><input
              :value="props?.codeQuery"
              type="search"
              placeholder="商品编码"
              @input="__stub('此操作')"
              @keydown="__stub('此操作')"
              data-v-35cea54b="" /></label
          ><button
            class="btn btn--primary"
            type="button"
            @click="__stub('此操作')"
            data-v-35cea54b=""
          >
            查询</button
          ><button
            class="btn btn--ghost"
            type="button"
            @click="__stub('此操作')"
            data-v-35cea54b=""
          >
            重置
          </button>
        </div>
      </div>
      <div class="goods-toolbar" data-v-35cea54b="">
        <button class="chip" type="button" @click="__stub('此操作')" data-v-35cea54b="">
          批量编辑</button
        ><button class="chip" type="button" @click="__stub('此操作')" data-v-35cea54b="">
          批量设编码</button
        ><button
          class="chip chip--danger"
          type="button"
          @click="__stub('此操作')"
          data-v-35cea54b=""
        >
          批量删除
        </button>
      </div>
      <div v-show="props?.loading" class="goods-table-wrap" data-v-35cea54b="">
        <el-table :data="props?.rows" stripe="" height="100%" empty-text=" " data-v-35cea54b=""
          ><template #empty
            ><div class="goods-empty" data-v-35cea54b="">
              <strong data-v-35cea54b="">暂无已学商品</strong
              ><span data-v-35cea54b=""
                >可返回店铺列表点击「学习商品」，或调整名称 / 编码后再查</span
              >
            </div></template
          ><el-table-column width="48" data-v-35cea54b=""
            ><template #header
              ><el-checkbox
                :model-value="props?.allPageSelected"
                @change="__stub('此操作')"
                data-v-35cea54b=""
              ></el-checkbox></template
            ><el-checkbox
              @change="__stub('此操作')"
              data-v-35cea54b=""
            ></el-checkbox></el-table-column
          ><el-table-column
            prop="id"
            label="商品编号"
            min-width="128"
            show-overflow-tooltip=""
            data-v-35cea54b=""
          ></el-table-column
          ><el-table-column
            prop="name"
            label="商品名称"
            min-width="220"
            show-overflow-tooltip=""
            data-v-35cea54b=""
          ></el-table-column
          ><el-table-column label="商品编码" min-width="120" data-v-35cea54b=""
            ><button
              type="button"
              :class="['code-link', { 'is-empty': !target?.code || target?.code === '-' }]"
              @click="__stub('此操作')"
              data-v-35cea54b=""
            >
              {{ target?.code && target?.code !== '-' ? target?.code : '设置编码' }}
            </button></el-table-column
          ><el-table-column label="学习状态" width="92" data-v-35cea54b=""
            ><span :class="['learn-tag', false]" data-v-35cea54b=""></span></el-table-column
          ><el-table-column label="操作" width="168" fixed="right" data-v-35cea54b=""
            ><button class="row-btn" type="button" @click="__stub('此操作')" data-v-35cea54b="">
              编辑</button
            ><button
              class="row-btn row-btn--danger"
              type="button"
              @click="__stub('此操作')"
              data-v-35cea54b=""
            >
              删除
            </button></el-table-column
          ></el-table
        >
      </div>
      <div class="list-pager" data-v-35cea54b="">
        <div class="list-pager__left" data-v-35cea54b="">
          <span class="list-pager__info" data-v-35cea54b=""
            ><template v-if="props?.total">{{
              '第 ' +
              listPager__left +
              '-' +
              listPager__leftSummary +
              ' 条 / 共 ' +
              props?.total +
              ' 个商品'
            }}</template
            ><template v-else>共 0 个商品</template></span
          ><select
            class="list-pager__size"
            title="每页展示数量"
            :value="String(props?.pageSize)"
            @change="__stub('此操作')"
            data-v-35cea54b=""
          >
            <template :key="entryIndex" v-for="(item, entryIndex) in emptyPreviewRowsA"
              ><option :value="String(item)" data-v-35cea54b="">{{ item?.label }}</option></template
            >
          </select>
        </div>
        <div class="list-pager__acts" data-v-35cea54b="">
          <button
            type="button"
            class="pager-btn"
            :disabled="props?.page <= 1"
            @click="__stub('此操作')"
            data-v-35cea54b=""
          >
            上一页</button
          ><template :key="index" v-for="(item, index) in pageNumbers"
            ><template v-if="item === '…'"
              ><span class="pager-ellipsis" data-v-35cea54b="">…</span></template
            ><template v-else
              ><button
                type="button"
                :class="['pager-btn', { 'is-on': Number(item) === props?.page }]"
                @click="__stub('此操作')"
                data-v-35cea54b=""
              >
                {{ item }}
              </button></template
            ></template
          ><button
            type="button"
            class="pager-btn"
            :disabled="props?.page >= disabled"
            @click="__stub('此操作')"
            data-v-35cea54b=""
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
