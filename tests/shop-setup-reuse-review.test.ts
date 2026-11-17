import { expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useShopSetupStore } from '../src/modules/shops/setup-store'
import { profileSchema, type ModelProfile } from '../src/shared/contracts/backend'

async function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'review-workspace'
  runtime.snapshot.stores = ['target', 'source'].map((id) => ({
    id,
    storeName: id,
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: true, online: true },
  }))
  runtime.snapshot.welcomeByStore = {
    target: { text: '磁盘欢迎', enabled: false, version: 3 },
    source: { text: '来源欢迎', enabled: true, version: 9 },
  }
  runtime.snapshot.handoffByStore = {
    target: { keywords: ['本店人工'] },
    source: { keywords: ['来源人工'] },
  }
  const state = {
    revision: 0,
    profiles: [] as ModelProfile[],
    bindings: {} as Record<string, string>,
    globalPrompt: '',
    globalMaxReplyChars: 200,
  }
  let pauseNextList: Promise<void> | undefined
  const run = vi.spyOn(runtime, 'run').mockImplementation(async (command) => {
    if (command.action === 'list-model-profiles') {
      const pause = pauseNextList
      pauseNextList = undefined
      await pause
      return { status: 'ok', message: '', data: structuredClone(state) }
    }
    if (command.action === 'save-model-profile') {
      const profile = profileSchema.parse({
        id: `profile-${state.profiles.length + 1}`,
        version: 1,
        ...command.values,
      })
      state.profiles.push(profile)
      state.revision++
      return { status: 'ok', message: '', data: { ...profile } }
    }
    if (command.action === 'bind-model-profile') {
      state.bindings[command.storeId!] = String(command.values?.profileId)
      state.revision++
      return { status: 'ok', message: '', data: {} }
    }
    if (command.action === 'save-welcome') {
      const id = command.storeId!
      const previous = runtime.snapshot.welcomeByStore[id]!
      expect(command.values?.version).toBe(previous.version)
      runtime.snapshot.welcomeByStore[id] = {
        text: String(command.values?.text),
        enabled: Boolean(command.values?.enabled),
        version: previous.version + 1,
      }
      return { status: 'ok', message: '', data: {} }
    }
    if (command.action === 'save-store-handoff') {
      const id = command.storeId!
      if (command.values?.mode === 'inherit') delete runtime.snapshot.handoffByStore[id]
      else
        runtime.snapshot.handoffByStore[id] = {
          keywords: [...(command.values?.keywords as string[])],
        }
      return { status: 'ok', message: '', data: {} }
    }
    throw Error(`非预期命令 ${command.action}`)
  })
  const setup = useShopSetupStore()
  setup.open('target')
  await setup.loadRules()
  Object.assign(setup.draft, {
    origins: ['浙江'],
    carriers: ['中通'],
    designatedCourier: false,
    dispatchTime: '24小时内',
    freightInsurance: false,
  })
  async function importSource(reception = true) {
    setup.openReuse()
    await setup.selectReuseSource('source')
    setup.reuse.selection = {
      style: true,
      logistics: false,
      reception,
      afterSales: false,
    }
    setup.reuse.replaceConfirm = true
    expect(setup.applyReuse()).toBe(true)
  }
  return {
    setup,
    runtime,
    run,
    importSource,
    pauseSave() {
      let release!: () => void
      pauseNextList = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    },
  }
}

it('重复导入未勾选接待时保留已编辑但未保存的接待草稿及统一保存状态', async () => {
  const { setup, runtime, importSource } = await fixture()
  await importSource()
  setup.updateReceptionPart('welcome', { text: '编辑后的未保存欢迎', enabled: true })
  setup.updateReceptionPart('handoff', { inherited: false, keywords: ['编辑后的人工'] })
  await importSource(false)
  expect(runtime.snapshot.welcomeByStore.target?.text).toBe('磁盘欢迎')
  expect(setup.reuseApplied?.reception.welcome.text).toBe('编辑后的未保存欢迎')
  expect(setup.reuseApplied?.reception.handoff.keywords).toEqual(['编辑后的人工'])
  expect(setup.receptionDeferred).toBe(true)
})

it('保存进行中不能撤销复用并丢失正在写入的草稿状态', async () => {
  const { setup, runtime, importSource, pauseSave } = await fixture()
  await importSource()
  const applied = setup.reuseApplied
  const release = pauseSave()
  const saving = setup.saveRules()
  expect(setup.saving).toBe(true)
  setup.removeReuse()
  const afterUndo = setup.reuseApplied
  release()
  await saving
  expect(runtime.snapshot.welcomeByStore.target?.text).toBe('来源欢迎')
  expect(afterUndo).toBe(applied)
  expect(setup.reuseApplied?.parts.welcome).toBe('saved')
})

it('再次导入的来源欢迎缺项时保留先前草稿、保存状态与冲突基线', async () => {
  const { setup, runtime, importSource } = await fixture()
  await importSource()
  setup.updateReceptionPart('welcome', { text: '保留的欢迎草稿', enabled: true })
  const baseline = setup.reuseApplied!.baseline.welcome.version
  delete runtime.snapshot.welcomeByStore.source
  runtime.snapshot.welcomeByStore.target = { text: '他处更新', enabled: true, version: 4 }
  await importSource()
  expect(setup.reuseApplied?.reception.welcome.text).toBe('保留的欢迎草稿')
  expect(setup.reuseApplied?.baseline.welcome.version).toBe(baseline)
  expect(setup.reuseApplied?.parts.welcome).toBe('pending')
  expect(await setup.saveRules()).toBe(false)
  expect(setup.error).toContain('欢迎语')
})

it('部分保存成功后重新编辑所有项目仍不能撤销已发生的写入', async () => {
  const { setup, runtime, importSource } = await fixture()
  await importSource()
  setup.updateReceptionPart('welcome', { text: 'x'.repeat(201), enabled: true })
  expect(await setup.saveRules()).toBe(false)
  expect(setup.reuseApplied?.parts.policy).toBe('saved')
  expect(setup.reuseApplied?.parts.handoff).toBe('saved')
  setup.draft.style = 'warm'
  setup.updateReceptionPart('handoff', { inherited: false, keywords: ['再次编辑'] })
  expect(setup.reuseApplied?.parts).toEqual({
    policy: 'pending',
    welcome: 'pending',
    handoff: 'pending',
  })
  const applied = setup.reuseApplied
  setup.removeReuse()
  expect(setup.reuseApplied).toBe(applied)
  expect(runtime.snapshot.handoffByStore.target?.keywords).toEqual(['来源人工'])
})

it('来源 B→C→B 读取乱序时只接收最后一次选择的响应', async () => {
  const { setup, runtime, run } = await fixture()
  runtime.snapshot.stores.push({
    id: 'source-c',
    storeName: '来源C',
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: true, online: true },
  })
  const replies: ((prompt: string) => void)[] = []
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        replies.push((prompt) =>
          resolve({
            status: 'ok',
            message: '',
            data: {
              revision: 0,
              profiles: [],
              bindings: {},
              globalPrompt: prompt,
              globalMaxReplyChars: 200,
            },
          }),
        )
      }),
  )
  setup.openReuse()
  const firstB = setup.selectReuseSource('source')
  const sourceC = setup.selectReuseSource('source-c')
  const lastB = setup.selectReuseSource('source')
  replies[2]!('最后一次B响应')
  await lastB
  expect(setup.reuse.loaded?.draft.customPrompt).toBe('最后一次B响应')
  replies[0]!('第一次B迟到响应')
  replies[1]!('C迟到响应')
  await Promise.all([firstB, sourceC])
  expect(setup.reuse.loaded?.draft.customPrompt).toBe('最后一次B响应')
  expect(setup.reuse.loading).toBe(false)
})
