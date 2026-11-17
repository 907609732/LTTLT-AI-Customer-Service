import { describe, expect, it } from 'vitest'
import {
  createReceptionSetupSaver,
  readReceptionSetup,
  readReceptionSetupSource,
  type ReceptionSetupDraft,
  type ReceptionSnapshot,
} from '../src/modules/reception/setup'

function snapshot(): ReceptionSnapshot {
  return {
    welcomeByStore: {
      target: { text: '本店欢迎', enabled: false, version: 3 },
      source: { text: '来源欢迎', enabled: true, version: 9 },
    },
    handoffByStore: {
      target: { keywords: ['本店人工'] },
      source: { keywords: ['退款', '转人工'] },
    },
  } as ReceptionSnapshot
}

function draft(): ReceptionSetupDraft {
  return {
    welcome: { text: '导入欢迎', enabled: true },
    handoff: { inherited: false, keywords: ['退款', '转人工'] },
  }
}

function fixture(
  options: { failWelcome?: boolean; failHandoff?: boolean; mismatch?: boolean } = {},
) {
  let state = snapshot()
  let failWelcome = Boolean(options.failWelcome),
    failHandoff = Boolean(options.failHandoff)
  let current = true
  const commands: { action: string; storeId?: string; values?: unknown }[] = []
  const execute = async (command: {
    action: string
    storeId?: string
    values?: Record<string, unknown>
  }) => {
    commands.push(command)
    if (command.action === 'save-welcome') {
      if (failWelcome) throw Error('欢迎语写入失败')
      const storeId = command.storeId!
      const old = state.welcomeByStore[storeId] ?? { text: '', enabled: false, version: 0 }
      if (command.values?.version !== old.version) throw Error('欢迎配置已更新，请重新载入')
      const next = {
        text: String(command.values?.text ?? '').trim(),
        enabled: Boolean(command.values?.enabled),
        version: options.mismatch ? old.version : old.version + 1,
      }
      state = {
        ...state,
        welcomeByStore: { ...state.welcomeByStore, [storeId]: next },
      }
      return { data: next }
    }
    if (command.action === 'save-store-handoff') {
      if (failHandoff) throw Error('转人工写入失败')
      const storeId = command.storeId!
      const values = command.values as { mode: 'inherit' | 'custom'; keywords?: string[] }
      const stores = { ...state.handoffByStore }
      if (values.mode === 'inherit') delete stores[storeId]
      else stores[storeId] = { keywords: [...(values.keywords ?? [])] }
      state = { ...state, handoffByStore: stores }
      return { data: {} }
    }
    throw Error('非预期命令')
  }
  return {
    commands,
    saver: createReceptionSetupSaver({
      execute,
      snapshot: () => state,
      assertCurrent: () => {
        if (!current) throw Error('店铺工作区已改变')
      },
    }),
    cancel: () => {
      current = false
    },
    restoreWelcome: () => {
      failWelcome = false
    },
    restoreHandoff: () => {
      failHandoff = false
    },
    state: () => state,
  }
}

describe('接待设置复用草稿', () => {
  it('读取目标欢迎语版本与转人工继承状态', () => {
    expect(readReceptionSetup(snapshot(), 'target')).toEqual({
      welcome: { text: '本店欢迎', enabled: false, version: 3 },
      handoff: { inherited: false, keywords: ['本店人工'] },
    })
    expect(readReceptionSetup(snapshot(), 'missing')).toEqual({
      welcome: { text: '', enabled: false, version: 0 },
      handoff: { inherited: true, keywords: [] },
    })
  })

  it('来源未保存欢迎时保留目标值并提示；显式关闭欢迎照常复用', () => {
    const target = readReceptionSetup(snapshot(), 'target')
    target.welcome = { text: '', enabled: false, version: 0 }
    const withoutWelcome: ReceptionSnapshot = {
      welcomeByStore: {},
      handoffByStore: {},
    }
    const missing = readReceptionSetupSource(withoutWelcome, 'source', target)
    expect(missing.draft.welcome).toEqual({ text: '', enabled: false })
    expect(missing.draft.handoff).toEqual({ inherited: true, keywords: [] })
    expect(missing.missing).toEqual(['welcome'])
    expect(missing.hints.join('；')).toContain('已保留本店欢迎语')

    const explicitOff: ReceptionSnapshot = {
      welcomeByStore: { source: { text: '', enabled: false, version: 2 } },
      handoffByStore: {},
    }
    const off = readReceptionSetupSource(explicitOff, 'source', target)
    expect(off.draft.welcome).toEqual({ text: '', enabled: false })
    // 有保存记录即视为已配置，不能误判为缺项。
    expect(off.missing).toEqual([])
  })

  it('转人工继承模式是显式状态，不被误判为空', () => {
    const target = readReceptionSetup(snapshot(), 'target')
    const inheritOnly: ReceptionSnapshot = { welcomeByStore: {}, handoffByStore: {} }
    const merged = readReceptionSetupSource(inheritOnly, 'source', target)
    expect(merged.draft.handoff).toEqual({ inherited: true, keywords: [] })
    expect(merged.missing).not.toContain('handoff')
    const custom = readReceptionSetupSource(snapshot(), 'source', target)
    expect(custom.draft.handoff).toEqual({ inherited: false, keywords: ['退款', '转人工'] })
  })

  it('保存前预检目标欢迎版本与转人工基线，冲突时不写入', async () => {
    const f = fixture()
    const expected = readReceptionSetup(f.state(), 'target')
    const changed: ReceptionSnapshot = {
      ...f.state(),
      welcomeByStore: {
        ...f.state().welcomeByStore,
        target: { text: '他人修改', enabled: true, version: 4 },
      },
    }
    const stale = createReceptionSetupSaver({
      execute: async () => ({ data: {} }),
      snapshot: () => changed,
      assertCurrent: () => {},
    })
    expect(() => stale.precheck('target', expected, ['welcome'])).toThrow(/欢迎语.*更新/)
    expect(() => stale.precheck('target', expected, ['handoff'])).not.toThrow()
    const changedHandoff: ReceptionSnapshot = {
      ...f.state(),
      handoffByStore: {
        ...f.state().handoffByStore,
        target: { keywords: ['他人关键词'] },
      },
    }
    const staleHandoff = createReceptionSetupSaver({
      execute: async () => ({ data: {} }),
      snapshot: () => changedHandoff,
      assertCurrent: () => {},
    })
    expect(() => staleHandoff.precheck('target', expected, ['handoff'])).toThrow(/转人工.*更新/)
    expect(f.commands).toHaveLength(0)
  })

  it('欢迎语使用目标版本保存并回读；转人工按模式保存', async () => {
    const f = fixture()
    const expected = readReceptionSetup(f.state(), 'target')
    const report = await f.saver.save('target', draft(), expected, ['welcome', 'handoff'])
    expect(report).toEqual({ saved: ['welcome', 'handoff'], failed: [] })
    expect(f.commands[0]).toEqual({
      action: 'save-welcome',
      storeId: 'target',
      values: { text: '导入欢迎', enabled: true, version: 3 },
    })
    expect(f.commands[1]).toEqual({
      action: 'save-store-handoff',
      storeId: 'target',
      values: { mode: 'custom', keywords: ['退款', '转人工'] },
    })
    expect(f.state().welcomeByStore.target).toEqual({
      text: '导入欢迎',
      enabled: true,
      version: 4,
    })
    expect(f.state().welcomeByStore.source).toEqual({
      text: '来源欢迎',
      enabled: true,
      version: 9,
    })
  })

  it('继承模式保存为删除本店记录，并回读确认', async () => {
    const f = fixture()
    const expected = readReceptionSetup(f.state(), 'target')
    const report = await f.saver.save(
      'target',
      { ...draft(), handoff: { inherited: true, keywords: [] } },
      expected,
      ['handoff'],
    )
    expect(report).toEqual({ saved: ['handoff'], failed: [] })
    expect(f.commands[0]).toEqual({
      action: 'save-store-handoff',
      storeId: 'target',
      values: { mode: 'inherit' },
    })
    expect(f.state().handoffByStore.target).toBeUndefined()
  })

  it('部分失败逐项报告，成功的部分不再重试', async () => {
    const f = fixture({ failWelcome: true })
    const expected = readReceptionSetup(f.state(), 'target')
    const first = await f.saver.save('target', draft(), expected, ['welcome', 'handoff'])
    expect(first.saved).toEqual(['handoff'])
    expect(first.failed).toEqual([{ part: 'welcome', message: '欢迎语写入失败' }])
    const after = readReceptionSetup(f.state(), 'target')
    expect(after.handoff).toEqual({ inherited: false, keywords: ['退款', '转人工'] })
    f.restoreWelcome()
    const retry = await f.saver.save('target', draft(), after, ['welcome'])
    expect(retry).toEqual({ saved: ['welcome'], failed: [] })
    expect(f.commands.filter((c) => c.action === 'save-store-handoff')).toHaveLength(1)
  })

  it('回读不一致或租约失效时报告失败，不伪造成功', async () => {
    const mismatch = fixture({ mismatch: true })
    const expected = readReceptionSetup(mismatch.state(), 'target')
    const report = await mismatch.saver.save('target', draft(), expected, ['welcome'])
    expect(report.saved).toEqual([])
    expect(report.failed[0]?.message).toContain('回读')

    const cancelled = fixture()
    const lease = readReceptionSetup(cancelled.state(), 'target')
    cancelled.cancel()
    const job = cancelled.saver.save('target', draft(), lease, ['handoff'])
    await expect(job).rejects.toThrow('店铺工作区已改变')
    expect(cancelled.commands).toHaveLength(0)
  })

  it('拒绝超长转人工关键词，不写入半成品', async () => {
    const f = fixture()
    const expected = readReceptionSetup(f.state(), 'target')
    const report = await f.saver.save(
      'target',
      { ...draft(), handoff: { inherited: false, keywords: ['x'.repeat(31)] } },
      expected,
      ['handoff'],
    )
    expect(report.saved).toEqual([])
    expect(report.failed[0]?.message).toContain('30')
    expect(f.commands).toHaveLength(0)
  })
})
