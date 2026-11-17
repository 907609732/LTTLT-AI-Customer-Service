import { expect, it, vi } from 'vitest'
import type { CommandInput } from '../src/shared/contracts/backend'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useShopSetupStore } from '../src/modules/shops/setup-store'
import {
  createReceptionSetupSaver,
  readReceptionSetup,
  readReceptionSetupSource,
  type ReceptionSnapshot,
} from '../src/modules/reception/setup'

const snapshot = (): ReceptionSnapshot => ({
  welcomeByStore: {
    source: { text: '欢迎', enabled: true, version: 9, delayMinSeconds: 5, delayMaxSeconds: 9 },
    target: { text: '原文', enabled: false, version: 2 },
  },
  handoffByStore: {},
})

it('welcome reuse keeps a saved custom delay and normalizes legacy bounds', () => {
  const state = snapshot()
  const target = readReceptionSetup(state, 'target')
  expect(target.welcome).toMatchObject({ delayMinSeconds: 1, delayMaxSeconds: 3 })
  const copied = readReceptionSetupSource(state, 'source', target)
  expect(copied.draft.welcome).toMatchObject({ delayMinSeconds: 5, delayMaxSeconds: 9 })
})

it('unified save sends the copied bounds with the target CAS and verifies persisted bounds', async () => {
  const state = snapshot()
  const execute = vi.fn(async (command: CommandInput) => {
    state.welcomeByStore.target = {
      text: String(command.values?.text ?? ''),
      enabled: command.values?.enabled === true,
      version: 3,
      delayMinSeconds: Number(command.values?.delayMinSeconds),
      delayMaxSeconds: Number(command.values?.delayMaxSeconds),
    }
  })
  const saver = createReceptionSetupSaver({ execute, snapshot: () => state, assertCurrent() {} })
  const target = saver.read('target')
  const values = readReceptionSetupSource(state, 'source', target).draft
  expect(await saver.save('target', values, target, ['welcome'])).toEqual({
    saved: ['welcome'],
    failed: [],
  })
  expect(execute.mock.calls[0][0].values).toMatchObject({
    delayMinSeconds: 5,
    delayMaxSeconds: 9,
    version: 2,
  })
  state.welcomeByStore.target = { ...state.welcomeByStore.target, version: 4 }
  const mismatch = createReceptionSetupSaver({
    execute: async () => {
      state.welcomeByStore.target = {
        ...state.welcomeByStore.target,
        version: 5,
        delayMaxSeconds: 8,
      }
    },
    snapshot: () => state,
    assertCurrent() {},
  })
  expect(
    (await mismatch.save('target', values, mismatch.read('target'), ['welcome'])).failed[0].message,
  ).toContain('回读不一致')
})

it('invalid delay cannot be persisted by unified welcome save', async () => {
  const state = snapshot()
  const execute = vi.fn()
  const saver = createReceptionSetupSaver({ execute, snapshot: () => state, assertCurrent() {} })
  const target = saver.read('target')
  const values = readReceptionSetupSource(state, 'source', target).draft
  values.welcome = { ...values.welcome, delayMinSeconds: 9, delayMaxSeconds: 2 }
  expect((await saver.save('target', values, target, ['welcome'])).failed[0].message).toContain(
    '下限',
  )
  expect(execute).not.toHaveBeenCalled()
  values.welcome = { ...values.welcome, delayMinSeconds: undefined, delayMaxSeconds: 3 }
  expect((await saver.save('target', values, target, ['welcome'])).failed[0].message).toContain(
    '整数',
  )
  expect(execute).not.toHaveBeenCalled()
})

it('delay-only deferred edits remain dirty and invalid bounds block policy writes too', async () => {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'welcome-reuse'
  runtime.snapshot.stores = [
    {
      id: 'target',
      storeName: '目标店',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
  ]
  Object.assign(runtime.snapshot, snapshot())
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({
    status: 'ok',
    message: '',
    data: {
      revision: 0,
      profiles: [],
      bindings: {},
      globalPrompt: '',
      globalMaxReplyChars: 200,
    },
  })
  const setup = useShopSetupStore()
  setup.open('target')
  await setup.loadRules()
  const baseline = readReceptionSetup(runtime.snapshot, 'target')
  const reception = readReceptionSetupSource(runtime.snapshot, 'source', baseline).draft
  setup.reuseApplied = {
    source: { storeId: 'source', storeName: '来源店', platform: 'sim-local' },
    sections: ['reception', 'style'],
    selectedSections: ['reception', 'style'],
    retainedReception: [],
    writeStarted: false,
    reception,
    baseline,
    before: { draft: { ...setup.draft }, reception: baseline },
    parts: { welcome: 'saved', handoff: 'saved', policy: 'pending' },
  }
  setup.updateReceptionPart('welcome', {
    ...reception.welcome,
    delayMinSeconds: 6,
    delayMaxSeconds: 10,
  })
  expect(setup.reuseApplied?.reception.welcome).toMatchObject({
    delayMinSeconds: 6,
    delayMaxSeconds: 10,
  })
  expect(setup.reuseApplied?.parts.welcome).toBe('pending')
  setup.updateReceptionPart('welcome', {
    ...reception.welcome,
    delayMinSeconds: 9,
    delayMaxSeconds: 2,
  })
  run.mockClear()
  expect(await setup.saveRules()).toBe(false)
  expect(setup.error).toContain('下限')
  expect(run).not.toHaveBeenCalled()
  setup.updateReceptionPart('welcome', {
    ...reception.welcome,
    delayMinSeconds: undefined,
    delayMaxSeconds: 3,
  })
  expect(setup.reuseApplied?.reception.welcome.delayMinSeconds).toBeUndefined()
  expect(await setup.saveRules()).toBe(false)
  expect(setup.error).toContain('整数')
  expect(run).not.toHaveBeenCalled()
})
