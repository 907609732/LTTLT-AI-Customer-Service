<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useTeamWorkspace } from '../services/use-team-workspace'
import type { TeamMember, TeamSnapshot } from '../services/team-service'
const team = useTeamWorkspace()
const name = ref(''),
  memberId = ref(0)
const invitation = reactive({ userId: 0, role: 'agent' as 'admin' | 'agent' | 'auditor' })
const shop = reactive({ id: '', name: '' })
const roles = { owner: '所有者', admin: '主管', agent: '客服', auditor: '只读质检' }
const owner = computed(() => team.snapshot.value?.self.role === 'owner')
const member = computed(() =>
  team.snapshot.value?.members.find((row) => row.userId === memberId.value),
)
watch(team.selectedId, () => {
  memberId.value = 0
})
watch(team.enabled, (enabled) => {
  if (enabled) void team.refresh()
})
onMounted(() => {
  void team.refresh()
})
function hasGrant(shopId: string) {
  return (
    team.snapshot.value?.grants.some(
      (grant) => grant.userId === memberId.value && grant.shopId === shopId,
    ) || false
  )
}
function changeMember(row: TeamMember, role: string, active: boolean) {
  if (role !== 'admin' && role !== 'agent' && role !== 'auditor') return
  void team.execute({ action: 'member', userId: row.userId, role, active })
}
function auditResult(row: TeamSnapshot['audits'][number]) {
  if (row.action === 'grant') return row.allowed ? '允许访问' : '撤销访问'
  if (row.action === 'member')
    return `${row.active ? '角色变更' : '停用/撤销'}：${roles[row.role as keyof typeof roles] || row.role}`
  if (row.action === 'invite')
    return `邀请角色：${roles[row.role as keyof typeof roles] || row.role}`
  if (row.action === 'status') return row.status
  return ''
}
</script>
<template>
  <RuntimePanel
    title="团队权限与店铺授权"
    description="团队数据由服务端校验角色与店铺范围。店铺登记和授权仅作用于软件团队记录，不代表已登录电商平台。"
    :error="team.error.value"
    :message="team.message.value"
  >
    <template #actions
      ><el-button
        :disabled="!team.enabled.value"
        :loading="team.pending.value"
        @click="team.refresh"
        >刷新团队</el-button
      ></template
    >
    <div class="tp team-workspace" data-v-2b4c59f2="">
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
            aria-label="选择团队"
            placeholder="选择已加入团队"
            :disabled="team.pending.value"
            @change="team.select"
          >
            <el-option
              v-for="entry in team.memberships.value.filter((x) => x.member.state === 'active')"
              :key="entry.team.id"
              :label="entry.team.name"
              :value="entry.team.id"
            />
          </el-select>
          <form class="team-inline" @submit.prevent="team.create(name)">
            <el-input
              v-model="name"
              aria-label="新团队名称"
              placeholder="新团队名称"
              maxlength="80"
            /><el-button native-type="submit" :disabled="!name.trim() || team.pending.value"
              >创建团队</el-button
            >
          </form>
        </div>
        <div
          v-for="entry in team.memberships.value.filter((x) => x.member.state === 'invited')"
          :key="entry.team.id"
          class="team-invitation"
        >
          <span>收到「{{ entry.team.name }}」邀请，角色：{{ roles[entry.member.role] }}</span
          ><el-button :disabled="team.pending.value" @click="team.accept(entry.team.id)"
            >接受邀请并加入</el-button
          >
        </div>
        <template v-if="team.snapshot.value">
          <p>
            当前身份：{{ roles[team.snapshot.value.self.role] }} · 版本
            {{ team.snapshot.value.team.revision }}
          </p>
          <el-alert
            title="所有者管理成员与店铺；主管分配工单；客服只处理已分配且获店铺授权的工单；质检仅查看获授权店铺。变更角色会清除原店铺授权并回收工单分配。"
            type="info"
            :closable="false"
          />
          <h2>团队成员</h2>
          <form
            v-if="owner"
            class="team-inline"
            @submit.prevent="
              team.execute({ action: 'invite', userId: invitation.userId, role: invitation.role })
            "
          >
            <label
              >已有托管账号编号<el-input-number
                v-model="invitation.userId"
                :min="1"
                :max="2147483647"
                aria-label="邀请账号编号"
            /></label>
            <el-select v-model="invitation.role" aria-label="邀请角色"
              ><el-option
                v-for="role in ['admin', 'agent', 'auditor'] as const"
                :key="role"
                :label="roles[role]"
                :value="role"
            /></el-select>
            <el-button native-type="submit" :disabled="invitation.userId < 1 || team.pending.value"
              >发送团队邀请</el-button
            >
          </form>
          <p v-if="owner">仅邀请已注册且启用的账号；对方接受后生效，不代发短信、不自动注册账号。</p>
          <el-table :data="team.snapshot.value.members" row-key="userId" empty-text="没有成员">
            <el-table-column prop="userId" label="账号编号" width="120" />
            <el-table-column label="角色"
              ><template #default="{ row }"
                ><span>{{ roles[row.role as keyof typeof roles] }}</span></template
              ></el-table-column
            >
            <el-table-column label="状态"
              ><template #default="{ row }">{{
                row.state === 'active'
                  ? '已加入'
                  : row.state === 'invited'
                    ? '待接受邀请'
                    : '已停用'
              }}</template></el-table-column
            >
            <el-table-column v-if="owner" label="管理" min-width="320"
              ><template #default="{ row }">
                <template v-if="row.role !== 'owner' && row.state === 'active'">
                  <el-select
                    :model-value="row.role"
                    aria-label="修改成员角色"
                    :disabled="team.pending.value"
                    @change="(value: string) => changeMember(row, value, true)"
                    ><el-option
                      v-for="role in ['admin', 'agent', 'auditor'] as const"
                      :key="role"
                      :label="roles[role]"
                      :value="role"
                  /></el-select>
                  <el-popconfirm
                    title="停用成员并回收其授权与工单分配？"
                    @confirm="changeMember(row, row.role, false)"
                    ><template #reference
                      ><el-button :disabled="team.pending.value" type="danger" text
                        >停用</el-button
                      ></template
                    ></el-popconfirm
                  >
                  <el-button
                    v-if="row.role === 'agent' || row.role === 'auditor'"
                    :disabled="team.pending.value"
                    @click="memberId = row.userId"
                    >店铺授权</el-button
                  >
                </template>
                <el-button
                  v-else-if="row.state === 'invited'"
                  :disabled="team.pending.value"
                  @click="changeMember(row, row.role, false)"
                  >撤销邀请</el-button
                >
              </template></el-table-column
            >
          </el-table>
          <h2>团队店铺</h2>
          <form
            v-if="owner"
            class="team-inline"
            @submit.prevent="
              team.execute({ action: 'register-shop', shopId: shop.id, name: shop.name })
            "
          >
            <el-input
              v-model="shop.id"
              aria-label="团队店铺标识"
              placeholder="团队内唯一店铺标识"
              maxlength="128"
            /><el-input
              v-model="shop.name"
              aria-label="团队店铺名称"
              placeholder="店铺名称"
              maxlength="80"
            /><el-button
              native-type="submit"
              :disabled="!shop.id.trim() || !shop.name.trim() || team.pending.value"
              >登记团队店铺</el-button
            >
          </form>
          <p v-if="member">
            正在管理账号 {{ member.userId }} 的店铺范围；撤销授权会将该店工单回收为未分配。
          </p>
          <el-table :data="team.snapshot.value.shops" row-key="id" empty-text="暂无可访问的团队店铺"
            ><el-table-column prop="name" label="店铺名称" /><el-table-column
              prop="id"
              label="团队店铺标识"
            /><el-table-column v-if="owner && member" label="此成员授权"
              ><template #default="{ row }"
                ><el-checkbox
                  :model-value="hasGrant(row.id)"
                  :disabled="team.pending.value"
                  @change="
                    (allowed: unknown) =>
                      team.execute({
                        action: 'grant',
                        userId: memberId,
                        shopId: row.id,
                        allowed: Boolean(allowed),
                      })
                  "
                  >允许访问</el-checkbox
                ></template
              ></el-table-column
            ></el-table
          >
          <template v-if="team.snapshot.value.audits.length"
            ><h2>最近操作审计（最多 100 条）</h2>
            <el-table :data="team.snapshot.value.audits" row-key="id"
              ><el-table-column prop="actor" label="操作账号" /><el-table-column
                prop="action"
                label="操作" /><el-table-column prop="userId" label="目标账号" /><el-table-column
                prop="shopId"
                label="店铺标识" /><el-table-column
                prop="ticketId"
                label="工单编号" /><el-table-column
                label="变更结果"
                :formatter="auditResult" /></el-table
          ></template>
        </template>
        <el-empty
          v-else-if="!team.pending.value"
          description="尚未加入团队，可创建团队或接受定向邀请"
        />
      </template>
    </div>
  </RuntimePanel>
</template>
<style scoped>
.team-workspace {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.team-inline,
.team-invitation {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.team-inline .el-input,
.team-inline .el-select {
  width: 220px;
}
h2 {
  font-size: 17px;
  margin: 12px 0 0;
}
p {
  margin: 0;
  line-height: 1.7;
}
</style>
