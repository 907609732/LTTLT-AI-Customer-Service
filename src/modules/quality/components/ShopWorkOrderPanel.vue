<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import type { WorkOrder } from '@/shared/contracts/backend'
import TeamWorkOrderPanel from './TeamWorkOrderPanel.vue'
const scope = ref('local')
const runtime = useRuntimeStore(),
  task = useTask()
const creating = ref(false),
  selected = ref<WorkOrder | null>(null),
  note = ref(''),
  search = ref('')
const draft = reactive({
  type: '其他事项',
  orderNo: '',
  buyer: '',
  priority: 'normal',
  description: '',
})
const types = [
  '退款跟进',
  '补发登记',
  '换货登记',
  '物流异常',
  '修改地址',
  '发票登记',
  '差评处理',
  '买家投诉',
  '其他事项',
]
const statuses: Record<string, string> = {
  pending: '待处理',
  working: '处理中',
  waiting: '等待跟进',
  done: '已完成',
}
const orders = computed(() =>
  runtime.snapshot.workOrders.filter(
    (x) =>
      (!runtime.selectedStoreId || x.storeId === runtime.selectedStoreId) &&
      [x.orderNo, x.buyer, x.description].some((t) => t.includes(search.value)),
  ),
)
async function save() {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'create-work-order',
      values: { ...draft, storeId: runtime.selectedStoreId },
    })
    creating.value = false
    Object.assign(draft, {
      type: '其他事项',
      orderNo: '',
      buyer: '',
      priority: 'normal',
      description: '',
    })
    task.message.value = result.message
  })
}
async function status(row: WorkOrder, value: string) {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'set-work-order-status',
      values: { id: row.id, status: value },
    })
    task.message.value = result.message
  })
}
async function addNote() {
  await task.run(async () => {
    if (!selected.value) throw new Error('请选择工单')
    const id = selected.value.id
    await runtime.run({ action: 'add-work-order-note', values: { id, text: note.value } })
    selected.value = runtime.snapshot.workOrders.find((x) => x.id === id) || null
    note.value = ''
  })
}
</script>
<template>
  <el-radio-group v-model="scope" aria-label="工单数据范围" style="margin: 12px 24px">
    <el-radio-button value="local">本机工单</el-radio-button>
    <el-radio-button value="team">团队工单</el-radio-button>
  </el-radio-group>
  <TeamWorkOrderPanel v-if="scope === 'team'" />
  <RuntimePanel
    v-else
    title="工单登记"
    description="工单保存在本机，可跟进和变更状态；多人分配请切换到团队工单。平台同步尚未接入。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <template #actions
      ><el-button type="primary" :disabled="!runtime.selectedStoreId" @click="creating = true"
        >登记工单</el-button
      ></template
    >
    <div class="runtime-toolbar">
      <StoreSelect :disabled="task.pending.value" /><el-input
        v-model="search"
        placeholder="搜索订单号、买家、说明"
        aria-label="搜索工单"
        style="width: 300px"
      />
    </div>
    <el-table :data="orders" row-key="id" empty-text="暂无本机工单"
      ><el-table-column prop="orderNo" label="订单号" /><el-table-column
        prop="buyer"
        label="买家"
      /><el-table-column prop="type" label="类型" /><el-table-column label="状态" width="160"
        ><template #default="{ row }"
          ><el-select
            :model-value="row.status"
            :disabled="task.pending.value"
            @change="status(row, String($event))"
            ><el-option
              v-for="(label, value) in statuses"
              :key="value"
              :label="label"
              :value="value" /></el-select></template></el-table-column
      ><el-table-column label="详情"
        ><template #default="{ row }"
          ><el-button
            link
            @click="
              () => {
                selected = row
                note = ''
              }
            "
            >跟进记录</el-button
          ></template
        ></el-table-column
      ></el-table
    >
    <el-dialog v-model="creating" title="登记本机工单" width="620px" append-to-body
      ><el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
      <form class="runtime-form" @submit.prevent="save">
        <StoreSelect :disabled="task.pending.value" /><label
          >事项类型<el-select v-model="draft.type"
            ><el-option
              v-for="value in types"
              :key="value"
              :value="value"
              :label="value" /></el-select></label
        ><label
          >订单号<el-input v-model="draft.orderNo" aria-label="工单订单号" maxlength="100" /></label
        ><label>买家<el-input v-model="draft.buyer" maxlength="100" /></label
        ><label
          >紧急程度<el-select v-model="draft.priority"
            ><el-option value="normal" label="普通" /><el-option
              value="urgent"
              label="紧急" /></el-select></label
        ><label
          >事项说明<el-input
            v-model="draft.description"
            type="textarea"
            :rows="4"
            maxlength="2000" /></label
        ><el-button
          type="primary"
          native-type="submit"
          :loading="task.pending.value"
          :disabled="!runtime.selectedStoreId"
          >保存工单</el-button
        >
      </form></el-dialog
    >
    <el-dialog
      :model-value="Boolean(selected)"
      title="工单跟进"
      width="620px"
      append-to-body
      @update:model-value="$event || (selected = null)"
      ><template v-if="selected"
        ><p>{{ selected.orderNo }} · {{ selected.description }}</p>
        <div v-for="item in selected.notes" :key="item.id" class="runtime-message">
          {{ item.text }}
          <p class="runtime-muted">{{ new Date(item.at).toLocaleString() }}</p>
        </div>
        <form class="runtime-form" @submit.prevent="addNote">
          <el-input
            v-model="note"
            type="textarea"
            maxlength="2000"
            placeholder="填写跟进记录"
          /><el-button native-type="submit" :disabled="!note.trim()" :loading="task.pending.value"
            >添加跟进</el-button
          >
        </form></template
      ></el-dialog
    >
  </RuntimePanel>
</template>
