// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { createAssistedContext } from '../electron/generic-phrases'
import { createSizeContextPreparation, SIZE_RULES_MARKER } from '../electron/size-rules/inject'
import { installSizeReplyGuard } from '../electron/size-rules/guard'
import { createSizeRulesService } from '../electron/size-rules/service'
import type { SizeRuleFields } from '../src/shared/contracts/size-rules'

interface Backend {
  execute(command: Record<string, unknown>): Promise<{ data: Record<string, unknown> }>
  engine: { aiClient: { reply(input: unknown): Promise<unknown> } }
  dispose(): void
}
const { createBackend } = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/electron/backend.cjs'),
) as { createBackend(options: Record<string, unknown>): Backend }

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
  bindings: [],
}

describe('size rules through the real training model path', () => {
  it('does not release a bad XL reply when the bound product catalog cannot be verified', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-rules-runtime-error-'))
    cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
    const seeder = createSizeRulesService({
      directory,
      assertActive: () => {},
      checkBinding: async () => 'valid',
    })
    await seeder.execute('save-size-rule', {
      ...draft,
      bindings: [{ storeId: 'store-placeholder', productId: 'fixture-size-product' }],
      expectedRevision: 0,
    })
    const failingServiceRef: {
      current?: ReturnType<typeof createSizeRulesService>
    } = {}
    const resolveFailing = (
      storeId: string,
      productId: string,
      question: string,
      thread: unknown,
    ) =>
      failingServiceRef.current?.resolve(storeId, productId, question, thread) ??
      Promise.resolve(null)
    const managedChat = vi.fn(async () => ({
      choices: [
        {
          message: { content: JSON.stringify({ reply: 'XL 最合适', sizeLabel: 'XL' }) },
        },
      ],
    }))
    const sizeContext = createSizeContextPreparation(
      {
        assertActive: () => {},
        resolve: resolveFailing,
      },
      createAssistedContext(() => undefined),
    )
    const backend = createBackend({
      dataDir: directory,
      modelMode: 'managed',
      managedReady: () => {},
      managedChat,
      prepareModelContext: sizeContext,
      managerFactory: () => ({
        stateOf: () => ({ open: true, online: true }),
        closeAll() {},
      }),
      adapterFactory: () => ({
        syncAiEnabled: async () => {},
        focusConversation: async () => ({ ok: true }),
        sendText: async () => ({ ok: true }),
      }),
    })
    cleanup.push(() => backend.dispose())
    installSizeReplyGuard(backend.engine.aiClient, { resolve: resolveFailing })
    const storeId = z.object({ id: z.string() }).parse(
      (
        await backend.execute({
          action: 'add-store',
          values: { platform: 'pdd-web', storeName: '目录失败店' },
        })
      ).data,
    ).id
    await backend.execute({
      action: 'save-product',
      storeId,
      values: {
        productId: 'fixture-size-product',
        title: '测试上衣',
        description: '',
        specifications: '',
        price: '',
        enabled: true,
      },
    })
    // Update the seeded binding to the real generated store id.
    const list = z
      .object({
        revision: z.number(),
        rules: z.array(z.object({ id: z.string(), version: z.number() })),
      })
      .parse((await seeder.execute('list-size-rules', {})).data)
    await seeder.execute('save-size-rule', {
      ...draft,
      id: list.rules[0]!.id,
      version: list.rules[0]!.version,
      expectedRevision: list.revision,
      bindings: [{ storeId, productId: 'fixture-size-product' }],
    })
    failingServiceRef.current = createSizeRulesService({
      directory,
      assertActive: () => {},
      checkBinding: async () => {
        throw new Error('catalog revision changed')
      },
    })
    const result = z.object({ reply: z.string() }).parse(
      (
        await backend.execute({
          action: 'start-training',
          storeId,
          values: {
            question: '身高170cm，体重60kg，推荐什么码',
            productId: 'fixture-size-product',
            history: [],
          },
        })
      ).data,
    )
    expect(managedChat).toHaveBeenCalledOnce()
    expect(result.reply).toMatch(/暂时|重试|核对/)
    expect(result.reply).not.toContain('XL')
  })

  it('uses one evidence payload and rejects an out-of-range model label before training output', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-rules-runtime-'))
    cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
    const service = createSizeRulesService({
      directory,
      assertActive: () => {},
      isBindingValid: async () => true,
    })
    let sentMessages: unknown
    const managedChat = vi.fn(async (payload: { messages: unknown }) => {
      sentMessages = payload.messages
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({ reply: '推荐L码，穿着更宽松', sizeLabel: 'L' }),
            },
          },
        ],
      }
    })
    const sizeContext = createSizeContextPreparation(
      {
        assertActive: () => {},
        resolve: (storeId, productId, question, thread) =>
          service.resolve(storeId, productId, question, thread),
      },
      createAssistedContext(() => undefined),
    )
    const backend = createBackend({
      dataDir: directory,
      modelMode: 'managed',
      managedReady: () => {},
      managedChat,
      prepareModelContext: sizeContext,
      managerFactory: () => ({
        stateOf: () => ({ open: true, online: true }),
        closeAll() {},
      }),
      adapterFactory: () => ({
        syncAiEnabled: async () => {},
        focusConversation: async () => ({ ok: true }),
        sendText: async () => ({ ok: true }),
      }),
    })
    cleanup.push(() => backend.dispose())
    installSizeReplyGuard(backend.engine.aiClient, {
      resolve: (storeId, productId, question, thread) =>
        service.resolve(storeId, productId, question, thread),
    })
    const storeId = z.object({ id: z.string() }).parse(
      (
        await backend.execute({
          action: 'add-store',
          values: { platform: 'pdd-web', storeName: '隔离尺码店' },
        })
      ).data,
    ).id
    await backend.execute({
      action: 'save-product',
      storeId,
      values: {
        productId: 'fixture-size-product',
        title: '测试上衣',
        description: '',
        specifications: '',
        price: '',
        enabled: true,
      },
    })
    await service.execute('save-size-rule', {
      ...draft,
      bindings: [{ storeId, productId: 'fixture-size-product' }],
      expectedRevision: 0,
    })
    const result = z.object({ reply: z.string() }).parse(
      (
        await backend.execute({
          action: 'start-training',
          storeId,
          values: {
            question: '身高170cm，体重60kg，推荐什么码',
            productId: 'fixture-size-product',
            history: [],
          },
        })
      ).data,
    )
    expect(result.reply).toContain('M')
    expect(result.reply).not.toContain('L码')
    const messages = z
      .array(
        z.object({
          role: z.string(),
          content: z.union([z.string(), z.array(z.unknown())]),
        }),
      )
      .parse(sentMessages)
    const evidenceMessage = messages.find(
      (message) =>
        typeof message.content === 'string' &&
        message.content.startsWith(`${SIZE_RULES_MARKER}\n以下JSON`),
    )
    expect(evidenceMessage).toBeTruthy()
    const evidence = z
      .object({ eligibleLabels: z.array(z.string()) })
      .parse(JSON.parse((evidenceMessage!.content as string).split('\n').slice(2).join('\n')))
    expect(evidence.eligibleLabels).toEqual(['M'])
  })
})
