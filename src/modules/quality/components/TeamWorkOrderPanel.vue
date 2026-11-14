<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useTeamWorkspace, type TeamTicket } from '@/modules/account'
const team = useTeamWorkspace()
const shopId = ref(''),
  text = ref(''),
  search = ref(''),
  selected = ref(0),
  note = ref('')
const statuses = { pending: '待处理', working: '处理中', waiting: '等待跟进', done: '已完成' }
const manager = computed(() => ['owner', 'admin'].includes(team.snapshot.value?.self.role || ''))
const readonly = computed(() => team.snapshot.value?.self.role === 'auditor')
const tickets = computed(
  () =>
    team.snapshot.value?.tickets.filter(
      (ticket) =>
        (!shopId.value || ticket.shopId === shopId.value) && ticket.text.includes(search.value),
    ) || [],
)
const current = computed(() =>
  team.snapshot.value?.tickets.find((ticket) => ticket.id === selected.value),
)
const notes = computed(
  () =>
    team.snapshot.value?.notes
      .filter((entry) => entry.ticketId === selected.value)
      .slice()
      .reverse() || [],
)
watch(team.selectedId, () => {
  shopId.value = ''
  selected.value = 0
  note.value = ''
  text.value = ''
})
watch(team.enabled, (enabled) => {
  if (enabled) void team.refresh()
})
onMounted(() => {
  void team.refresh()
})
function canEdit(ticket: TeamTicket) {
  return !readonly.value && (manager.value || ticket.assignee === team.snapshot.value?.self.userId)
}
function assignees(ticket: TeamTicket) {
  return (
    team.snapshot.value?.members.filter(
      (member) =>
        member.state === 'active' &&
        member.role !== 'auditor' &&
        (['owner', 'admin'].includes(member.role) ||
          team.snapshot.value?.grants.some(
            (grant) => grant.userId === member.userId && grant.shopId === ticket.shopId,
          )),
    ) || []
  )
}
async function create() {
  await team.execute({ action: 'create-ticket', shopId: shopId.value, text: text.value })
  if (!team.error.value) text.value = ''
}
async function addNote() {
  await team.execute({ action: 'note', ticketId: selected.value, text: note.value })
  if (!team.error.value) note.value = ''
}
function openNotes(ticket: TeamTicket) {
  selected.value = ticket.id
  note.value = ''
}
</script>
<template>
  <RuntimePanel
    title="团队工单"
    description="工单保存在托管服务端，按团队与店铺授权隔离；不会自动同步本机工单或执行平台售后操作。"
    :error="team.error.value"
    :message="team.message.value"
  >
    <template #actions
      ><el-button
        :disabled="!team.enabled.value"
        :loading="team.pending.value"
        @click="team.refresh"
        >刷新团队工单</el-button
      ></template
    >
    <el-alert
      v-if="!team.enabled.value"
      :title="team.unavailableReason.value"
      type="info"
      :closable="false"
    />
    <template v-else>
      <div class="runtime-toolbar">
        <el-select
          :model-value="team.selectedId.value || undefined"
          aria-label="工单所属团队"
          placeholder="选择团队"
          :disabled="team.pending.value"
          @change="team.select"
          ><el-option
            v-for="entry in team.memberships.value.filter((x) => x.member.state === 'active')"
            :key="entry.team.id"
            :label="entry.team.name"
            :value="entry.team.id"
        /></el-select>
        <el-select
          v-model="shopId"
          aria-label="团队工单店铺"
          placeholder="选择店铺"
          clearable
          :disabled="team.pending.value"
          ><el-option
            v-for="shop in team.snapshot.value?.shops || []"
            :key="shop.id"
            :label="shop.name"
            :value="shop.id"
        /></el-select>
        <el-input v-model="search" aria-label="搜索团队工单" placeholder="搜索工单说明" />
      </div>
      <template v-if="team.snapshot.value">
        <p>
          显示当前授权范围内最新 200 条工单、最新 500
          条跟进。主管分配后，客服才能变更状态和添加跟进。
        </p>
        <form v-if="!readonly" class="team-ticket-create" @submit.prevent="create">
          <el-input
            v-model="text"
            type="textarea"
            aria-label="团队工单说明"
            placeholder="填写工单说明（先选择店铺）"
            maxlength="4000"
          /><el-button
            native-type="submit"
            :disabled="!shopId || !text.trim() || team.pending.value"
            >登记团队工单</el-button
          >
        </form>
        <el-table :data="tickets" row-key="id" empty-text="暂无可访问团队工单">
          <el-table-column prop="id" label="编号" width="80" /><el-table-column
            prop="shopId"
            label="店铺"
          /><el-table-column prop="text" label="说明" min-width="220" />
          <el-table-column label="分配" min-width="150"
            ><template #default="{ row }"
              ><el-select
                v-if="manager"
                :model-value="row.assignee"
                aria-label="分配团队工单"
                :disabled="team.pending.value"
                @change="
                  (userId: number) => team.execute({ action: 'assign', ticketId: row.id, userId })
                "
                ><el-option label="未分配" :value="0" /><el-option
                  v-for="member in assignees(row)"
                  :key="member.userId"
                  :label="`账号 ${member.userId}`"
                  :value="member.userId" /></el-select
              ><span v-else>{{ row.assignee ? `账号 ${row.assignee}` : '未分配' }}</span></template
            ></el-table-column
          >
          <el-table-column label="状态" min-width="150"
            ><template #default="{ row }"
              ><el-select
                :model-value="row.status"
                aria-label="团队工单状态"
                :disabled="team.pending.value || !canEdit(row)"
                @change="
                  (status: TeamTicket['status']) =>
                    team.execute({ action: 'status', ticketId: row.id, status })
                "
                ><el-option
                  v-for="(label, status) in statuses"
                  :key="status"
                  :label="label"
                  :value="status" /></el-select></template
          ></el-table-column>
          <el-table-column label="跟进"
            ><template #default="{ row }"
              ><el-button @click="openNotes(row)">查看跟进</el-button></template
            ></el-table-column
          >
        </el-table>
      </template>
      <el-empty
        v-else-if="!team.pending.value"
        description="暂无已加入的团队，请在团队权限页面创建或接受邀请"
      />
    </template>
    <el-dialog
      :model-value="Boolean(current)"
      title="团队工单跟进"
      append-to-body
      @update:model-value="
        (value: boolean) => {
          if (!value) selected = 0
        }
      "
    >
      <template v-if="current"
        ><p>{{ current.text }}</p>
        <ol>
          <li v-for="entry in notes" :key="entry.id">账号 {{ entry.userId }}：{{ entry.text }}</li>
        </ol>
        <el-empty v-if="!notes.length" description="暂无可见跟进记录" />
        <form v-if="canEdit(current)" @submit.prevent="addNote">
          <el-input
            v-model="note"
            type="textarea"
            aria-label="团队工单跟进内容"
            maxlength="2000"
          /><el-button native-type="submit" :disabled="!note.trim() || team.pending.value"
            >添加跟进</el-button
          >
        </form></template
      >
    </el-dialog>
  </RuntimePanel>
</template>
<style scoped>
.runtime-toolbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.runtime-toolbar .el-select,
.runtime-toolbar .el-input {
  width: 220px;
}
.team-ticket-create {
  display: flex;
  gap: 12px;
  margin: 16px 0;
  align-items: center;
}
p,
li {
  line-height: 1.7;
}
</style>
