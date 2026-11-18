import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { sizeRuleContextSchema, type SizeRuleFields } from '../src/shared/contracts/size-rules'
import { createSizeRulesService } from '../electron/size-rules/service'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

const saveResultSchema = z.object({
  rule: z.object({ id: z.string(), version: z.number() }),
  revision: z.number(),
})

function fixture(validProducts = new Set(['a:g', 'a:h', 'b:g'])) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-rules-context-'))
  directories.push(directory)
  const service = createSizeRulesService({
    directory,
    assertActive: () => {},
    isBindingValid: async (binding) => validProducts.has(`${binding.storeId}:${binding.productId}`),
  })
  return { directory, service }
}

const base: SizeRuleFields = {
  name: '身高体重对照',
  enabled: true,
  columns: [
    { id: 'height', name: '身高', kind: 'number', unit: 'cm' },
    { id: 'weight', name: '体重', kind: 'number', unit: 'kg' },
  ],
  rows: [
    { label: 'M', values: { height: '160~175', weight: '50~65' } },
    { label: 'L', values: { height: '175~185', weight: '65~75' } },
  ],
  advice: '',
  measurements: [
    { name: '身高', unit: 'cm' },
    { name: '体重', unit: 'kg' },
  ],
  bindings: [{ storeId: 'a', productId: 'g' }],
}

async function save(
  service: ReturnType<typeof fixture>['service'],
  patch: Partial<SizeRuleFields> = {},
) {
  const revision = z
    .object({ revision: z.number() })
    .parse((await service.execute('list-size-rules', {})).data).revision
  const result = await service.execute('save-size-rule', {
    ...base,
    ...patch,
    expectedRevision: revision,
  })
  return saveResultSchema.parse(result.data)
}

const buyer = (content: string) => ({ from: 'buyer', type: 'text', content })
const seller = (content: string) => ({ from: 'seller', type: 'text', content })

describe('size evidence resolution', () => {
  it('isolates the same product number by store and never leaks a disabled or invalid binding', async () => {
    const f = fixture()
    const first = await save(f.service)
    await save(f.service, {
      name: '乙店同号',
      bindings: [{ storeId: 'b', productId: 'g' }],
      rows: [{ label: 'B-ONLY', values: { height: '1', weight: '1' } }],
    })
    const a = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', 'M的身高范围是多少', [buyer('M的身高范围是多少')]),
    )
    const b = sizeRuleContextSchema.parse(
      await f.service.resolve('b', 'g', 'M的身高范围是多少', [buyer('M的身高范围是多少')]),
    )
    expect(a.ruleId).toBe(first.rule.id)
    expect(a.rows.map((row) => row.label)).toEqual(['M'])
    expect(b.rows.map((row) => row.label)).toEqual(['B-ONLY'])
    expect(JSON.stringify(b)).not.toContain('"M"')
    expect(await f.service.resolve('a', 'missing', '尺码表', [])).toBeNull()

    const currentRevision = z
      .object({ revision: z.number() })
      .parse((await f.service.execute('list-size-rules', {})).data).revision
    await f.service.execute('save-size-rule', {
      ...base,
      enabled: false,
      id: first.rule.id,
      version: first.rule.version,
      expectedRevision: currentRevision,
    })
    expect(await f.service.resolve('a', 'g', 'M身高范围', [])).toBeNull()
    const invalid = fixture(new Set())
    await expect(save(invalid.service)).rejects.toThrow(/商品|目录|有效/)
  })

  it('treats direct named row/column questions as table lookups, not selection requests', async () => {
    const f = fixture()
    await save(f.service)
    const height = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', 'M的身高范围是多少', [buyer('M的身高范围是多少')]),
    )
    expect(height.selectionRequested).toBe(false)
    expect(height.tableQueryRequested).toBe(true)
    expect(height.clarification).toBe('')
    expect(height.rows.map((row) => row.label)).toEqual(['M'])

    const weight = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', 'L体重上限', [buyer('L体重上限')]),
    )
    expect(weight.selectionRequested).toBe(false)
    expect(weight.tableQueryRequested).toBe(true)
    expect(weight.clarification).toBe('')
    expect(weight.rows[0]?.label).toBe('L')
  })

  it('cuts same-message person changes at the marker character, not the message boundary', async () => {
    const f = fixture()
    await save(f.service)
    const mixed = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '我身高170cm，给妈妈买，穿什么码', [
        buyer('我身高170cm，给妈妈买，穿什么码'),
      ]),
    )
    expect(mixed.providedMeasurements).toEqual([])
    expect(mixed.clarification).toContain('身高')

    const newPerson = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '给妈妈买，她身高160cm，体重55kg，穿什么码', [
        buyer('给妈妈买，她身高160cm，体重55kg，穿什么码'),
      ]),
    )
    expect(newPerson.providedMeasurements).toEqual([
      { name: '身高', value: 160, unit: 'cm' },
      { name: '体重', value: 55, unit: 'kg' },
    ])
    expect(newPerson.eligibleLabels).toEqual(['M'])
  })

  it('keeps absolute floating-point tolerance at high values and tiny out-of-range values', async () => {
    const f = fixture()
    await save(f.service, {
      columns: [{ id: 'h', name: '身高', kind: 'number', unit: 'cm' }],
      rows: [{ label: 'M', values: { h: '999999999~999999999' } }],
      measurements: [{ name: '身高', unit: 'cm' }],
    })
    const exact = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '推荐什么码', [buyer('身高999999999cm')]),
    )
    expect(exact.eligibleLabels).toEqual(['M'])
    const above = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '推荐什么码', [buyer('身高1000000000cm')]),
    )
    expect(above.eligibleLabels).toEqual([])

    const g = fixture()
    await save(g.service, {
      columns: [{ id: 'h', name: '身高', kind: 'number', unit: 'cm' }],
      rows: [{ label: 'M', values: { h: '0.3~0.3' } }],
      measurements: [{ name: '身高', unit: 'cm' }],
    })
    const tiny = sizeRuleContextSchema.parse(
      await g.service.resolve('a', 'g', '推荐什么码', [buyer('身高0.3000001cm')]),
    )
    expect(tiny.eligibleLabels).toEqual([])
  })

  it('does not silently let a bound size rule bypass a failed catalog lookup', async () => {
    const f = fixture()
    const saved = await save(f.service)
    const failing = createSizeRulesService({
      directory: f.directory,
      assertActive: () => {},
      checkBinding: async () => {
        throw new Error('catalog revision changed')
      },
    })
    const selected = sizeRuleContextSchema.parse(
      await failing.resolve('a', 'g', '推荐什么尺码', [buyer('身高170cm，体重60kg')]),
    )
    expect(selected.bindingStatus).toBe('error')
    expect(selected.eligibleLabels).toEqual([])
    expect(selected.clarification).toMatch(/暂时|重试|核对/)
    expect(await failing.resolve('a', 'g', '你好', [])).toBeNull()
    expect(saved.rule.id).toBeTruthy()
  })

  it('converts explicit units and uses closed intervals to constrain eligibleLabels', async () => {
    const f = fixture()
    await save(f.service)
    const context = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '推荐什么尺码', [buyer('我的身高1.7m，体重120斤')]),
    )
    expect(context.providedMeasurements).toEqual([
      { name: '身高', value: 170, unit: 'cm' },
      { name: '体重', value: 60, unit: 'kg' },
    ])
    expect(context.eligibleLabels).toEqual(['M'])
    expect(context.clarification).toBe('')

    const boundary = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '穿多大', [buyer('身高175cm，体重65kg')]),
    )
    expect(boundary.eligibleLabels).toEqual(['M', 'L'])

    const outside = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '推荐什么码', [buyer('身高190cm，体重90kg')]),
    )
    expect(outside.eligibleLabels).toEqual([])
  })

  it('matches prefixed measurement columns and converts millimetres for shoes', async () => {
    const f = fixture()
    await save(f.service, {
      columns: [
        { id: 'foot', name: '适用脚长', kind: 'number', unit: 'cm' },
        { id: 'inner', name: '鞋内长', kind: 'number', unit: 'cm' },
      ],
      rows: [
        { label: '38', values: { foot: '23.5~24', inner: '24' } },
        { label: '39', values: { foot: '24.5~25', inner: '25' } },
      ],
      measurements: [{ name: '脚长', unit: 'cm' }],
    })
    const context = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '脚长240mm选哪个码', [buyer('脚长240mm')]),
    )
    expect(context.providedMeasurements).toEqual([{ name: '脚长', value: 24, unit: 'cm' }])
    expect(context.eligibleLabels).toEqual(['38'])
  })

  it('asks only for missing measurements on selection requests and never reads seller facts', async () => {
    const f = fixture()
    await save(f.service)
    const missing = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '我该穿多大', [seller('身高170cm 体重60kg')]),
    )
    expect(missing.selectionRequested).toBe(true)
    expect(missing.providedMeasurements).toEqual([])
    expect(missing.eligibleLabels).toEqual([])
    expect(missing.clarification).toContain('身高')
    expect(missing.clarification).toContain('体重')

    const greeting = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '你好，在吗', []),
    )
    expect(greeting.selectionRequested).toBe(false)
    expect(greeting.clarification).toBe('')

    const direct = sizeRuleContextSchema.parse(await f.service.resolve('a', 'g', 'M衣长多少', []))
    expect(direct.selectionRequested).toBe(false)
    expect(direct.rows.map((row) => row.label)).toEqual(['M'])
    expect(direct.clarification).toBe('')
  })

  it('resets earlier measurements after the buyer changes the person being measured', async () => {
    const f = fixture()
    await save(f.service)
    const context = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '给我妈妈买，推荐什么尺码', [
        buyer('身高170cm 体重60kg'),
        buyer('给我妈妈买，推荐什么尺码'),
      ]),
    )
    expect(context.providedMeasurements).toEqual([])
    expect(context.clarification).toContain('身高')
  })

  it('defaults to an explicit clarification when no data column can constrain a recommendation', async () => {
    const f = fixture()
    await save(f.service, {
      columns: [
        { id: 'length', name: '衣长', kind: 'number', unit: 'cm' },
        { id: 'material', name: '材质', kind: 'text', unit: 'none' },
      ],
      rows: [{ label: 'M', values: { length: '64', material: '棉' } }],
      measurements: [],
    })
    const context = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '推荐什么尺码', [buyer('我170cm')]),
    )
    expect(context.eligibleLabels).toEqual([])
    expect(context.clarification).toMatch(/未配置|具体尺码|测量/)
  })

  it('does not truncate JSON for large tables and requires an explicit specification', async () => {
    const f = fixture()
    const rows = Array.from({ length: 100 }, (_, index) => ({
      label: `SIZE-${index}`,
      values: { info: '真实规格说明'.repeat(30) },
    }))
    await save(f.service, {
      columns: [{ id: 'info', name: '规格说明', kind: 'text', unit: 'none' }],
      rows,
      measurements: [],
    })
    const full = sizeRuleContextSchema.parse(await f.service.resolve('a', 'g', '我穿什么尺码', []))
    expect(full.complete).toBe(false)
    expect(full.rows).toEqual([])
    expect(full.clarification).toMatch(/具体尺码|具体规格|较大/)
    expect(Buffer.byteLength(JSON.stringify(full))).toBeLessThan(10000)

    const selected = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', 'SIZE-99规格是什么', []),
    )
    expect(selected.complete).toBe(false)
    expect(selected.rows).toHaveLength(1)
    expect(selected.rows[0]?.label).toBe('SIZE-99')
    expect(selected.clarification).toBe('')
    expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(10000)
  })

  it('invalidates a generated candidate when its rule is disabled or rebound', async () => {
    const f = fixture()
    const saved = await save(f.service)
    const evidence = sizeRuleContextSchema.parse(
      await f.service.resolve('a', 'g', '推荐什么尺码', [buyer('身高170cm，体重60kg')]),
    )
    expect(f.service.candidateCurrent(evidence)).toBe('')

    const revision = z
      .object({ revision: z.number() })
      .parse((await f.service.execute('list-size-rules', {})).data).revision
    await f.service.execute('save-size-rule', {
      ...base,
      enabled: false,
      id: saved.rule.id,
      version: saved.rule.version,
      expectedRevision: revision,
    })
    expect(f.service.candidateCurrent(evidence)).toContain('停用')

    const afterDisable = z
      .object({ revision: z.number() })
      .parse((await f.service.execute('list-size-rules', {})).data).revision
    const current = z
      .object({ rules: z.array(z.object({ id: z.string(), version: z.number() })) })
      .parse((await f.service.execute('list-size-rules', {})).data).rules[0]!
    await f.service.execute('save-size-rule', {
      ...base,
      enabled: true,
      id: current.id,
      version: current.version,
      expectedRevision: afterDisable,
      bindings: [{ storeId: 'a', productId: 'h' }],
    })
    expect(f.service.candidateCurrent({ ...evidence, ruleVersion: current.version + 1 })).toContain(
      '解除',
    )
  })

  it('returns null rather than stale evidence when the rule changes during binding validation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-rules-race-'))
    directories.push(directory)
    let changeDuring = true
    const service = createSizeRulesService({
      directory,
      assertActive: () => {},
      isBindingValid: async (binding) => {
        if (changeDuring) {
          const list = z
            .object({
              revision: z.number(),
              rules: z.array(z.object({ id: z.string(), version: z.number() })),
            })
            .parse((await service.execute('list-size-rules', {})).data)
          const current = list.rules[0]
          if (current) {
            changeDuring = false
            await service.execute('save-size-rule', {
              ...base,
              enabled: false,
              id: current.id,
              version: current.version,
              expectedRevision: list.revision,
            })
          }
        }
        return `${binding.storeId}:${binding.productId}` === 'a:g'
      },
    })
    await save(service)
    const context = await service.resolve('a', 'g', '推荐什么尺码', [buyer('身高170cm，体重60kg')])
    expect(context).toBeNull()
  })
})
