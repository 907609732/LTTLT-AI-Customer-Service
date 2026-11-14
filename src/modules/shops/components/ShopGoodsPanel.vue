<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { downloadText } from '@/shared/platform/files'
import type { LocalStore, Product, ProductDraft } from '@/shared/contracts/backend'
import { useProductService } from '../services'
import AddShopDialog from './AddShopDialog.vue'
withDefaults(defineProps<{ viewKey?: string }>(), { viewKey: 'shops' })
const runtime = useRuntimeStore(),
  service = useProductService(),
  task = useTask()
const router = useRouter()
async function connectShop(shop: LocalStore) {
  await task.run(async () => {
    await runtime.run({ action: 'open-store', storeId: shop.id })
    runtime.selectedStoreId = shop.id
    runtime.platformStoreId = shop.id
    await router.push('/')
  })
}
async function groupShop(shop: LocalStore) {
  let value: string
  try {
    const result = await ElMessageBox.prompt('填写本机店铺分组，可留空', '店铺分组', {
      inputValue: shop.group,
    })
    value = result.value
  } catch {
    return
  }
  await task.run(async () => {
    const result = await runtime.run({
      action: 'set-store-group',
      storeId: shop.id,
      values: { group: value },
    })
    task.message.value = result.message
  })
}
async function removeShop(shop: LocalStore) {
  try {
    await ElMessageBox.confirm(
      `从本机移除“${shop.storeName || '待识别店铺'}”？本机会保留移除备份，平台店铺不会被删除。`,
      '移除店铺',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await task.run(async () => {
    const result = await runtime.run({
      action: 'remove-store',
      storeId: shop.id,
      values: { confirmed: true },
    })
    if (runtime.platformStoreId === shop.id) runtime.platformStoreId = ''
    task.message.value = result.message
    await load()
  })
}
const adding = ref(false),
  editing = ref(false),
  draftStoreId = ref(''),
  rows = ref<Product[]>([]),
  total = ref(0),
  page = ref(1)
const csv = ref(''),
  preview = ref<{ revision: number; count: number; storeId: string } | null>(null),
  mode = ref('skip')
const blank = (): ProductDraft => ({
  productId: '',
  title: '',
  description: '',
  specifications: '',
  price: '',
  enabled: true,
})
const draft = reactive<ProductDraft>(blank())
const selected = computed(() => runtime.selectedStoreId)
let sequence = 0
async function load() {
  const storeId = selected.value,
    ticket = ++sequence
  if (!storeId) {
    rows.value = []
    total.value = 0
    return
  }
  const result = await service.list(storeId, page.value)
  if (ticket === sequence && storeId === selected.value) {
    rows.value = result.items
    total.value = result.total
  }
}
watch(
  selected,
  () => {
    page.value = 1
    preview.value = null
    editing.value = false
    void task.run(load)
  },
  { immediate: true },
)
watch(page, () => {
  void task.run(load)
})
onBeforeUnmount(() => {
  sequence++
})
function edit(row?: Product) {
  Object.keys(draft).forEach((key) => Reflect.deleteProperty(draft, key))
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
  draftStoreId.value = selected.value
  editing.value = true
}
async function save() {
  await task.run(async () => {
    if (draftStoreId.value !== selected.value) throw new Error('店铺已切换，请重新打开编辑器')
    await service.save(draftStoreId.value, { ...draft })
    editing.value = false
    preview.value = null
    await load()
    task.message.value = '商品知识已保存，不会修改平台商品。'
  })
}
async function remove(row: Product) {
  try {
    await ElMessageBox.confirm(`删除“${row.title}”的本地知识？平台商品不会被删除。`, '确认删除', {
      type: 'warning',
    })
  } catch {
    return
  }
  await task.run(async () => {
    await runtime.run({
      action: 'remove-product',
      storeId: row.storeId,
      values: { id: row.id, version: row.version, confirmed: true },
    })
    preview.value = null
    await load()
  })
}
async function readCsv(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  await task.run(async () => {
    if (file.size > 1048576) throw new Error('CSV 最大 1 MB')
    csv.value = await file.text()
    preview.value = null
  })
}
async function previewImport() {
  await task.run(async () => {
    const storeId = selected.value
    const result = await service.preview(storeId, csv.value)
    if (storeId === selected.value) preview.value = { ...result, storeId }
  })
}
async function confirmImport() {
  await task.run(async () => {
    const p = preview.value
    if (!p || p.storeId !== selected.value) throw new Error('请重新预览当前店铺的 CSV')
    await runtime.run({
      action: 'import-products',
      storeId: p.storeId,
      values: { csv: csv.value, revision: p.revision, mode: mode.value, confirmed: true },
    })
    preview.value = null
    page.value = 1
    await load()
    task.message.value = '商品知识已导入。'
  })
}
async function exportCsv() {
  await task.run(async () => {
    const result = await runtime.run({ action: 'export-products', storeId: selected.value })
    if (typeof result.data.csv !== 'string') throw new Error('导出内容无效')
    downloadText('商品知识.csv', result.data.csv, 'text/csv;charset=utf-8')
  })
}
</script>
<template>
  <RuntimePanel
    title="店铺与商品"
    description="店铺和商品知识保存在本机；商品资料用于本店接待与训练，不会修改平台商品。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <template #actions
      ><el-button @click="router.push('/shop/manage?panel=shops')">返回店铺列表</el-button
      ><el-button type="primary" @click="adding = true">添加店铺</el-button
      ><el-button :disabled="task.pending.value" @click="runtime.refresh()"
        >刷新店铺</el-button
      ></template
    >
    <el-table :data="runtime.snapshot.stores" row-key="id" empty-text="尚未添加店铺">
      <el-table-column prop="storeName" label="店铺" /><el-table-column
        prop="platform"
        label="平台"
      />
      <el-table-column prop="group" label="分组" />
      <el-table-column label="连接状态"
        ><template #default="{ row }">{{
          row.runtime.online ? '已连接' : row.runtime.open ? '等待登录或连接' : '未打开'
        }}</template></el-table-column
      >
      <el-table-column label="AI"
        ><template #default="{ row }">{{
          row.aiEnabled ? '已开启' : '关闭'
        }}</template></el-table-column
      >
      <el-table-column label="操作" width="330"
        ><template #default="{ row }"
          ><el-button link @click="runtime.selectedStoreId = row.id">查看商品知识</el-button
          ><el-button link :disabled="task.pending.value" @click="connectShop(row)"
            >连接店铺</el-button
          ><el-button link :disabled="task.pending.value" @click="groupShop(row)">分组</el-button
          ><el-button link type="danger" :disabled="task.pending.value" @click="removeShop(row)"
            >移除</el-button
          ></template
        ></el-table-column
      >
    </el-table>
    <div class="runtime-toolbar">
      <StoreSelect :disabled="task.pending.value" /><el-button
        type="primary"
        :disabled="!selected || task.pending.value"
        @click="edit()"
        >新增商品知识</el-button
      ><el-button :disabled="!selected || task.pending.value" @click="task.run(load)"
        >刷新商品</el-button
      ><el-button :disabled="!selected || task.pending.value" @click="exportCsv"
        >导出 CSV</el-button
      >
    </div>
    <el-table :data="rows" row-key="id" empty-text="暂无商品知识，可手动添加或导入 CSV"
      ><el-table-column prop="productId" label="商品编号" /><el-table-column
        prop="title"
        label="商品标题"
      /><el-table-column prop="price" label="价格资料" /><el-table-column label="状态"
        ><template #default="{ row }">{{
          row.enabled ? '启用' : '停用'
        }}</template></el-table-column
      ><el-table-column label="操作"
        ><template #default="{ row }"
          ><el-button link :disabled="task.pending.value" @click="edit(row)">编辑</el-button
          ><el-button link type="danger" :disabled="task.pending.value" @click="remove(row)"
            >删除</el-button
          ></template
        ></el-table-column
      ></el-table
    >
    <el-pagination
      v-model:current-page="page"
      :page-size="20"
      :total="total"
      layout="prev, pager, next, total"
      :disabled="task.pending.value"
    />
    <details class="runtime-card">
      <summary>CSV 导入（先预览，再确认）</summary>
      <p>
        文件包含 productId、title 列，可选 description、specifications、price、enabled。每批最多
        1000 条、1 MB。
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="导入商品 CSV"
        :disabled="task.pending.value || !selected"
        @change="readCsv"
      /><el-input
        v-model="csv"
        type="textarea"
        :rows="4"
        aria-label="商品 CSV 内容"
        :disabled="task.pending.value"
        @input="preview = null"
      />
      <div class="runtime-toolbar">
        <el-select v-model="mode" aria-label="重复商品处理"
          ><el-option value="skip" label="跳过重复编号" /><el-option
            value="replace"
            label="替换重复编号" /></el-select
        ><el-button :disabled="!csv || !selected || task.pending.value" @click="previewImport"
          >预览 CSV</el-button
        ><el-button type="primary" :disabled="!preview || task.pending.value" @click="confirmImport"
          >确认导入 {{ preview?.count ?? 0 }} 条</el-button
        >
      </div>
    </details>
    <AddShopDialog v-model="adding" />
    <el-dialog
      v-model="editing"
      title="商品知识"
      width="650px"
      append-to-body
      :close-on-click-modal="!task.pending.value"
      ><el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
      <form class="runtime-form" @submit.prevent="save">
        <label
          >商品编号<el-input
            v-model="draft.productId"
            aria-label="商品编号"
            maxlength="100" /></label
        ><label
          >商品标题<el-input v-model="draft.title" aria-label="商品标题" maxlength="200" /></label
        ><label
          >商品说明<el-input
            v-model="draft.description"
            type="textarea"
            :rows="4"
            aria-label="商品说明"
            maxlength="6000" /></label
        ><label
          >规格资料<el-input
            v-model="draft.specifications"
            type="textarea"
            aria-label="规格资料"
            maxlength="3000" /></label
        ><label
          >价格资料<el-input v-model="draft.price" aria-label="价格资料" maxlength="80" /></label
        ><el-switch v-model="draft.enabled" active-text="用于知识检索" />
        <div class="runtime-actions">
          <el-button type="primary" native-type="submit" :loading="task.pending.value"
            >保存商品知识</el-button
          ><el-button :disabled="task.pending.value" @click="editing = false">取消</el-button>
        </div>
      </form></el-dialog
    >
  </RuntimePanel>
</template>
