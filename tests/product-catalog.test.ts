import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createProductCatalog } from '../electron/product-catalog'
import type { PlatformProductDetail } from '../src/shared/contracts/platform-product'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-catalog-'))
  roots.push(directory)
  const items = Array.from({ length: 135 }, (_, n) => ({
    id: 'p' + n,
    version: 1,
    updatedAt: 1,
    storeId: 'a',
    productId: 'platform-' + n,
    title: n === 134 ? '最后一页目标商品' : '普通商品',
    description: '',
    specifications: '',
    price: '',
    enabled: true,
  }))
  let revision = 1,
    active = true
  const details = new Map<string, PlatformProductDetail>()
  const execute = vi.fn(
    async (command: { storeId: string; values: { offset: number; limit: number } }) => ({
      status: 'ok',
      message: '',
      data: {
        revision,
        total: items.length,
        items: items.slice(command.values.offset, command.values.offset + command.values.limit),
      },
    }),
  )
  const assertActive = () => {
    if (!active) throw Error('工作区已变化')
  }
  const assertStore = (id: string) => {
    if (id !== 'a') throw Error('店铺不存在')
  }
  const make = () =>
    createProductCatalog({
      directory,
      execute,
      assertActive,
      assertStore,
      getPlatformProduct: (_storeId, productId) => details.get(productId) ?? null,
    })
  return {
    directory,
    items,
    details,
    execute,
    make,
    setRevision: (value: number) => (revision = value),
    close: () => (active = false),
  }
}
function source(): PlatformProductDetail {
  return {
    productId: 'platform-134',
    title: '最后一页目标商品',
    merchantCode: 'PLATFORM-GOODS',
    description: '平台资料',
    attributes: [],
    images: [],
    capturedAt: 1,
    sourceUrl: 'https://mms.pinduoduo.com/goods/goods_list',
    detailStatus: 'complete',
    detailNote: '',
    skus: [
      {
        skuId: 'real-sku',
        merchantCode: 'SKU-CODE',
        barcode: '',
        specs: [{ name: '版本', value: '全球版' }],
        price: '32',
        stock: 8,
      },
    ],
  }
}
it('搜索全店各页，未采集平台编码时明确为空，不改变商品编号', async () => {
  const f = fixture(),
    page = await f.make().list('a', { query: '最后一页' })
  expect(page.total).toBe(1)
  expect(page.items[0]).toMatchObject({
    id: 'p134',
    merchantCode: '',
    platformDetail: null,
    productId: 'platform-134',
  })
  expect(f.execute).toHaveBeenCalledTimes(2)
})
it('只读平台商品编码与SKU编码可检索，并返回完整结构化来源', async () => {
  const f = fixture()
  f.details.set('platform-134', source())
  for (const code of ['platform-goods', 'sku-code']) {
    const page = await f.make().list('a', { merchantCode: code })
    expect(page.total).toBe(1)
    expect(page.items[0].merchantCode).toBe('PLATFORM-GOODS')
    expect(page.items[0].platformDetail?.skus[0].skuId).toBe('real-sku')
  }
})
it('旧本机编码不再冒充平台编码，原存档不读取也不覆盖', async () => {
  const f = fixture(),
    directory = path.join(f.directory, 'product-codes')
  fs.mkdirSync(directory)
  const target = path.join(directory, 'legacy.json')
  fs.writeFileSync(target, '{historical-local-data')
  const page = await f.make().list('a', {})
  expect(page.items.every((row) => row.merchantCode === '')).toBe(true)
  expect(fs.readFileSync(target, 'utf8')).toBe('{historical-local-data')
})
it('旧编码写入命令被拒绝，不产生本机假平台编码', async () => {
  const f = fixture(),
    catalog = f.make()
  const command = {
    revision: 0,
    confirmed: true as const,
    rows: [{ id: 'p0', version: 1, merchantCode: 'FAKE' }],
  }
  await expect(catalog.setCodes('a', command)).rejects.toThrow('只读来源')
  await expect(catalog.setCodes('b', command)).rejects.toThrow('店铺不存在')
  expect(fs.existsSync(path.join(f.directory, 'product-codes'))).toBe(false)
})
it('账号关闭后的迟到读取不会发布', async () => {
  const f = fixture()
  f.execute.mockImplementationOnce(async () => {
    f.close()
    return {
      status: 'ok',
      message: '',
      data: { revision: 1, total: f.items.length, items: f.items.slice(0, 100) },
    }
  })
  await expect(f.make().list('a', {})).rejects.toThrow('工作区已变化')
})
it('分页期间修订变化不会声明全店搜索完整', async () => {
  const f = fixture()
  f.execute.mockImplementationOnce(async () => {
    f.setRevision(2)
    return {
      status: 'ok',
      message: '',
      data: { revision: 1, total: f.items.length, items: f.items.slice(0, 100) },
    }
  })
  await expect(f.make().list('a', {})).rejects.toThrow('采集期间已变化')
})
it('分页重复、跨店行和空缺都被拒绝', async () => {
  for (const variant of ['duplicate', 'foreign', 'empty']) {
    const f = fixture()
    f.execute.mockImplementation(async (command) => ({
      status: 'ok',
      message: '',
      data: {
        revision: 1,
        total: 135,
        items:
          command.values.offset === 0
            ? f.items.slice(0, 100)
            : variant === 'empty'
              ? []
              : variant === 'foreign'
                ? [{ ...f.items[100], storeId: 'b' }]
                : f.items.slice(0, 35),
      },
    }))
    await expect(f.make().list('a', {})).rejects.toThrow(/分页重复|店铺不符|分页为空/)
  }
})
it('来源编号不符及未知查询字段不能进入商品目录', async () => {
  const f = fixture()
  f.details.set('platform-134', { ...source(), productId: 'other' })
  await expect(f.make().list('a', {})).rejects.toThrow('来源编号不一致')
  await expect(f.make().list('a', { accountId: 'other' })).rejects.toThrow()
})
