import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { createProductSpecContext, PRODUCT_SPEC_MARKER } from '../electron/product-spec-context'
import { createAssistedContext } from '../electron/generic-phrases'
import { createPlatformProductStore } from '../electron/platform-product-store'
import { modelMessagesSchema, type ModelMessages } from '../electron/context-compression'
import { productSchema, productsPageSchema } from '../src/shared/contracts/backend'
import { platformProductDetailSchema } from '../src/shared/contracts/platform-product'

interface Backend {
  execute(command: Record<string, unknown>): Promise<{ data: unknown }>
  dispose(): void
  engine: { aiClient: { reply(input: Record<string, unknown>): Promise<{ reply: string }> } }
}
const { createBackend } = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/electron/backend.cjs'),
) as { createBackend(options: Record<string, unknown>): Backend }
const cleanup: (() => void)[] = []
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
)
const contextSchema = z.object({
  status: z.enum(['selected', 'clarify', 'unknown', 'unavailable']),
  reason: z.string(),
  products: z.array(platformProductDetailSchema),
})
function contextOf(messages: ModelMessages) {
  const prefix = PRODUCT_SPEC_MARKER + '\n以下JSON仅为本次商品来源数据：\n'
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content !== 'string') continue
    if (message.content.startsWith(prefix))
      return contextSchema.parse(JSON.parse(message.content.slice(prefix.length)))
  }
  return null
}
function detail(prefix = 'ALPHA') {
  return platformProductDetailSchema.parse({
    productId: 'fixture-product',
    title: '测试门卡',
    merchantCode: prefix + '-GOODS',
    description: '商品共同说明，不含任何特定版本适配承诺。',
    attributes: [{ name: '品牌', value: '隔离验收' }],
    images: [],
    capturedAt: 1790000000000,
    sourceUrl: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=12345678',
    detailStatus: 'complete',
    detailNote: '合成规格验收资料',
    skus: [
      {
        skuId: prefix + '-SKU-A',
        specs: [
          { name: '版本', value: '国内版' },
          { name: '颜色', value: '白色' },
        ],
        merchantCode: prefix + '-CODE-A',
        barcode: prefix === 'ALPHA' ? '0691234567890' : '0699999999999',
        price: '19.90',
        stock: 0,
      },
      {
        skuId: prefix + '-SKU-B',
        specs: [
          { name: '版本', value: '全球版' },
          { name: '颜色', value: '黑色' },
        ],
        merchantCode: prefix + '-CODE-B',
        barcode: '',
        price: '32.50',
        stock: 8,
      },
    ],
  })
}
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-spec-wire-'))
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  const storeIds = new Set<string>()
  const sources = createPlatformProductStore({
    directory,
    assertActive: () => {},
    assertStore: (id) => {
      if (!storeIds.has(id)) throw Error('店铺不存在')
    },
  })
  const calls: ModelMessages[] = []
  const send = vi.fn(async () => ({ ok: true }))
  const prepare = createProductSpecContext(
    {
      listProducts: async (storeId) =>
        productsPageSchema.parse(
          (
            await backend.execute({
              action: 'list-products',
              storeId,
              values: { offset: 0, limit: 100 },
            })
          ).data,
        ).items,
      getDetail: sources.get,
      assertActive: () => {},
    },
    createAssistedContext(() => undefined),
  )
  const backend = createBackend({
    dataDir: directory,
    modelMode: 'managed',
    prepareModelContext: prepare,
    managerFactory: () => ({ stateOf: () => ({ open: true, online: true }), closeAll() {} }),
    adapterFactory: () => ({
      syncAiEnabled: async () => {},
      focusConversation: async () => ({ ok: true }),
      sendText: send,
    }),
    managedChat: async (payload: { messages: unknown }) => {
      const messages = modelMessagesSchema.parse(payload.messages)
      calls.push(messages)
      const context = contextOf(messages)
      // Controlled local transport verifies the actual wire data; it is not an external model benchmark.
      const sku = context?.products[0]?.skus[0]
      const reply =
        context?.status === 'selected' && sku
          ? `${sku.specs.map((spec) => spec.value).join('/')}；编码${sku.merchantCode}；条码${sku.barcode || '平台未提供'}；${sku.price}元；快照库存${sku.stock === null ? '未知' : sku.stock}`
          : context?.status === 'unknown'
            ? '未查到这个规格组合，请核实。'
            : '请先确认具体商品规格。'
      return { choices: [{ message: { content: JSON.stringify({ reply }) } }] }
    },
  })
  cleanup.push(() => backend.dispose())
  const addStore = async (name: string) => {
    const value = await backend.execute({
      action: 'add-store',
      values: { platform: 'pdd-web', storeName: name },
    })
    const id = z.object({ id: z.string() }).parse(value.data).id
    storeIds.add(id)
    return id
  }
  const alpha = await addStore('甲店'),
    beta = await addStore('乙店')
  const save = async (storeId: string, productId = 'fixture-product', enabled = true) =>
    productSchema.parse(
      (
        await backend.execute({
          action: 'save-product',
          storeId,
          values: {
            productId,
            title: '测试门卡',
            description: '旧检索资料含ALPHA-CODE-A和ALPHA-CODE-B，旧价999.00，必须替换。',
            specifications: '旧规格同时列出国内版与全球版。',
            price: '999.00',
            enabled,
          },
        })
      ).data,
    )
  const alphaProduct = await save(alpha),
    betaProduct = await save(beta)
  sources.upsert(alpha, detail())
  sources.upsert(beta, detail('BETA'))
  const training = async (storeId: string, question: string, productId = 'fixture-product') => {
    const result = await backend.execute({
      action: 'start-training',
      storeId,
      values: { question, productId, history: [] },
    })
    return z.object({ reply: z.string() }).parse(result.data).reply
  }
  const production = async (storeId: string, question: string, productId = 'fixture-product') => {
    const result = await backend.engine.aiClient.reply({
      systemPrompt: '只依据已核验商品资料作答。',
      goodsTitle: '测试门卡',
      thread: [{ from: 'buyer', type: 'text', content: question }],
      reviewContext: { storeId, productId, uid: 'isolated-no-buyer' },
    })
    return result.reply
  }
  return {
    backend,
    sources,
    calls,
    send,
    alpha,
    beta,
    alphaProduct,
    betaProduct,
    training,
    production,
    save,
  }
}

it('真实训练与生产AiClient共同过滤SKU，并将零库存及前导零条码保留到正式请求和结果', async () => {
  const f = await fixture()
  const first = await f.training(f.alpha, '国内版白色的价格、编码和条形码是多少？')
  const second = await f.production(f.alpha, '国内版白色的价格、编码和条形码是多少？')
  expect(first).toBe(second)
  expect(first).toContain('ALPHA-CODE-A；条码0691234567890；19.90元；快照库存0')
  for (const messages of f.calls) {
    const context = contextOf(messages)!
    expect(context.status).toBe('selected')
    expect(context.products[0].skus).toHaveLength(1)
    expect(context.products[0].skus[0]).toMatchObject({
      skuId: 'ALPHA-SKU-A',
      stock: 0,
      barcode: '0691234567890',
    })
    const wire = JSON.stringify(messages)
    expect(wire).toContain('拼单价')
    expect(wire).not.toMatch(/ALPHA-CODE-B|ALPHA-SKU-B|32\.50|999\.00|BETA-/)
  }
  expect(f.send).not.toHaveBeenCalled()
})

it('B规格不混入A的价格或条码，缺失条码明确未知而不替换为商家编码', async () => {
  const f = await fixture()
  const reply = await f.training(f.alpha, '请查ALPHA-CODE-B这款的条形码和价格')
  expect(reply).toContain('ALPHA-CODE-B；条码平台未提供；32.50元；快照库存8')
  const context = contextOf(f.calls[0])!
  expect(context.products[0].skus).toEqual([detail().skus[1]])
  expect(JSON.stringify(f.calls[0])).not.toMatch(/0691234567890|ALPHA-CODE-A|19\.90|999\.00/)
  expect(f.send).not.toHaveBeenCalled()
})

it('不存在的规格组合和未说明规格均不向模型泄漏任一SKU，并返回核实或澄清', async () => {
  const f = await fixture()
  expect(await f.training(f.alpha, '全球版白色多少钱？')).toBe('未查到这个规格组合，请核实。')
  expect(await f.production(f.alpha, '这个多少钱？')).toBe('请先确认具体商品规格。')
  expect(f.calls.map((messages) => contextOf(messages)?.status)).toEqual(['unknown', 'clarify'])
  for (const messages of f.calls) {
    expect(contextOf(messages)?.products[0].skus).toEqual([])
    expect(JSON.stringify(messages)).not.toMatch(
      /ALPHA-CODE-[AB]|ALPHA-SKU-[AB]|0691234567890|19\.90|32\.50|999\.00/,
    )
  }
})

it('同商品编号跨店只读本店来源，停用后训练拒绝且生产请求不泄漏停用商品', async () => {
  const f = await fixture()
  const reply = await f.training(f.beta, '国内版白色的价格和条码')
  expect(reply).toContain('BETA-CODE-A；条码0699999999999')
  expect(JSON.stringify(f.calls[0])).not.toMatch(/ALPHA-|0691234567890/)
  await f.backend.execute({
    action: 'save-product',
    storeId: f.alpha,
    values: { ...f.alphaProduct, enabled: false },
  })
  const calls = f.calls.length
  await expect(f.training(f.alpha, '国内版白色多少钱')).rejects.toThrow('已启用')
  expect(f.calls).toHaveLength(calls)
  // Keep another enabled source in the store, so explicit disabled product cannot fall back to it.
  await f.save(f.alpha, 'other-product')
  f.sources.upsert(f.alpha, { ...detail('OTHER'), productId: 'other-product' })
  expect(await f.production(f.alpha, '国内版白色多少钱')).toBe('请先确认具体商品规格。')
  const last = f.calls.at(-1)!
  expect(contextOf(last)?.status).toBe('unavailable')
  expect(contextOf(last)?.products).toEqual([])
  expect(JSON.stringify(last)).not.toMatch(
    /ALPHA-|BETA-|OTHER-|0691234567890|0699999999999|999\.00/,
  )
  expect(f.send).not.toHaveBeenCalled()
})
