// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createCollectedProductWriter } from '../electron/collected-products'
import type { Product } from '../src/shared/contracts/backend'
const identity = { storeId: 's', platform: 'pdd', accountId: 'a', platformStoreId: 'm' }
const goods = Array.from({ length: 7 }, (_, n) => ({
  id: `p${n}`,
  title: `商品${n}`,
  description: '资料',
  specifications: '规格',
}))
function fixture() {
  const rows: Product[] = []
  let revision = 0
  const execute = vi.fn(
    async (command: {
      action: 'list-products' | 'save-product'
      storeId: string
      values: Record<string, unknown>
    }) => {
      if (command.action === 'list-products')
        return {
          status: 'ok',
          data: {
            revision,
            total: rows.length,
            items: rows.slice(
              Number(command.values.offset),
              Number(command.values.offset) + Number(command.values.limit),
            ),
          },
        }
      const row = {
        ...command.values,
        id: `id${rows.length}`,
        version: 1,
        updatedAt: 1,
        storeId: command.storeId,
      } as Product
      rows.push(row)
      revision++
      return { status: 'ok', data: row }
    },
  )
  const assertIdentity = vi.fn(async () => {})
  const writer = createCollectedProductWriter({
    execute,
    assertActive: () => {},
    assertStore: () => {},
    assertIdentity,
  })
  return { rows, execute, assertIdentity, writer }
}
it('重复采集刷新平台详情侧档但不覆盖人工商品正文或启用状态', async () => {
  const f = fixture()
  await f.writer.write({ identity, products: [goods[0]!], signal: new AbortController().signal })
  f.rows[0]!.description = '人工安装说明'
  f.rows[0]!.enabled = true
  const detail = {
    productId: 'p0',
    title: '商品0',
    merchantCode: 'PLATFORM-1',
    description: '平台资料',
    attributes: [],
    images: [],
    skus: [
      {
        skuId: 'sku-a',
        specs: [{ name: '型号', value: 'A' }],
        merchantCode: 'A',
        barcode: '6901234567892',
        price: '19.90',
        stock: 0,
      },
    ],
    capturedAt: 1,
    sourceUrl: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=p0',
    detailStatus: 'partial' as const,
    detailNote: '',
  }
  const savePlatformProduct = vi.fn()
  const writer = createCollectedProductWriter({
    execute: f.execute,
    assertActive: () => {},
    assertStore: () => {},
    assertIdentity: f.assertIdentity,
    savePlatformProduct,
  })
  await writer.write({
    identity,
    products: [{ ...goods[0]!, platformDetail: detail }],
    signal: new AbortController().signal,
  })
  expect(savePlatformProduct).toHaveBeenCalledWith('s', detail)
  expect(f.rows[0]).toMatchObject({ description: '人工安装说明', enabled: true })
  expect(f.rows).toHaveLength(1)
})
it('七个真实来源商品写入停用行，重复读取不重复且人工编辑不覆盖', async () => {
  const f = fixture(),
    input = { identity, products: goods, signal: new AbortController().signal }
  await f.writer.write(input)
  expect(f.rows).toHaveLength(7)
  expect(f.rows.every((row) => row.enabled === false)).toBe(true)
  f.rows[0]!.title = '人工编辑'
  f.rows[0]!.enabled = true
  await createCollectedProductWriter({
    execute: f.execute,
    assertActive: () => {},
    assertStore: () => {},
    assertIdentity: f.assertIdentity,
  }).write(input)
  expect(f.rows).toHaveLength(7)
  expect(f.rows[0]).toMatchObject({ title: '人工编辑', enabled: true })
})
it('字段超出原商品契约时整页拒绝，不截断，不先写前面的商品', async () => {
  const f = fixture()
  await expect(
    f.writer.write({
      identity,
      products: [goods[0]!, { ...goods[1]!, description: 'x'.repeat(6001) }],
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow()
  expect(f.rows).toHaveLength(0)
})
it('账号变化或取消阻断，部分失败如实抛出，重试可恢复', async () => {
  const f = fixture(),
    controller = new AbortController()
  f.assertIdentity.mockImplementation(async () => {
    if (f.rows.length === 1) throw Error('账号已变化')
  })
  await expect(
    f.writer.write({ identity, products: goods, signal: controller.signal }),
  ).rejects.toThrow('账号')
  expect(f.rows).toHaveLength(1)
  f.assertIdentity.mockImplementation(async () => {})
  await f.writer.write({ identity, products: goods, signal: controller.signal })
  expect(f.rows).toHaveLength(7)
  controller.abort()
  await expect(
    f.writer.write({ identity, products: goods, signal: controller.signal }),
  ).rejects.toThrow()
})
it('跨店行和重复分页不能变成完整列表', async () => {
  const f = fixture()
  f.execute.mockImplementation(async () => ({
    status: 'ok',
    data: {
      revision: 0,
      total: 1,
      items: [
        {
          ...goods[0],
          productId: 'p',
          id: 'i',
          storeId: 'other',
          version: 1,
          updatedAt: 1,
          price: '',
          enabled: false,
        },
      ],
    },
  }))
  await expect(
    f.writer.write({ identity, products: goods, signal: new AbortController().signal }),
  ).rejects.toThrow('店铺')
  expect(f.rows).toHaveLength(0)
})

it('原列表重复页停止，不把错误来源当已读完', async () => {
  const f = fixture()
  f.execute.mockImplementation(async () => ({
    status: 'ok',
    data: {
      revision: 0,
      total: 2,
      items: [
        {
          id: 'same',
          storeId: 's',
          productId: 'existing',
          version: 1,
          updatedAt: 1,
          title: '已存在',
          description: '',
          specifications: '',
          price: '',
          enabled: false,
        },
      ],
    },
  }))
  await expect(
    f.writer.write({ identity, products: goods, signal: new AbortController().signal }),
  ).rejects.toThrow('重复')
  expect(f.rows).toHaveLength(0)
})
