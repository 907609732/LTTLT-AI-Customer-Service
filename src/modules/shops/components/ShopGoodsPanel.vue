<script setup lang="ts">
import { computed, inject, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessageBox, type TableInstance } from 'element-plus'
import { useRouter } from 'vue-router'
import { platformLearningTransportKey } from '@/modules/knowledge'
import {
  platformLearningSnapshotSchema,
  type PlatformLearningTask,
} from '@/shared/contracts/platform-learning'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { downloadText } from '@/shared/platform/files'
import type { Product, ProductDraft } from '@/shared/contracts/backend'
import type { ProductCatalogRow } from '@/shared/contracts/product-catalog'
import { useProductService } from '../services'
import PlatformProductDetailsDialog from './PlatformProductDetailsDialog.vue'
withDefaults(defineProps<{ viewKey?: string }>(), { viewKey: 'goods' })
const runtime = useRuntimeStore(),
  service = useProductService(),
  task = useTask(),
  router = useRouter()
const rows = ref<ProductCatalogRow[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(20),
  loading = ref(false),
  loadError = ref(''),
  stale = ref(false)
const query = ref(''),
  merchantCode = ref(''),
  applied = reactive({ query: '', merchantCode: '' })
const chosen = ref<ProductCatalogRow[]>([]),
  table = ref<TableInstance>(),
  editing = ref(false),
  detailRow = ref<ProductCatalogRow | null>(null),
  importOpen = ref(false),
  batchOpen = ref(false)
const currentStore = computed(() => runtime.currentStore),
  selected = computed(() => runtime.selectedStoreId)
let sequence = 0,
  disposed = false
const key = () => `${runtime.snapshot.workspaceId}:${selected.value}`
const isCurrent = (scope: string) => !disposed && key() === scope
function requireCurrent(scope: string) {
  if (!isCurrent(scope)) throw Error('店铺或账号已变化，已停止后续操作')
}
const collection = inject(platformLearningTransportKey, null)
const collecting = ref(false),
  collectionError = ref(''),
  collectionTask = ref<PlatformLearningTask | null>(null)
let collectionEpoch = 0,
  collectionTimer: ReturnType<typeof setTimeout> | undefined
function resetCollection() {
  collectionEpoch++
  clearTimeout(collectionTimer)
  collecting.value = false
  collectionTask.value = null
  collectionError.value = ''
}
async function collectProducts() {
  if (collecting.value || task.pending.value || !selected.value) return
  const scope = key(),
    epoch = ++collectionEpoch,
    workspaceId = runtime.snapshot.workspaceId,
    storeId = selected.value
  collecting.value = true
  collectionError.value = ''
  collectionTask.value = null
  const current = () => epoch === collectionEpoch && isCurrent(scope)
  const accept = async (value: unknown, taskId?: string) => {
    if (!current()) return
    const snapshot = platformLearningSnapshotSchema.parse(value)
    if (snapshot.workspaceId !== workspaceId) throw Error('采集工作区已变化')
    const next = snapshot.tasks
      .filter(
        (t) =>
          t.source === 'products' && t.identity.storeId === storeId && (!taskId || t.id === taskId),
      )
      .reverse()
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!next) throw Error('未返回本店商品采集任务，请刷新后重试')
    collectionTask.value = next
    collectionError.value = next.error
    if (next.status === 'running') {
      collectionTimer = setTimeout(() => {
        void poll(next.id)
      }, 1000)
    } else {
      collecting.value = false
      // 任务失败或中断前也可能已经保存部分商品，终态都刷新实际列表。
      await load()
    }
  }
  const poll = async (taskId: string) => {
    if (!current()) return
    try {
      await accept(await collection!.snapshot({ workspaceId, storeId }), taskId)
    } catch (cause) {
      if (!current()) return
      collecting.value = false
      collectionError.value = cause instanceof Error ? cause.message : '读取采集进度失败'
    }
  }
  try {
    if (!collection) throw Error('平台采集服务未就绪，请使用桌面版并重试')
    await accept(
      await collection.start({
        workspaceId,
        storeId,
        source: 'products',
        range: { maxPages: 100, maxRecords: 10000, productStatus: 'all' },
      }),
    )
  } catch (cause) {
    if (!current()) return
    collecting.value = false
    collectionError.value = cause instanceof Error ? cause.message : '商品采集失败'
  }
}
function clearSelection() {
  chosen.value = []
  table.value?.clearSelection()
}
async function load() {
  const store = selected.value,
    scope = key(),
    ticket = ++sequence
  if (!store) {
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  loadError.value = ''
  clearSelection()
  try {
    const next = await service.list(store, page.value, {
      pageSize: pageSize.value,
      query: applied.query,
      merchantCode: applied.merchantCode,
    })
    if (ticket !== sequence || !isCurrent(scope)) return
    rows.value = next.items
    total.value = next.total
    stale.value = false
    if (page.value > 1 && !next.items.length && next.total > 0) {
      page.value = Math.ceil(next.total / pageSize.value)
      await load()
    }
  } catch (cause) {
    if (ticket === sequence && isCurrent(scope)) {
      loadError.value = cause instanceof Error ? cause.message : '商品读取失败'
      stale.value = true
    }
  } finally {
    if (ticket === sequence) loading.value = false
  }
}
onBeforeUnmount(() => {
  disposed = true
  sequence++
  resetCollection()
})
function search() {
  applied.query = query.value.trim()
  applied.merchantCode = merchantCode.value.trim()
  page.value = 1
  void load()
}
function reset() {
  query.value = ''
  merchantCode.value = ''
  search()
}
function changePage(value: number) {
  page.value = value
  void load()
}
function changeSize(value: number) {
  pageSize.value = value
  page.value = 1
  void load()
}
function learn() {
  void router.push('/shop/manage?panel=intent-doc&source=products')
}
const blank = (): ProductDraft => ({
  productId: '',
  title: '',
  description: '',
  specifications: '',
  price: '',
  enabled: true,
})
const draft = reactive<ProductDraft>(blank()),
  draftScope = ref(''),
  initialDraft = ref('')
function edit(row?: Product) {
  Object.keys(draft).forEach((k) => Reflect.deleteProperty(draft, k))
  Object.assign(
    draft,
    row
      ? {
          id: row.id,
          version: row.version,
          productId: row.productId,
          title: row.title,
          description: row.description,
          specifications: row.specifications,
          price: row.price,
          enabled: row.enabled,
        }
      : blank(),
  )
  draftScope.value = key()
  initialDraft.value = JSON.stringify(draft)
  editing.value = true
}
async function closeEditor(done: () => void) {
  if (task.pending.value) return
  if (JSON.stringify(draft) !== initialDraft.value) {
    try {
      await ElMessageBox.confirm('尚有未保存的商品知识，确认放弃修改？', '放弃修改', {
        type: 'warning',
      })
    } catch {
      return
    }
  }
  done()
}
async function save() {
  const scope = draftScope.value,
    store = selected.value
  await task.run(async () => {
    requireCurrent(scope)
    await service.save(store, { ...draft })
    requireCurrent(scope)
    editing.value = false
    await load()
    requireCurrent(scope)
    task.message.value = '商品知识已保存，平台商品未改动。'
  })
}
async function remove(row: Product) {
  const scope = key()
  try {
    await ElMessageBox.confirm(
      `仅删除“${row.title}”的本机商品知识？平台商品不会被删除。`,
      '删除商品知识',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await task.run(async () => {
    requireCurrent(scope)
    await runtime.run({
      action: 'remove-product',
      storeId: row.storeId,
      values: { id: row.id, version: row.version, confirmed: true },
    })
    requireCurrent(scope)
    await load()
    requireCurrent(scope)
    task.message.value = '商品知识已删除。'
  })
}
const batchFields = reactive({
    description: false,
    specifications: false,
    price: false,
    enabled: false,
  }),
  batchDraft = reactive({ description: '', specifications: '', price: '', enabled: true })
const batchRows = ref<ProductCatalogRow[]>([]),
  batchScope = ref('')
interface BatchResult {
  id: string
  title: string
  status: '成功' | '失败' | '未执行'
  reason: string
}
const batchResults = ref<BatchResult[]>([])
function openBatch() {
  batchRows.value = [...chosen.value]
  batchScope.value = key()
  for (const k of Object.keys(batchFields)) Reflect.set(batchFields, k, false)
  Object.assign(batchDraft, { description: '', specifications: '', price: '', enabled: true })
  batchOpen.value = true
}
async function performBatch(
  values: ProductCatalogRow[],
  operation: (row: ProductCatalogRow) => Promise<unknown>,
  scope: string,
) {
  batchResults.value = values.map((row) => ({
    id: row.id,
    title: row.title,
    status: '未执行',
    reason: '',
  }))
  for (let i = 0; i < values.length; i++) {
    if (!isCurrent(scope)) {
      for (const result of batchResults.value.slice(i)) result.reason = '店铺或账号已变化'
      break
    }
    try {
      await operation(values[i])
      if (!isCurrent(scope)) break
      batchResults.value[i] = {
        id: values[i].id,
        title: values[i].title,
        status: '成功',
        reason: '',
      }
    } catch (cause) {
      if (!isCurrent(scope)) break
      batchResults.value[i] = {
        id: values[i].id,
        title: values[i].title,
        status: '失败',
        reason: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }
  if (isCurrent(scope)) {
    const success = batchResults.value.filter((r) => r.status === '成功').length
    task.message.value = `成功 ${success} 项，失败 ${batchResults.value.filter((r) => r.status === '失败').length} 项，未执行 ${batchResults.value.filter((r) => r.status === '未执行').length} 项。`
    await load()
  }
}
async function closeBatch(done: () => void) {
  if (task.pending.value) return
  if (Object.values(batchFields).some(Boolean)) {
    try {
      await ElMessageBox.confirm('批量修改尚未保存，确认放弃？', '放弃修改', { type: 'warning' })
    } catch {
      return
    }
  }
  done()
}
async function saveBatch() {
  if (!Object.values(batchFields).some(Boolean)) {
    task.error.value = '请勾选至少一个需要修改的字段'
    return
  }
  const scope = batchScope.value,
    store = selected.value
  await task.run(async () => {
    requireCurrent(scope)
    batchOpen.value = false
    await performBatch(
      [...batchRows.value],
      (row) =>
        service.save(store, {
          id: row.id,
          version: row.version,
          productId: row.productId,
          title: row.title,
          description: batchFields.description ? batchDraft.description : row.description,
          specifications: batchFields.specifications
            ? batchDraft.specifications
            : row.specifications,
          price: batchFields.price ? batchDraft.price : row.price,
          enabled: batchFields.enabled ? batchDraft.enabled : row.enabled,
        }),
      scope,
    )
  })
}
async function deleteBatch() {
  const values = [...chosen.value],
    scope = key(),
    store = selected.value
  try {
    await ElMessageBox.confirm(
      `从“${currentStore.value?.storeName}”删除所选 ${values.length} 项本机商品知识？平台商品不会被删除。`,
      '批量删除',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await task.run(async () => {
    requireCurrent(scope)
    await performBatch(
      values,
      (row) =>
        runtime.run({
          action: 'remove-product',
          storeId: store,
          values: { id: row.id, version: row.version, confirmed: true },
        }),
      scope,
    )
  })
}
const csv = ref(''),
  preview = ref<{ revision: number; count: number; storeId: string } | null>(null),
  mode = ref('skip')
async function readCsv(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const scope = key()
  await task.run(async () => {
    if (file.size > 1048576) throw Error('CSV 最大1MB')
    const text = await file.text()
    requireCurrent(scope)
    csv.value = text
    preview.value = null
  })
}
async function previewImport() {
  const scope = key(),
    store = selected.value
  await task.run(async () => {
    const next = await service.preview(store, csv.value)
    requireCurrent(scope)
    preview.value = { ...next, storeId: store }
  })
}
async function confirmImport() {
  const scope = key(),
    p = preview.value,
    text = csv.value
  await task.run(async () => {
    if (!p || p.storeId !== selected.value) throw Error('请重新预览当前店铺CSV')
    requireCurrent(scope)
    await runtime.run({
      action: 'import-products',
      storeId: p.storeId,
      values: { csv: text, revision: p.revision, mode: mode.value, confirmed: true },
    })
    requireCurrent(scope)
    preview.value = null
    page.value = 1
    await load()
    requireCurrent(scope)
    task.message.value = '商品知识已导入。'
  })
}
async function exportCsv() {
  const scope = key(),
    store = selected.value
  await task.run(async () => {
    const result = await runtime.run({ action: 'export-products', storeId: store })
    requireCurrent(scope)
    if (typeof result.data.csv !== 'string') throw Error('导出内容无效')
    downloadText('商品知识.csv', result.data.csv, 'text/csv;charset=utf-8')
  })
}
const first = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0)),
  last = computed(() => Math.min(page.value * pageSize.value, total.value))
watch(
  [selected, () => runtime.snapshot.workspaceId],
  () => {
    sequence++
    resetCollection()
    rows.value = []
    total.value = 0
    loadError.value = ''
    stale.value = false
    query.value = ''
    merchantCode.value = ''
    applied.query = ''
    applied.merchantCode = ''
    page.value = 1
    clearSelection()
    editing.value = false
    detailRow.value = null
    batchOpen.value = false
    importOpen.value = false
    preview.value = null
    csv.value = ''
    task.error.value = ''
    task.message.value = ''
    batchResults.value = []
    void load()
  },
  { immediate: true },
)
</script>
<template>
  <section class="goods-knowledge" data-no-drag>
    <el-alert
      v-if="!runtime.available"
      type="info"
      :closable="false"
      title="浏览器仅供预览，请在桌面版管理商品知识。"
    />
    <el-alert
      v-if="task.error.value || loadError"
      :title="task.error.value || loadError"
      type="error"
      :closable="false"
      role="alert"
    />
    <el-alert
      v-if="task.message.value"
      :title="task.message.value"
      type="success"
      :closable="false"
      role="status"
    />
    <div v-if="!selected" class="goods-empty">
      <h2>请先选择店铺</h2>
      <p>从店铺列表进入，或先添加一家店铺。</p>
      <el-button @click="router.push('/shop/manage?panel=shops')">返回店铺列表</el-button>
    </div>
    <div v-else class="goods-card">
      <div class="goods-card-head">
        <strong
          >商品列表 <b>{{ total }}</b></strong
        >
        <form data-goods-query class="goods-query" @submit.prevent="search">
          <el-input
            v-model="query"
            aria-label="商品名称或平台编号"
            placeholder="商品名称 / 平台编号"
            :disabled="task.pending.value"
            clearable
          /><el-input
            v-model="merchantCode"
            aria-label="商家编码筛选"
            placeholder="商家编码"
            :disabled="task.pending.value"
            clearable
          /><el-button type="primary" native-type="submit" :disabled="task.pending.value"
            >查询</el-button
          ><el-button data-goods-reset :disabled="task.pending.value" @click="reset"
            >重置</el-button
          >
        </form>
      </div>
      <div class="goods-tools">
        <div>
          <el-button
            :disabled="!chosen.length || task.pending.value || loading || stale"
            @click="openBatch"
            >批量编辑</el-button
          ><el-button
            type="danger"
            plain
            :disabled="!chosen.length || task.pending.value || loading || stale"
            @click="deleteBatch"
            >批量删除</el-button
          ><span>已选 {{ chosen.length }} 项（仅本页）</span>
        </div>
        <div>
          <el-button
            data-goods-learn
            :disabled="collecting || task.pending.value || !runtime.available"
            :loading="collecting"
            @click="collectProducts"
            >{{ collecting ? '采集中' : '采集平台商品' }}</el-button
          >
          <el-button type="primary" :disabled="task.pending.value" @click="edit()"
            >新增商品知识</el-button
          ><el-button :disabled="task.pending.value || loading" @click="load">刷新</el-button
          ><el-button :disabled="task.pending.value" @click="importOpen = true"
            >CSV 导入 / 导出</el-button
          >
        </div>
      </div>
      <div
        v-if="collectionTask || collectionError || collecting"
        class="collection-progress"
        role="status"
        aria-label="商品采集进度"
      >
        <p v-if="collectionTask">
          {{
            collectionTask.status === 'running'
              ? '正在采集'
              : collectionTask.status === 'completed'
                ? collectionTask.sourceLimited
                  ? '部分采集完成'
                  : '采集完成'
                : collectionTask.status === 'failed'
                  ? '采集失败'
                  : collectionTask.status === 'paused'
                    ? '采集已暂停'
                    : '采集已取消'
          }}
          · 已读取 {{ collectionTask.pages }} 页 / {{ collectionTask.records }} 条<span
            v-if="collectionTask.total !== undefined"
          >
            · 平台总数 {{ collectionTask.total }}</span
          >
        </p>
        <p v-else-if="collecting">正在打开平台并准备采集…</p>
        <p v-if="collectionTask?.status === 'completed'">
          列表已刷新；新商品默认停用。确认资料后，可在编辑中启用检索，或勾选后批量修改使用状态。
        </p>
        <p v-if="collectionError" role="alert">{{ collectionError }}</p>
        <p
          v-if="collectionTask?.sourceLimited"
          style="max-height: 48px; overflow: auto"
          role="alert"
        >
          {{ collectionTask.scope }}
        </p>
        <el-button link @click="learn">查看采集记录 / 审核问答候选</el-button>
      </div>
      <p v-if="stale" class="stale-warning">
        本次读取失败，下面保留上次结果，当前不能批量修改。<button @click="load">重新读取</button>
      </p>
      <el-table
        ref="table"
        v-loading="loading"
        :data="rows"
        row-key="id"
        stripe
        class="goods-table"
        :height="
          collectionTask || collectionError || collecting
            ? collectionTask?.sourceLimited
              ? 'max(220px, calc(100vh - 525px))'
              : 'max(220px, calc(100vh - 475px))'
            : 'max(220px, calc(100vh - 380px))'
        "
        :selectable="() => !task.pending.value && !stale"
        @selection-change="chosen = $event"
      >
        <el-table-column
          type="selection"
          width="44"
          :selectable="() => !task.pending.value && !stale"
        />
        <el-table-column
          prop="productId"
          label="平台商品编号"
          min-width="170"
          show-overflow-tooltip
        />
        <el-table-column prop="title" label="商品名称" min-width="280" show-overflow-tooltip />
        <el-table-column label="平台商家编码" width="150">
          <template #default="{ row }">
            <span :data-platform-code="row.id">{{
              row.merchantCode || (row.platformDetail ? '平台未填写' : '尚未采集')
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="使用状态" width="100"
          ><template #default="{ row }"
            ><span class="goods-status" :class="{ enabled: row.enabled }">{{
              row.enabled ? '已启用' : '已停用'
            }}</span></template
          ></el-table-column
        >
        <el-table-column label="操作" width="190"
          ><template #default="{ row }"
            ><el-button link type="primary" :data-platform-detail="row.id" @click="detailRow = row"
              >平台详情</el-button
            ><el-button
              link
              type="primary"
              :disabled="task.pending.value || stale"
              :data-product-edit="row.id"
              @click="edit(row)"
              >编辑</el-button
            ><el-button
              link
              type="danger"
              :disabled="task.pending.value || stale"
              :data-product-delete="row.id"
              @click="remove(row)"
              >删除</el-button
            ></template
          ></el-table-column
        >
        <template #empty
          ><div class="goods-table-empty">
            {{
              applied.query || applied.merchantCode
                ? '没有符合条件的商品，请调整搜索或重置。'
                : '本店尚无商品知识，点击“采集平台商品”将实际商品加入列表，也可新增或导入。'
            }}
          </div></template
        >
      </el-table>
      <footer class="goods-pagination">
        <span>第 {{ first }}–{{ last }} 条 / 共 {{ total }} 个商品</span
        ><el-pagination
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[20, 50, 100, 200]"
          :total="total"
          layout="sizes, prev, pager, next"
          :disabled="task.pending.value || loading"
          @current-change="changePage"
          @size-change="changeSize"
        />
      </footer>
    </div>
    <section v-if="batchResults.length" class="batch-report" aria-label="批量操作结果">
      <h3>批量操作结果</h3>
      <p v-for="result in batchResults" :key="result.id">
        <b>{{ result.status }}</b> · {{ result.title }} <span>{{ result.reason }}</span>
      </p>
      <p>失败项请刷新后重新选择；成功项不会自动重试。</p>
    </section>
    <el-dialog
      v-model="editing"
      :title="draft.id ? '编辑商品知识' : '新增商品知识'"
      width="720px"
      append-to-body
      :before-close="closeEditor"
      :close-on-click-modal="false"
      class="goods-dialog"
    >
      <el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
      <form class="goods-editor" @submit.prevent="save">
        <h3>基本资料</h3>
        <div class="editor-grid">
          <label
            >平台商品编号<el-input
              v-model="draft.productId"
              aria-label="商品编号"
              maxlength="100" /></label
          ><label
            >商品名称<el-input v-model="draft.title" aria-label="商品名称" maxlength="200"
          /></label>
        </div>
        <p class="field-hint">平台商家编码与SKU资料从平台只读采集；这里仅编辑本机接待知识。</p>
        <h3>接待知识</h3>
        <label
          >商品说明<el-input
            v-model="draft.description"
            type="textarea"
            :rows="5"
            aria-label="商品说明"
            maxlength="6000" /></label
        ><label
          >规格资料<el-input
            v-model="draft.specifications"
            type="textarea"
            :rows="3"
            aria-label="规格资料"
            maxlength="3000" /></label
        ><label
          >价格资料<el-input v-model="draft.price" aria-label="价格资料" maxlength="80"
        /></label>
        <h3>使用设置</h3>
        <el-switch v-model="draft.enabled" active-text="用于商品知识检索" />
        <p class="field-hint">
          启用并保存后，AI可检索本商品知识和已采集的SKU资料，无需另外训练；未明确规格时应先询问。不会自动开启店铺AI。
        </p>
        <div class="dialog-actions">
          <el-button :disabled="task.pending.value" @click="closeEditor(() => (editing = false))"
            >取消</el-button
          ><el-button type="primary" native-type="submit" :loading="task.pending.value"
            >保存商品知识</el-button
          >
        </div>
      </form>
    </el-dialog>
    <PlatformProductDetailsDialog v-if="detailRow" :row="detailRow" @close="detailRow = null" />
    <el-dialog
      v-model="batchOpen"
      :title="`批量编辑 ${batchRows.length} 项`"
      :before-close="closeBatch"
      width="720px"
      append-to-body
      :close-on-click-modal="false"
      :show-close="!task.pending.value"
      class="goods-dialog"
      ><p>仅修改勾选字段，未勾选字段保留各商品原值；按商品版本逐项执行并报告结果。</p>
      <div class="batch-fields">
        <label
          ><el-checkbox v-model="batchFields.description">修改商品说明</el-checkbox
          ><el-input
            v-model="batchDraft.description"
            type="textarea"
            aria-label="批量商品说明"
            :disabled="!batchFields.description"
            maxlength="6000" /></label
        ><label
          ><el-checkbox v-model="batchFields.specifications">修改规格资料</el-checkbox
          ><el-input
            v-model="batchDraft.specifications"
            type="textarea"
            aria-label="批量规格资料"
            :disabled="!batchFields.specifications"
            maxlength="3000" /></label
        ><label
          ><el-checkbox v-model="batchFields.price">修改价格资料</el-checkbox
          ><el-input
            v-model="batchDraft.price"
            aria-label="批量价格资料"
            :disabled="!batchFields.price"
            maxlength="80" /></label
        ><label
          ><el-checkbox v-model="batchFields.enabled">修改使用状态</el-checkbox
          ><el-switch
            v-model="batchDraft.enabled"
            active-text="启用检索"
            inactive-text="停用检索"
            :disabled="!batchFields.enabled"
        /></label>
      </div>
      <template #footer
        ><el-button @click="closeBatch(() => (batchOpen = false))">取消</el-button
        ><el-button data-save-batch type="primary" @click="saveBatch"
          >确认逐项保存</el-button
        ></template
      ></el-dialog
    >
    <el-dialog
      v-model="importOpen"
      title="CSV 导入 / 导出"
      width="760px"
      append-to-body
      :close-on-click-modal="false"
      :show-close="!task.pending.value"
      class="goods-dialog"
      ><p>
        选择文件 → 预览 → 确认。每批最多1000条、1MB；必须有 productId、title，其他可选
        description、specifications、price、enabled。平台编码、详情和SKU来自采集档案，不随此CSV修改。
      </p>
      <el-alert
        v-if="task.error.value"
        :title="task.error.value"
        type="error"
        :closable="false"
      /><input
        type="file"
        accept=".csv,text/csv"
        aria-label="导入商品CSV"
        :disabled="task.pending.value"
        @change="readCsv"
      /><el-input
        v-model="csv"
        aria-label="商品CSV内容"
        type="textarea"
        :rows="6"
        :disabled="task.pending.value"
        @input="preview = null"
      />
      <div class="csv-tools">
        <el-select v-model="mode" aria-label="重复商品处理" :disabled="task.pending.value"
          ><el-option value="skip" label="跳过重复编号" /><el-option
            value="replace"
            label="替换重复编号" /></el-select
        ><el-button :disabled="!csv || task.pending.value" @click="previewImport">预览CSV</el-button
        ><el-button type="primary" :disabled="!preview || task.pending.value" @click="confirmImport"
          >确认导入 {{ preview?.count ?? 0 }} 条</el-button
        ><el-button :disabled="task.pending.value" @click="exportCsv">导出现有知识</el-button>
      </div>
      <template #footer
        ><el-button :disabled="task.pending.value" @click="importOpen = false"
          >关闭</el-button
        ></template
      ></el-dialog
    >
  </section>
</template>
<style scoped>
.goods-knowledge {
  padding: 16px 24px;
  background: #f8fbff;
  min-height: 100%;
  color: #263653;
  -webkit-app-region: no-drag;
}
.collection-progress {
  padding: 8px 16px;
  background: #f4f8ff;
  font-size: 13px;
  color: #587195;
}
.collection-progress p {
  margin: 4px 0;
}
.goods-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 22px;
}
.goods-heading h1 {
  font-size: 22px;
  margin: 0 0 8px;
  font-weight: 700;
}
.goods-heading h1 span {
  font-size: 14px;
  font-weight: 500;
  color: #5a779e;
  margin-left: 12px;
}
.goods-heading p,
.goods-store > span {
  font-size: 13px;
  color: #7c8da7;
  margin: 0;
  line-height: 1.7;
}
.heading-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.goods-store {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 15px 0;
}
.goods-store :deep(.runtime-store-select) {
  min-width: 260px;
}
.goods-card {
  border: 1px solid #cfe0ff;
  border-radius: 16px;
  background: white;
  overflow: hidden;
  box-shadow: 0 4px 16px #2563eb08;
}
.goods-card-head {
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 16px;
  border-bottom: 1px solid #dce8fc;
}
.goods-card-head strong {
  font-size: 14px;
  white-space: nowrap;
}
.goods-card-head b {
  margin-left: 8px;
  padding: 2px 7px;
  border-radius: 20px;
  background: #e9f2ff;
  color: #3785fa;
  font-size: 12px;
}
.goods-query {
  display: flex;
  align-items: center;
  gap: 8px;
}
.goods-query :deep(.el-input) {
  width: 220px;
}
.goods-query :deep(.el-input:nth-child(2)) {
  width: 200px;
}
.goods-query :deep(.el-input__wrapper) {
  border-radius: 12px;
  background: #f7faff;
}
.goods-query :deep(.el-button) {
  border-radius: 18px;
  margin: 0;
}
.goods-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  gap: 12px;
  flex-wrap: wrap;
}
.goods-tools > div {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.goods-tools :deep(.el-button) {
  font-size: 12px;
  min-height: 27px;
  height: auto;
  padding: 5px 9px;
  border-radius: 15px;
  margin: 0;
}
.goods-tools span {
  font-size: 12px;
  color: #8a99ae;
}
.goods-table :deep(th.el-table__cell) {
  background: #f3f7fd;
  color: #61738e;
  height: 49px;
  font-size: 13px;
}
.goods-table :deep(td.el-table__cell) {
  height: 49px;
  border-bottom: 1px solid #e5edf8;
  color: #344563;
}
.goods-table :deep(.el-table__row:hover > td) {
  background: #f2f7ff;
}
.goods-table :deep(.el-button + .el-button) {
  margin-left: 10px;
}
.goods-status {
  display: inline-block;
  background: #eef1f5;
  color: #7b8799;
  font-size: 12px;
  line-height: 22px;
  padding: 0 9px;
  border-radius: 20px;
}
.goods-status.enabled {
  background: #ddf8eb;
  color: #0b9b6a;
}
.goods-pagination {
  min-height: 56px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #d4e3fb;
  gap: 12px;
}
.goods-pagination > span {
  font-size: 12px;
  color: #7f91ad;
  white-space: nowrap;
}
.goods-table-empty,
.goods-empty {
  padding: 40px 20px;
  color: #8394ad;
  line-height: 1.8;
}
.goods-empty {
  background: white;
  border-radius: 16px;
  text-align: center;
}
.goods-knowledge > :deep(.el-alert) {
  margin-bottom: 12px;
}
.stale-warning {
  padding: 10px 16px;
  background: #fff8e6;
  font-size: 13px;
  color: #94600b;
  margin: 0;
}
.stale-warning button {
  margin-left: 10px;
  border: 0;
  background: none;
  color: #267dff;
  cursor: pointer;
}
.batch-report {
  margin-top: 18px;
  padding: 16px;
  background: white;
  border: 1px solid #dbe7f8;
  border-radius: 12px;
}
.batch-report h3 {
  margin-top: 0;
  font-size: 15px;
}
.batch-report p {
  font-size: 13px;
  line-height: 1.6;
}
.batch-report p span {
  color: #a35a44;
}
.goods-editor {
  display: grid;
  gap: 14px;
}
.goods-editor h3 {
  font-size: 14px;
  margin: 5px 0;
  color: #395374;
}
.goods-editor label,
.batch-fields > label {
  display: grid;
  gap: 7px;
  color: #5d708e;
  font-size: 13px;
}
.editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.field-hint {
  font-size: 12px;
  line-height: 1.6;
  color: #8996aa;
  margin: 0 0 14px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
}
.code-list {
  max-height: 52vh;
  overflow: auto;
}
.code-list article {
  display: grid;
  grid-template-columns: 1fr 220px;
  align-items: center;
  gap: 18px;
  padding: 14px 0;
  border-bottom: 1px solid #edf1f7;
}
.code-list strong {
  display: block;
  font-weight: 500;
  font-size: 13px;
}
.code-list small {
  display: block;
  color: #94a0b3;
  margin-top: 5px;
}
.batch-fields {
  display: grid;
  gap: 17px;
}
.csv-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 15px;
}
.csv-tools :deep(.el-select) {
  width: 180px;
}
@media (max-width: 1100px) {
  .goods-heading {
    flex-wrap: wrap;
  }
  .goods-card-head {
    flex-wrap: wrap;
  }
  .goods-query {
    flex-wrap: wrap;
    width: 100%;
  }
  .goods-store {
    flex-wrap: wrap;
  }
  .goods-pagination {
    flex-wrap: wrap;
  }
}
@media (max-width: 760px) {
  .goods-knowledge {
    padding: 20px 12px;
  }
  .heading-actions {
    flex-wrap: wrap;
  }
  .editor-grid {
    grid-template-columns: 1fr;
  }
  .code-list article {
    grid-template-columns: 1fr;
  }
  .goods-query :deep(.el-input) {
    width: 100%;
  }
  .goods-query :deep(.el-input:nth-child(2)) {
    width: 100%;
  }
}
</style>
<style>
.goods-dialog {
  max-width: calc(100vw - 32px);
}
.goods-dialog .el-dialog__body {
  max-height: 65vh;
  overflow: auto;
}
.goods-dialog .el-dialog__footer {
  border-top: 1px solid #edf2fa;
}
</style>
