import { describe, expect, it } from 'vitest'
import type { CommandInput, ModelProfile } from '../src/shared/contracts/backend'
import { createBlankSetupDraft, createSetupRules } from '../src/modules/shops/setup-rules'

function ready(draft: ReturnType<typeof createBlankSetupDraft>) {
  return Object.assign(draft, {
    origins: ['测试发货地'],
    carriers: ['测试快递'],
    designatedCourier: false,
    dispatchTime: '人工确认发货',
    freightInsurance: false,
    exchangeSupported: false,
    returnSupported: false,
    cashbackSupported: false,
    compensationSupported: false,
  })
}

function fixture() {
  const state = {
    revision: 4,
    profiles: [
      { id: 'shared', version: 2, name: '共享方案', prompt: '原有规则', maxReplyChars: 321 },
    ],
    bindings: { a: 'shared', b: 'shared' } as Record<string, string>,
    globalPrompt: '全局规则',
    globalMaxReplyChars: 200,
  }
  const commands: CommandInput[] = []
  let current = true
  let before: ((command: CommandInput) => void) | undefined
  const execute = async (command: CommandInput) => {
    commands.push(command)
    before?.(command)
    let data: unknown = {}
    if (command.action === 'list-model-profiles') data = structuredClone(state)
    if (command.action === 'save-model-profile') {
      const saved = { ...command.values, id: 'new', version: 1 } as (typeof state.profiles)[number]
      state.profiles.push(saved)
      state.revision++
      data = saved
    }
    if (command.action === 'bind-model-profile') {
      if (command.values?.revision !== state.revision) throw Error('版本冲突')
      state.bindings[command.storeId!] = String(command.values?.profileId)
      state.revision++
    }
    return { data }
  }
  return {
    state,
    commands,
    service: createSetupRules({
      execute,
      assertCurrent: () => {
        if (!current) throw Error('已切换店铺')
      },
    }),
    cancel: () => {
      current = false
    },
    intercept: (callback: typeof before) => {
      before = callback
    },
  }
}

describe('店铺向导规则适配', () => {
  it('自有区块严格解码，用户政策含标记文字也能安全回填，不接受损坏风格', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    draft.shippingNotes = '商家文本<!-- /lingtu-shop-setup:v1 -->必须保留'
    await f.service.save('a', draft)
    expect(await f.service.load('a')).toEqual(draft)
    f.state.profiles[1]!.prompt = f.state.profiles[1]!.prompt.replace(
      '"style":"practical"',
      '"style":"unknown"',
    )
    await expect(f.service.load('a')).rejects.toThrow(/格式损坏/)
    await expect(f.service.save('a', draft)).rejects.toThrow(/载入/)
  })

  it('真实持久化服务重建后回填，并通过正式resolve入口读取本店规则', async () => {
    interface GlobalConfig {
      ai: { systemPrompt: string }
      reply: { maxReplyChars: number }
    }
    interface ProfileStore {
      snapshot(): { revision: number; profiles: ModelProfile[]; bindings: Record<string, string> }
      save(value: unknown): ModelProfile
      bind(storeId: string, profileId: string, revision: number): void
      resolve(storeId: string, global: GlobalConfig): GlobalConfig
    }
    const { createModelProfiles } = createRequire(import.meta.url)(
      '../vendor/lingtu-runtime/electron/model-profiles.cjs',
    ) as { createModelProfiles(file: string): ProfileStore }
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-setup-rules-'))
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + '\\') &&
      !resolve(directory).startsWith(resolve(tmpdir()) + '/')
    )
      throw Error('临时目录范围无效')
    const file = join(directory, 'profiles.json')
    const global: GlobalConfig = {
      ai: { systemPrompt: '原全局规则' },
      reply: { maxReplyChars: 270 },
    }
    try {
      let store = createModelProfiles(file)
      const shared = store.save({ name: '既有共享', prompt: '不得猜库存', maxReplyChars: 188 })
      store.bind('a', shared.id, store.snapshot().revision)
      store.bind('b', shared.id, store.snapshot().revision)
      const execute = async (command: CommandInput) => {
        if (command.action === 'list-model-profiles')
          return {
            data: {
              ...store.snapshot(),
              globalPrompt: global.ai.systemPrompt,
              globalMaxReplyChars: global.reply.maxReplyChars,
            },
          }
        if (command.action === 'save-model-profile') return { data: store.save(command.values) }
        if (command.action === 'bind-model-profile') {
          store.bind(
            command.storeId!,
            String(command.values?.profileId),
            Number(command.values?.revision),
          )
          return { data: {} }
        }
        throw Error('非预期命令')
      }
      const service = createSetupRules({ execute, assertCurrent: () => {} })
      const draft = ready(await service.load('a'))
      Object.assign(draft, {
        origins: ['测试发货地'],
        length: 'short',
        dispatchTime: '商家人工确认',
        cashbackSupported: true,
        cashbackAmount: '2.50',
        cashbackProcess: '仅人工核对后申请',
      })
      await service.save('a', draft)
      store = createModelProfiles(file)
      const reopened = createSetupRules({ execute, assertCurrent: () => {} })
      expect(await reopened.load('a')).toEqual(draft)
      const actual = store.resolve('a', global)
      expect(actual.ai.systemPrompt).toContain('测试发货地')
      expect(actual.ai.systemPrompt).toContain('不得猜库存')
      expect(actual.reply.maxReplyChars).toBe(188)
      expect(store.resolve('b', global).ai.systemPrompt).toBe('不得猜库存')
      expect(store.resolve('unbound', global)).toEqual(global)
      expect(store.snapshot().profiles.find((p) => p.id === shared.id)?.version).toBe(1)
      // 再次保存替换自有区块，保留原规则且不累积旧政策。
      draft.dispatchTime = '新确认时间'
      await reopened.save('a', draft)
      expect(store.resolve('a', global).ai.systemPrompt).not.toContain('商家人工确认')
      expect(
        store.resolve('a', global).ai.systemPrompt.match(/<!-- lingtu-shop-setup:v1 -->/g),
      ).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('新售后字段默认未知，关闭政策清空条件内容，不把隐藏旧值保存成承诺', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    expect(createBlankSetupDraft()).toMatchObject({
      exchangeSupported: null,
      returnSupported: null,
      cashbackSupported: null,
      compensationSupported: null,
      cashbackAmount: '',
    })
    Object.assign(draft, {
      freightInsurance: false,
      insuranceNotes: '旧条款',
      insuranceExcessPayer: 'buyer',
      exchangeSupported: false,
      exchangePolicy: '旧换货',
      returnSupported: false,
      returnPolicy: '旧退货',
      cashbackSupported: false,
      cashbackAmount: '1.00',
      cashbackProcess: '旧返现',
      compensationSupported: false,
      compensationLimit: '9.99',
      compensationPolicy: '旧赔付',
    })
    await f.service.save('a', draft)
    expect(await f.service.load('a')).toMatchObject({
      insuranceNotes: '',
      insuranceExcessPayer: '',
      exchangePolicy: '',
      returnPolicy: '',
      cashbackAmount: '',
      cashbackProcess: '',
      compensationLimit: '',
      compensationPolicy: '',
    })
  })

  it('启用返现必须确认正数金额且最多两位小数', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    Object.assign(draft, { cashbackSupported: true, cashbackAmount: '0' })
    await expect(f.service.save('a', draft)).rejects.toThrow(/返现|金额/)
    Object.assign(draft, { cashbackAmount: '1.001' })
    await expect(f.service.save('a', draft)).rejects.toThrow(/返现|金额/)
    expect(f.commands.some((c) => c.action === 'save-model-profile')).toBe(false)
    Object.assign(draft, { cashbackAmount: '1.20', cashbackProcess: '商家人工核对' })
    await f.service.save('a', draft)
    expect(await f.service.load('a')).toMatchObject({
      cashbackAmount: '1.20',
      cashbackProcess: '商家人工核对',
    })
    expect(f.state.profiles[1]!.prompt).toContain('不代表已付款')
  })

  it('服务拒绝跳步保存，要求明确物流、发货、运费险和售后政策', async () => {
    const f = fixture()
    const draft = await f.service.load('a')
    await expect(f.service.save('a', draft)).rejects.toThrow(/物流|发货/)
    ready(draft)
    Object.assign(draft, { exchangeSupported: true })
    await expect(f.service.save('a', draft)).rejects.toThrow(/换货/)
    Object.assign(draft, { exchangeSupported: false, compensationSupported: true })
    await expect(f.service.save('a', draft)).rejects.toThrow(/补偿/)
    expect(f.commands.some((c) => c.action === 'save-model-profile')).toBe(false)
  })
  it('空白草稿不预设商业承诺，各实例数组独立', () => {
    const a = createBlankSetupDraft()
    a.origins.push('测试地')
    expect(createBlankSetupDraft()).toMatchObject({
      style: 'practical',
      origins: [],
      carriers: [],
      designatedCourier: null,
      returnPolicy: '',
      warrantyPolicy: '',
    })
  })

  it('共享规则只克隆本店绑定，原规则、字数限制、其他店及全局不变，重开可回填', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    Object.assign(draft, {
      origins: ['杭州', '苏州'],
      carriers: ['顺丰'],
      designatedCourier: false,
      dispatchTime: '确认后处理',
      returnPolicy: '按商品页面',
      returnSupported: true,
      length: 'short',
    })
    await f.service.save('a', draft)
    expect(f.state.bindings).toEqual({ a: 'new', b: 'shared' })
    expect(f.state.profiles[0]).toMatchObject({
      version: 2,
      prompt: '原有规则',
      maxReplyChars: 321,
    })
    expect(f.state.profiles[1]).toMatchObject({ maxReplyChars: 321 })
    expect(f.state.profiles[1]!.prompt).toContain('原有规则')
    expect(f.state.globalPrompt).toBe('全局规则')
    expect(await f.service.load('a')).toEqual(draft)
    expect(f.commands.map((c) => c.action)).not.toContain('set-ai')
  })

  it('全局继承也克隆为本店方案，不修改全局或其他绑定', async () => {
    const f = fixture()
    delete f.state.bindings.a
    const draft = ready(await f.service.load('a'))
    await f.service.save('a', draft)
    expect(f.state.profiles[1]!.prompt).toContain('全局规则')
    expect(f.state.profiles[1]!.maxReplyChars).toBe(200)
    expect(f.state.bindings.b).toBe('shared')
  })

  it('载入后规则/绑定版本变化拒绝覆盖', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    f.state.profiles[0]!.version++
    await expect(f.service.save('a', draft)).rejects.toThrow(/更新|冲突/)
    expect(f.commands.some((c) => c.action === 'save-model-profile')).toBe(false)
  })

  it('保存克隆期间绑定变化不得使用刷新版本强行绑定', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    f.intercept((c) => {
      if (c.action === 'save-model-profile') {
        f.state.bindings.a = 'changed'
        f.state.revision++
      }
    })
    await expect(f.service.save('a', draft)).rejects.toThrow(/更新|冲突/)
    expect(f.commands.some((c) => c.action === 'bind-model-profile')).toBe(false)
  })

  it('取消后晚到保存不能继续绑定', async () => {
    const f = fixture()
    const draft = ready(await f.service.load('a'))
    f.intercept((c) => {
      if (c.action === 'save-model-profile') f.cancel()
    })
    await expect(f.service.save('a', draft)).rejects.toThrow('已切换店铺')
    expect(f.state.bindings.a).toBe('shared')
  })

  it('保存失败不得绑定或假成功，未load或不同店也拒绝', async () => {
    const f = fixture()
    await expect(f.service.save('a', createBlankSetupDraft())).rejects.toThrow()
    const draft = ready(await f.service.load('a'))
    await expect(f.service.save('b', draft)).rejects.toThrow()
    f.intercept((c) => {
      if (c.action === 'save-model-profile') throw Error('磁盘失败')
    })
    await expect(f.service.save('a', draft)).rejects.toThrow('磁盘失败')
    expect(f.state.bindings.a).toBe('shared')
  })
})
// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
