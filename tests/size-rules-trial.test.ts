// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import { createSizeRulesService } from '../electron/size-rules/service'
import type { SizeRuleFields } from '../src/shared/contracts/size-rules'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})

const draft: SizeRuleFields = {
  name: '本店上衣尺码',
  enabled: true,
  columns: [
    { id: 'height', name: '身高', kind: 'number', unit: 'cm' },
    { id: 'weight', name: '体重', kind: 'number', unit: 'kg' },
  ],
  rows: [
    { label: 'M', values: { height: '160~175', weight: '50~65' } },
    { label: 'L', values: { height: '176~185', weight: '66~75' } },
  ],
  advice: '',
  measurements: [
    { name: '身高', unit: 'cm' },
    { name: '体重', unit: 'kg' },
  ],
  bindings: [{ storeId: 's', productId: 'p' }],
}

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-trial-'))
  const sizeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-trial-rules-'))
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  cleanup.push(() => fs.rmSync(sizeDirectory, { recursive: true, force: true }))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'workspace' })
  cleanup.push(() => repository.dispose())
  return { directory, sizeDirectory, repository }
}

function trialRuntime(
  repository: ReturnType<typeof createKnowledgeRepository>,
  sizeContext: Parameters<typeof createKnowledgeRuntime>[0]['sizeContext'],
) {
  const runtime = createKnowledgeRuntime({
    repository,
    workspaceId: 'workspace',
    assertActive: () => {},
    stores: () => [{ id: 's', storeName: 'Shop', platform: 'sim-local' }],
    changed: () => {},
    sizeContext,
  })
  cleanup.push(() => runtime.dispose())
  return runtime
}

describe('knowledge trial size integration', () => {
  it('uses the real trial chain and returns deterministic eligible size instead of model XL', async () => {
    const { sizeDirectory, repository } = setup()
    const service = createSizeRulesService({
      directory: sizeDirectory,
      assertActive: () => {},
      checkBinding: async () => 'valid',
    })
    await service.execute('save-size-rule', { ...draft, expectedRevision: 0 })
    const runtime = trialRuntime(repository, {
      resolve: (storeId, productId, question, thread) =>
        service.resolve(storeId, productId, question, thread),
      unavailable: () => '',
    })
    let calls = 0
    runtime.setModel({
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      complete: async () => {
        calls++
        return 'XL 最合适'
      },
    })
    const result = (await runtime.request({
      workspaceId: 'workspace',
      operation: 'trial',
      input: {
        storeId: 's',
        productId: 'p',
        query: '身高170cm，体重60kg，推荐什么尺码',
      },
    })) as { answer: string; resolution: unknown }
    expect(calls).toBe(1)
    expect(result.answer).toContain('M')
    expect(result.answer).not.toContain('XL')
    expect(result.resolution).toBeTruthy()
  })

  it('fails a trial closed without model text when the bound catalog cannot be verified', async () => {
    const { sizeDirectory, repository } = setup()
    const seeder = createSizeRulesService({
      directory: sizeDirectory,
      assertActive: () => {},
      checkBinding: async () => 'valid',
    })
    await seeder.execute('save-size-rule', { ...draft, expectedRevision: 0 })
    const failing = createSizeRulesService({
      directory: sizeDirectory,
      assertActive: () => {},
      checkBinding: async () => {
        throw new Error('catalog revision changed')
      },
    })
    const runtime = trialRuntime(repository, {
      resolve: (storeId, productId, question, thread) =>
        failing.resolve(storeId, productId, question, thread),
      unavailable: () => '',
    })
    let calls = 0
    runtime.setModel({
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      complete: async () => {
        calls++
        return 'XL 最合适'
      },
    })
    const result = (await runtime.request({
      workspaceId: 'workspace',
      operation: 'trial',
      input: {
        storeId: 's',
        productId: 'p',
        query: '身高170cm，体重60kg，推荐什么尺码',
      },
    })) as { answer: string }
    expect(calls).toBe(0)
    expect(result.answer).toMatch(/暂时|重试|核对/)
    expect(result.answer).not.toContain('XL')
  })

  it('rejects a late trial result when the rule is disabled while the model is running', async () => {
    const { sizeDirectory, repository } = setup()
    const service = createSizeRulesService({
      directory: sizeDirectory,
      assertActive: () => {},
      checkBinding: async () => 'valid',
    })
    await service.execute('save-size-rule', { ...draft, expectedRevision: 0 })
    const runtime = trialRuntime(repository, {
      resolve: (storeId, productId, question, thread) =>
        service.resolve(storeId, productId, question, thread),
      unavailable: () => '',
    })
    runtime.setModel({
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      complete: async () => {
        const current = z
          .object({
            revision: z.number(),
            rules: z.array(z.object({ id: z.string(), version: z.number() })),
          })
          .parse((await service.execute('list-size-rules', {})).data)
        await service.execute('save-size-rule', {
          ...draft,
          enabled: false,
          id: current.rules[0]!.id,
          version: current.rules[0]!.version,
          expectedRevision: current.revision,
        })
        return 'M 码适合'
      },
    })
    await expect(
      runtime.request({
        workspaceId: 'workspace',
        operation: 'trial',
        input: {
          storeId: 's',
          productId: 'p',
          query: '身高170cm，体重60kg，推荐什么尺码',
        },
      }),
    ).rejects.toThrow(/更新|停用|解绑/)
  })

  it('keeps ordinary trial behavior when no size rule is bound', async () => {
    const { repository } = setup()
    const runtime = trialRuntime(repository, {
      resolve: async () => null,
      unavailable: () => '',
    })
    runtime.setModel({
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      complete: async () => '普通知识回答',
    })
    const result = (await runtime.request({
      workspaceId: 'workspace',
      operation: 'trial',
      input: { storeId: 's', query: '发货时间' },
    })) as { answer: string }
    expect(result.answer).toBe('普通知识回答')
  })
})
