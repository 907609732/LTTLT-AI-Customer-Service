import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { useRuntimeStore } from '../src/shared/state/runtime'
import TeamPanel from '../src/modules/account/components/TeamPanel.vue'
import TeamWorkOrderPanel from '../src/modules/quality/components/TeamWorkOrderPanel.vue'
import { useTeamWorkspace } from '../src/modules/account/services/use-team-workspace'
import {
  teamServiceKey,
  type TeamService,
  type TeamSnapshot,
} from '../src/modules/account/services/team-service'

const snapshot = (): TeamSnapshot => ({
  team: { id: 1, ownerId: 1, name: '客服组', revision: 3 },
  self: { teamId: 1, userId: 1, role: 'owner', state: 'active' },
  members: [{ teamId: 1, userId: 1, role: 'owner', state: 'active' }],
  shops: [{ teamId: 1, id: 'a', name: 'A店' }],
  grants: [],
  tickets: [],
  notes: [],
  audits: [],
})
function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.workspaceId = 'managed-user-1'
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 1,
    displayName: '所有者',
    trial: { limit: 1, used: 0, reserved: 0, remaining: 1, expiresAt: 9999999999 },
  }
  const snap = snapshot()
  const service: TeamService = {
    available: true,
    list: vi.fn(async () => [{ team: snap.team, member: snap.self }]),
    snapshot: vi.fn(async () => snap),
    create: vi.fn(async () => snap.team),
    accept: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
  }
  return { runtime, service }
}
describe('team permission UI and workspace lifecycle', () => {
  it('shows local-mode limitations and performs no team requests', async () => {
    const { runtime, service } = fixture()
    runtime.snapshot.managed.active.mode = 'local'
    const wrapper = mount(TeamPanel, {
      global: { plugins: [ElementPlus], provide: { [teamServiceKey as symbol]: service } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('本机模式不提供跨账号团队授权')
    expect(service.list).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="邀请账号编号"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('lists invitations and accepts only the clicked team through its service', async () => {
    const { service } = fixture()
    const snap = snapshot()
    const invited = { ...snap.self, state: 'invited' as const }
    service.list = vi
      .fn()
      .mockResolvedValueOnce([{ team: snap.team, member: invited }])
      .mockResolvedValue([{ team: snap.team, member: snap.self }])
    const wrapper = mount(TeamPanel, {
      global: { plugins: [ElementPlus], provide: { [teamServiceKey as symbol]: service } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('收到「客服组」邀请')
    const button = wrapper.findAll('button').find((entry) => entry.text() === '接受邀请并加入')
    expect(button).toBeDefined()
    await button!.trigger('click')
    await flushPromises()
    expect(service.accept).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('当前身份：所有者')
    wrapper.unmount()
  })
  it('drops late snapshots after account change and clears the prior tenant', async () => {
    const { runtime, service } = fixture()
    let resolve: (value: TeamSnapshot) => void = () => {}
    service.snapshot = vi.fn(
      () =>
        new Promise<TeamSnapshot>((done) => {
          resolve = done
        }),
    )
    let team: ReturnType<typeof useTeamWorkspace> | undefined
    const Harness = defineComponent({
      setup() {
        team = useTeamWorkspace()
        return () => ''
      },
    })
    const wrapper = mount(Harness, { global: { provide: { [teamServiceKey as symbol]: service } } })
    const request = team!.refresh()
    await flushPromises()
    runtime.snapshot.managed.session.account!.userId = 2
    resolve(snapshot())
    await request
    await nextTick()
    expect(team!.snapshot.value).toBeNull()
    expect(team!.memberships.value).toEqual([])
    expect(team!.selectedId.value).toBe(0)
    wrapper.unmount()
  })
  it('tells users a committed mutation needs a refresh when its follow-up read fails', async () => {
    const { service } = fixture()
    service.snapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValue(new Error('offline'))
    let team: ReturnType<typeof useTeamWorkspace> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          team = useTeamWorkspace()
          return () => ''
        },
      }),
      { global: { provide: { [teamServiceKey as symbol]: service } } },
    )
    await team!.refresh()
    await team!.execute({ action: 'register-shop', shopId: 'b', name: 'B店' })
    expect(service.execute).toHaveBeenCalledWith(1, {
      action: 'register-shop',
      revision: 3,
      shopId: 'b',
      name: 'B店',
    })
    expect(team!.message.value).toContain('服务端已保存，但最新列表刷新失败')
    expect(team!.snapshot.value).toBeNull()
    wrapper.unmount()
  })
  it('hides creation and assignment controls for the read-only quality role', async () => {
    const { service } = fixture()
    const snap = snapshot()
    snap.self.role = 'auditor'
    snap.tickets = [
      {
        id: 1,
        teamId: 1,
        shopId: 'a',
        text: '待核对',
        status: 'pending',
        assignee: 2,
        createdBy: 1,
      },
    ]
    service.snapshot = vi.fn(async () => snap)
    const wrapper = mount(TeamWorkOrderPanel, {
      global: { plugins: [ElementPlus], provide: { [teamServiceKey as symbol]: service } },
    })
    await flushPromises()
    expect(wrapper.find('[aria-label="团队工单说明"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="分配团队工单"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('当前授权范围内最新 200 条工单')
    expect(service.execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
