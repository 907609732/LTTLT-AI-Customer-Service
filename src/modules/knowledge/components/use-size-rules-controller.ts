import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProductCatalogRow } from '@/shared/contracts/product-catalog'
import {
  blankSizeRuleDraft,
  sizeUnitKeys,
  sizeUnitMeta,
  type SizeRuleBinding,
  type SizeRuleColumn,
  type SizeRuleFields,
  type SizeRulePreview,
  type SizeRuleRecord,
  type SizeRuleTemplateKind,
} from '@/shared/contracts/size-rules'
import { useRuntimeStore } from '@/shared/state/runtime'
import { downloadText } from '@/shared/platform/files'
import { createSizeRulesClient } from '../size-rules-service'

export type SizeRuleDraft = SizeRuleFields & {
  id?: string
  version?: number
  updatedAt?: number
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )

interface Owner {
  workspace: string
  request: number
  draft: number
}

/**
 * One owner for every asynchronous rule operation. Workspace change, component disposal,
 * a newer request or a user draft edit invalidates late success, failure and export results.
 */
export function useSizeRulesController() {
  const runtime = useRuntimeStore()
  const client = createSizeRulesClient((command) => runtime.run(command))
  const rules = ref<SizeRuleRecord[]>([])
  const revision = ref(0)
  const units = ref(
    sizeUnitKeys.map((value) => ({
      value,
      label: sizeUnitMeta[value].label,
      group: sizeUnitMeta[value].group,
    })),
  )
  const draft = ref<SizeRuleDraft>(blankSizeRuleDraft())
  const dirty = ref(false)
  const pending = ref(false)
  const error = ref('')
  const notice = ref('')
  const tableText = ref('')
  const preview = ref<SizeRulePreview | null>(null)
  const deleteTarget = ref<SizeRuleRecord | null>(null)
  const catalogStore = ref('')
  const catalogQuery = ref('')
  const catalogOffset = ref(0)
  const catalog = ref<ProductCatalogRow[]>([])
  const catalogTotal = ref(0)
  const catalogLoading = ref(false)

  let alive = true
  let workspaceGeneration = 0
  let requestGeneration = 0
  let draftGeneration = 0
  let rulesTicket = 0
  let catalogTicket = 0
  let resetting = false
  let queryTimer: ReturnType<typeof setTimeout> | undefined

  watch(
    draft,
    () => {
      if (!resetting) {
        dirty.value = true
        draftGeneration += 1
      }
    },
    { deep: true, flush: 'sync' },
  )

  const templates: { kind: SizeRuleTemplateKind; label: string }[] = [
    { kind: 'blank', label: '空白新建' },
    { kind: 'women', label: '女装草稿' },
    { kind: 'men', label: '男装草稿' },
    { kind: 'shoes', label: '鞋码草稿' },
    { kind: 'storage', label: '收纳箱草稿' },
  ]
  const unitOptions = computed(() => units.value.filter((unit) => unit.value !== 'none'))
  const stores = computed(() => runtime.snapshot.stores)
  const visibleBoundProducts = computed(() =>
    draft.value.bindings.map((binding) => ({
      ...binding,
      storeName:
        runtime.snapshot.stores.find((store) => store.id === binding.storeId)?.storeName ||
        binding.storeId,
    })),
  )

  function replaceDraft(value: SizeRuleDraft) {
    resetting = true
    draft.value = clone(value)
    draftGeneration += 1
    resetting = false
  }
  function owner(): Owner {
    return {
      workspace: runtime.snapshot.workspaceId,
      request: ++requestGeneration,
      draft: draftGeneration,
    }
  }
  function current(ownerValue: Owner, compareDraft = false): boolean {
    if (!alive) return false
    if (ownerValue.workspace !== runtime.snapshot.workspaceId) return false
    if (ownerValue.request !== requestGeneration) return false
    return !compareDraft || ownerValue.draft === draftGeneration
  }
  async function run(
    job: (ownerValue: Owner) => Promise<void>,
    compareDraft = false,
  ): Promise<boolean> {
    if (pending.value) return false
    const ownerValue = owner()
    pending.value = true
    error.value = ''
    notice.value = ''
    try {
      await job(ownerValue)
      if (!current(ownerValue, compareDraft)) return false
      return true
    } catch (cause) {
      if (current(ownerValue, compareDraft)) error.value = messageOf(cause)
      return false
    } finally {
      if (current(ownerValue)) pending.value = false
    }
  }

  async function loadRules() {
    const generation = workspaceGeneration
    const ticket = ++rulesTicket
    const workspace = runtime.snapshot.workspaceId
    try {
      const result = await client.list()
      if (
        !alive ||
        generation !== workspaceGeneration ||
        ticket !== rulesTicket ||
        workspace !== runtime.snapshot.workspaceId
      )
        return
      rules.value = result.rules
      revision.value = result.revision
      units.value = result.units
      if (!dirty.value && draft.value.id) {
        const currentRule = result.rules.find((rule) => rule.id === draft.value.id)
        if (currentRule) replaceDraft(currentRule)
      }
    } catch (cause) {
      if (alive && generation === workspaceGeneration && ticket === rulesTicket)
        error.value = messageOf(cause)
    }
  }

  function loadCatalog() {
    const ticket = ++catalogTicket
    const workspace = runtime.snapshot.workspaceId
    const storeId = catalogStore.value
    if (!storeId) {
      catalog.value = []
      catalogTotal.value = 0
      catalogLoading.value = false
      return
    }
    catalogLoading.value = true
    void client
      .products(storeId, catalogQuery.value, catalogOffset.value)
      .then((page) => {
        if (
          !alive ||
          ticket !== catalogTicket ||
          workspace !== runtime.snapshot.workspaceId ||
          storeId !== catalogStore.value
        )
          return
        catalog.value = page.items
        catalogTotal.value = page.total
      })
      .catch((cause) => {
        if (alive && ticket === catalogTicket && workspace === runtime.snapshot.workspaceId)
          error.value = messageOf(cause)
      })
      .finally(() => {
        if (alive && ticket === catalogTicket && workspace === runtime.snapshot.workspaceId)
          catalogLoading.value = false
      })
  }

  function setCatalogStore(storeId: string) {
    catalogStore.value = storeId
    catalogOffset.value = 0
    catalogQuery.value = ''
    loadCatalog()
  }
  function setCatalogQuery(query: string) {
    catalogQuery.value = query
    clearTimeout(queryTimer)
    queryTimer = setTimeout(() => {
      catalogOffset.value = 0
      loadCatalog()
    }, 180)
  }
  function pageCatalog(delta: number) {
    catalogOffset.value = Math.max(0, catalogOffset.value + delta)
    loadCatalog()
  }

  function pick(rule: SizeRuleRecord) {
    replaceDraft(rule)
    dirty.value = false
    preview.value = null
    deleteTarget.value = null
    error.value = ''
    notice.value = ''
  }

  function useTemplate(kind: SizeRuleTemplateKind) {
    void run(async (ownerValue) => {
      const result = await client.template(kind)
      if (!current(ownerValue, true)) return
      replaceDraft(result)
      dirty.value = true
      preview.value = null
      notice.value = '模板已放入未保存草稿；不会自动启用、绑定商品或开启 AI。'
    }, true)
  }

  function addColumn() {
    let number = 1
    while (draft.value.columns.some((column) => column.id === `c${number}`)) number += 1
    const id = `c${number}`
    draft.value.columns.push({ id, name: `参数${number}`, kind: 'number', unit: 'cm' })
    for (const row of draft.value.rows) row.values[id] = ''
  }
  function removeColumn(id: string) {
    if (draft.value.columns.length <= 1) return
    draft.value.columns = draft.value.columns.filter((column) => column.id !== id)
    for (const row of draft.value.rows) delete row.values[id]
  }
  function updateColumnKind(column: SizeRuleColumn) {
    if (column.kind === 'text') column.unit = 'none'
    else if (column.unit === 'none') column.unit = 'cm'
  }
  function addRow() {
    let number = 1
    while (draft.value.rows.some((row) => row.label === `规格${number}`)) number += 1
    draft.value.rows.push({
      label: `规格${number}`,
      values: Object.fromEntries(draft.value.columns.map((column) => [column.id, ''])),
    })
  }
  function removeRow(index: number) {
    if (draft.value.rows.length <= 1) return
    draft.value.rows.splice(index, 1)
  }
  function addMeasurement() {
    draft.value.measurements.push({ name: '', unit: 'cm' })
  }
  function removeMeasurement(index: number) {
    draft.value.measurements.splice(index, 1)
  }
  function bindingKey(binding: SizeRuleBinding) {
    return JSON.stringify([binding.storeId, binding.productId])
  }
  function ownerFor(binding: SizeRuleBinding) {
    const key = bindingKey(binding)
    return rules.value.find(
      (rule) =>
        rule.id !== draft.value.id && rule.bindings.some((item) => bindingKey(item) === key),
    )
  }
  function isBound(binding: SizeRuleBinding) {
    const key = bindingKey(binding)
    return draft.value.bindings.some((item) => bindingKey(item) === key)
  }
  function toggleBinding(binding: SizeRuleBinding, checked: boolean) {
    if (checked) {
      if (!isBound(binding)) draft.value.bindings.push({ ...binding })
    } else {
      const key = bindingKey(binding)
      draft.value.bindings = draft.value.bindings.filter((item) => bindingKey(item) !== key)
    }
  }
  function releaseBinding(binding: SizeRuleBinding) {
    toggleBinding(binding, false)
  }

  function fields(): SizeRuleFields {
    const { id: _id, version: _version, updatedAt: _updated, ...value } = draft.value
    void _id
    void _version
    void _updated
    return clone(value)
  }

  function persist() {
    void run(async (ownerValue) => {
      const value = fields()
      const result = await client.save({
        ...value,
        expectedRevision: revision.value,
        ...(draft.value.id && draft.value.version
          ? { id: draft.value.id, version: draft.value.version }
          : {}),
      })
      if (!current(ownerValue)) return
      revision.value = result.revision
      const index = rules.value.findIndex((rule) => rule.id === result.rule.id)
      if (index < 0) rules.value = [...rules.value, result.rule]
      else
        rules.value = rules.value.map((rule) => (rule.id === result.rule.id ? result.rule : rule))
      if (ownerValue.draft === draftGeneration) {
        replaceDraft(result.rule)
        dirty.value = false
        preview.value = null
        notice.value = result.rule.enabled
          ? '尺码规则已保存；AI 开关未改变，请核对后再用于接待。'
          : '尺码规则草稿已保存；未自动启用、绑定商品或开启 AI。'
      } else {
        notice.value = '尺码规则已保存；保存期间的新草稿仍保留，尚未写入。'
      }
    })
  }

  function confirmRemove() {
    const target = deleteTarget.value
    if (!target?.version) return
    void run(async (ownerValue) => {
      const result = await client.remove({
        id: target.id,
        version: target.version,
        expectedRevision: revision.value,
        confirmed: true,
      })
      if (!current(ownerValue)) return
      revision.value = result.revision
      rules.value = rules.value.filter((rule) => rule.id !== target.id)
      deleteTarget.value = null
      replaceDraft(blankSizeRuleDraft())
      dirty.value = false
      notice.value = '规则已删除，原商品绑定已解除。'
    })
  }

  function previewTable() {
    void run(async (ownerValue) => {
      const result = await client.preview(tableText.value)
      if (!current(ownerValue, true)) return
      preview.value = result
    }, true)
  }
  function usePreview() {
    if (!preview.value) return
    draft.value.columns = clone(preview.value.columns)
    draft.value.rows = clone(preview.value.rows)
    preview.value = null
    notice.value = '预览表格已放入草稿，尚未保存。'
  }
  function requestDelete() {
    if (draft.value.id && draft.value.version) deleteTarget.value = draft.value as SizeRuleRecord
  }
  function exportCsv() {
    if (!draft.value.id) {
      error.value = '请先保存规则再导出已保存表格'
      return
    }
    const id = draft.value.id
    void run(async (ownerValue) => {
      const result = await client.exportCsv(id)
      if (!current(ownerValue)) return
      downloadText('尺码规格表.csv', '\uFEFF' + result.csv, 'text/csv;charset=utf-8')
    })
  }

  watch(
    () => runtime.snapshot.workspaceId,
    () => {
      workspaceGeneration += 1
      requestGeneration += 1
      rulesTicket += 1
      catalogTicket += 1
      rules.value = []
      revision.value = 0
      replaceDraft(blankSizeRuleDraft())
      dirty.value = false
      preview.value = null
      deleteTarget.value = null
      tableText.value = ''
      error.value = ''
      notice.value = ''
      catalog.value = []
      catalogTotal.value = 0
      pending.value = false
      catalogStore.value = runtime.selectedStoreId || runtime.snapshot.stores[0]?.id || ''
      void loadRules()
      loadCatalog()
    },
  )
  watch(
    () => runtime.snapshot.stores.map((store) => store.id).join('\n'),
    () => {
      if (!runtime.snapshot.stores.some((store) => store.id === catalogStore.value)) {
        catalogStore.value = runtime.snapshot.stores[0]?.id ?? ''
        loadCatalog()
      }
    },
  )

  onMounted(() => {
    alive = true
    catalogStore.value = runtime.selectedStoreId || runtime.snapshot.stores[0]?.id || ''
    void loadRules()
    loadCatalog()
  })
  onBeforeUnmount(() => {
    alive = false
    workspaceGeneration += 1
    requestGeneration += 1
    rulesTicket += 1
    catalogTicket += 1
    clearTimeout(queryTimer)
  })

  return {
    rules,
    revision,
    units,
    draft,
    dirty,
    pending,
    error,
    notice,
    tableText,
    preview,
    deleteTarget,
    catalogStore,
    catalogQuery,
    catalogOffset,
    catalog,
    catalogTotal,
    catalogLoading,
    templates,
    unitOptions,
    stores,
    visibleBoundProducts,
    loadRules,
    loadCatalog,
    setCatalogStore,
    setCatalogQuery,
    pageCatalog,
    pick,
    useTemplate,
    addColumn,
    removeColumn,
    updateColumnKind,
    addRow,
    removeRow,
    addMeasurement,
    removeMeasurement,
    ownerFor,
    isBound,
    toggleBinding,
    releaseBinding,
    persist,
    confirmRemove,
    previewTable,
    usePreview,
    requestDelete,
    exportCsv,
  }
}
