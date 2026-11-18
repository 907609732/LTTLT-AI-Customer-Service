import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  sizeRuleListResultSchema,
  sizeRuleSchema,
  type SizeRuleFields,
} from '../src/shared/contracts/size-rules'
import { createSizeRulesService } from '../electron/size-rules/service'

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

const saveResultSchema = z.object({
  rule: sizeRuleSchema,
  revision: z.number().int().nonnegative(),
})
const removeResultSchema = z.object({ revision: z.number().int().nonnegative() })

const draft: SizeRuleFields = {
  name: '本店上衣尺码',
  enabled: true,
  columns: [
    { id: 'chest', name: '胸围', kind: 'number', unit: 'cm' },
    { id: 'length', name: '衣长', kind: 'number', unit: 'cm' },
  ],
  rows: [
    { label: 'M', values: { chest: '92~96', length: '64' } },
    { label: 'L', values: { chest: '96~100', length: '66' } },
  ],
  advice: '版型偏宽松，以实测为准',
  measurements: [{ name: '胸围', unit: 'cm' }],
  bindings: [{ storeId: 'a', productId: 'g' }],
}

function fixture(validProducts = new Set(['a:g', 'a:h', 'b:g'])) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-rules-store-'))
  directories.push(directory)
  const validations: string[] = []
  const service = createSizeRulesService({
    directory,
    assertActive: () => {},
    isBindingValid: async (binding) => {
      const key = `${binding.storeId}:${binding.productId}`
      validations.push(key)
      return validProducts.has(key)
    },
  })
  return { directory, file: path.join(directory, 'size-rules.json'), service, validations }
}

async function save(service: ReturnType<typeof fixture>['service'], payload: object) {
  const revision = sizeRuleListResultSchema.parse(
    (await service.execute('list-size-rules', {})).data,
  ).revision
  return saveResultSchema.parse(
    (await service.execute('save-size-rule', { ...draft, expectedRevision: revision, ...payload }))
      .data,
  )
}

describe('size rules atomic store and CAS', () => {
  it('persists rules with revision/version CAS and survives restart', async () => {
    const f = fixture()
    const saved = await save(f.service, {})
    expect(saved.rule).toMatchObject({ name: draft.name, version: 1 })
    expect(saved.revision).toBe(1)

    const reopened = createSizeRulesService({
      directory: f.directory,
      assertActive: () => {},
      isBindingValid: async () => true,
    })
    const list = sizeRuleListResultSchema.parse(
      (await reopened.execute('list-size-rules', {})).data,
    )
    expect(list.total).toBe(1)
    expect(list.rules[0]).toMatchObject({ id: saved.rule.id, version: 1 })
    expect(list.units.some((unit) => unit.value === 'cm')).toBe(true)

    await expect(
      f.service.execute('save-size-rule', {
        ...draft,
        id: saved.rule.id,
        version: saved.rule.version,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/刷新|更新|修订/)

    const updated = await f.service.execute('save-size-rule', {
      ...draft,
      name: '上衣新版',
      id: saved.rule.id,
      version: saved.rule.version,
      expectedRevision: saved.revision,
    })
    expect(saveResultSchema.parse(updated.data).rule).toMatchObject({
      version: 2,
      name: '上衣新版',
    })

    const removed = await f.service.execute('remove-size-rule', {
      id: saved.rule.id,
      version: 2,
      expectedRevision: saved.revision + 1,
      confirmed: true,
    })
    expect(removeResultSchema.parse(removed.data).revision).toBe(3)
    expect((await f.service.execute('list-size-rules', {})).data).toMatchObject({ total: 0 })
  })

  it('rejects duplicate store/product ownership even when the existing rule is disabled', async () => {
    const f = fixture()
    await save(f.service, { enabled: false, name: '停用占位' })
    await expect(save(f.service, { name: '重复归属' })).rejects.toThrow(/绑定|归属|占用/)
    await expect(
      save(f.service, { bindings: [{ storeId: 'a', productId: 'same-product' }] }),
    ).rejects.toThrow(/商品|目录|有效/)
    const sameNumberOtherStore = await save(f.service, {
      name: '乙店同号',
      bindings: [{ storeId: 'b', productId: 'g' }],
    })
    expect(sameNumberOtherStore.rule.id).toBeTruthy()
  })

  it('rejects an invalid current directory product before writing any rule', async () => {
    const f = fixture()
    await expect(
      save(f.service, { bindings: [{ storeId: 'a', productId: 'missing' }] }),
    ).rejects.toThrow(/商品|目录|有效/)
    expect(fs.existsSync(f.file)).toBe(false)
  })

  it('rejects a rule without a same-name numeric measurement column before enabling', async () => {
    const f = fixture()
    await expect(
      save(f.service, {
        measurements: [{ name: '体重', unit: 'kg' }],
      }),
    ).rejects.toThrow(/同名|测量|参数列|体重/)
    await expect(
      save(f.service, {
        measurements: [{ name: '胸围', unit: 'kg' }],
      }),
    ).rejects.toThrow(/量纲|单位/)
    expect(fs.existsSync(f.file)).toBe(false)
  })

  it('keeps the original file on a failed atomic rename and removes the temporary file', async () => {
    const f = fixture()
    const saved = await save(f.service, {})
    const before = fs.readFileSync(f.file, 'utf8')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated rename failure')
    })
    await expect(
      f.service.execute('save-size-rule', {
        ...draft,
        name: '不会写入',
        id: saved.rule.id,
        version: saved.rule.version,
        expectedRevision: saved.revision,
      }),
    ).rejects.toThrow(/保存失败|原文件/)
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before)
    expect(fs.readdirSync(f.directory).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('rejects corrupted or conflicting files at startup without rewriting them', async () => {
    const f = fixture()
    const saved = await save(f.service, {})
    const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'))
    disk.rules.push({ ...disk.rules[0], id: crypto.randomUUID(), version: 1 })
    fs.writeFileSync(f.file, JSON.stringify(disk))
    const before = fs.readFileSync(f.file, 'utf8')
    expect(() =>
      createSizeRulesService({
        directory: f.directory,
        assertActive: () => {},
        isBindingValid: async () => true,
      }),
    ).toThrow(/损坏|原文件/)
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before)

    fs.writeFileSync(f.file, '{broken')
    const broken = fs.readFileSync(f.file, 'utf8')
    expect(() =>
      createSizeRulesService({
        directory: f.directory,
        assertActive: () => {},
        isBindingValid: async () => true,
      }),
    ).toThrow(/损坏|原文件/)
    expect(fs.readFileSync(f.file, 'utf8')).toBe(broken)
    expect(saved.rule.id).toBeTruthy()
  })
})
