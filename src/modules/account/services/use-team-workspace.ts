import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import {
  teamServiceKey,
  unavailableTeamService,
  type TeamAction,
  type TeamMembership,
  type TeamSnapshot,
} from './team-service'

const errors: Record<string, string> = {
  team_forbidden: '无此团队、店铺或操作权限，请刷新后核对授权',
  team_not_found: '团队记录不存在或已不可访问',
  team_revision_conflict: '团队已被其他成员修改，请刷新后核对并重新操作',
  team_invalid_request: '参数不合法，请核对账号编号、角色、店铺和内容',
  team_temporarily_unavailable: '团队服务暂时不可用，请稍后刷新核对结果',
}
export function useTeamWorkspace() {
  const runtime = useRuntimeStore()
  const service = inject(teamServiceKey, unavailableTeamService)
  const memberships = ref<TeamMembership[]>([]),
    snapshot = ref<TeamSnapshot | null>(null)
  const selectedId = ref(0),
    pending = ref(false),
    error = ref(''),
    message = ref('')
  const enabled = computed(
    () =>
      runtime.snapshot.managed.active.mode === 'managed' &&
      runtime.snapshot.managed.session.status === 'signed_in' &&
      !runtime.snapshot.managed.restartRequired &&
      service.available,
  )
  const unavailableReason = computed(() =>
    runtime.snapshot.managed.active.mode !== 'managed'
      ? '本机模式不提供跨账号团队授权和工单分配；本机工单仍可独立使用。'
      : !service.available
        ? '团队服务尚未接通，不能保存授权或执行团队分配。'
        : '请完成托管登录；来源或账号变更后须重启再使用团队。',
  )
  let epoch = 0
  const identityScope = () =>
    `${runtime.snapshot.workspaceId}|${runtime.snapshot.managed.active.apiOrigin}|${runtime.snapshot.managed.session.account?.userId}|${enabled.value}`
  function clear() {
    epoch++
    memberships.value = []
    snapshot.value = null
    selectedId.value = 0
    pending.value = false
    error.value = ''
    message.value = ''
  }
  watch(identityScope, clear)
  onBeforeUnmount(clear)
  async function run(work: (current: () => boolean) => Promise<void>) {
    if (pending.value || !enabled.value) return
    const generation = epoch
    const initialScope = identityScope()
    pending.value = true
    error.value = ''
    message.value = ''
    const current = () => generation === epoch && enabled.value && initialScope === identityScope()
    try {
      await work(current)
    } catch (cause) {
      if (current()) {
        const text = cause instanceof Error ? cause.message : String(cause)
        error.value = errors[text] || text
      }
    } finally {
      if (current()) pending.value = false
    }
  }
  async function reload(current: () => boolean) {
    const list = await service.list()
    if (!current()) return
    memberships.value = list
    if (!list.some((x) => x.team.id === selectedId.value && x.member.state === 'active'))
      selectedId.value = list.find((x) => x.member.state === 'active')?.team.id || 0
    snapshot.value = null
    if (selectedId.value) {
      const next = await service.snapshot(selectedId.value)
      if (current()) snapshot.value = next
    }
  }
  const refresh = () => run(reload)
  const select = (id: number) =>
    run(async (current) => {
      snapshot.value = null
      selectedId.value = id
      const next = await service.snapshot(id)
      if (current()) snapshot.value = next
    })
  const create = (name: string) =>
    run(async (current) => {
      const team = await service.create(name)
      if (!current()) return
      selectedId.value = team.id
      await reload(current)
    })
  const accept = (id: number) =>
    run(async (current) => {
      await service.accept(id)
      if (current()) {
        selectedId.value = id
        await reload(current)
      }
    })
  const execute = (action: TeamAction) =>
    run(async (current) => {
      const initial = snapshot.value
      if (!initial) throw new Error('请先选择并刷新团队')
      await service.execute(initial.team.id, { ...action, revision: initial.team.revision })
      if (!current()) return
      message.value = '服务端已保存；以下列表来自最新团队快照。'
      snapshot.value = null
      try {
        const next = await service.snapshot(initial.team.id)
        if (current()) snapshot.value = next
      } catch (cause) {
        if (current())
          message.value = '服务端已保存，但最新列表刷新失败。请先刷新核对，勿重复提交。'
        throw cause
      }
    })
  return {
    enabled,
    unavailableReason,
    memberships,
    snapshot,
    selectedId,
    pending,
    error,
    message,
    refresh,
    select,
    create,
    accept,
    execute,
  }
}
