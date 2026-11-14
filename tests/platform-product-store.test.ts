import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPlatformProductStore } from '../electron/platform-product-store'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})
const detail = () => ({
  productId: 'goods-1',
  title: '门卡',
  merchantCode: 'GOODS-CODE',
  description: '已验证说明',
  attributes: [{ name: '品牌', value: '测试品牌' }],
  images: [],
  capturedAt: 100,
  sourceUrl: 'https://mms.pinduoduo.com/goods/goods_detail?goods_id=1',
  skus: [
    {
      skuId: 'sku-1',
      specs: [{ name: '版本', value: '全球版' }],
      merchantCode: 'SKU-CODE',
      barcode: '0001234567890',
      price: '32.00',
      stock: 8,
    },
  ],
  detailStatus: 'complete' as const,
  detailNote: '',
})
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-platform-product-'))
  roots.push(directory)
  let active = true
  const options = {
    directory,
    assertActive: () => {
      if (!active) throw Error('工作区已变化')
    },
    assertStore: (id: string) => {
      if (!['a', 'b'].includes(id)) throw Error('店铺不存在')
    },
  }
  return {
    directory,
    make: () => createPlatformProductStore(options),
    close: () => (active = false),
  }
}
it('结构化来源跨实例持久化，隔离店铺且编码与条码不混用', () => {
  const f = fixture()
  f.make().upsert('a', detail())
  expect(f.make().get('a', 'goods-1')).toEqual(detail())
  expect(f.make().get('b', 'goods-1')).toBeNull()
  const missing = {
    ...detail(),
    productId: 'goods-2',
    merchantCode: '',
    skus: [{ ...detail().skus[0], barcode: '' }],
  }
  f.make().upsert('a', missing)
  expect(f.make().get('a', 'goods-2')?.skus[0]).toMatchObject({
    merchantCode: 'SKU-CODE',
    barcode: '',
  })
})
it('拒绝重复SKU、非法输入和过期工作区，不覆盖已有有效来源', () => {
  const f = fixture(),
    store = f.make()
  store.upsert('a', detail())
  expect(() =>
    store.upsert('a', { ...detail(), skus: [detail().skus[0], detail().skus[0]] }),
  ).toThrow()
  expect(() => store.upsert('a', { ...detail(), accountId: 'untrusted' })).toThrow()
  expect(() =>
    store.upsert('a', { ...detail(), skus: [{ ...detail().skus[0], stock: -1 }] }),
  ).toThrow()
  expect(store.get('a', 'goods-1')).toEqual(detail())
  f.close()
  expect(() => store.get('a', 'goods-1')).toThrow('工作区已变化')
})
it('损坏来源档案明确失败，保留原文件', () => {
  const f = fixture(),
    store = f.make()
  store.upsert('a', detail())
  const directory = path.join(f.directory, 'platform-products')
  const target = path.join(directory, fs.readdirSync(directory)[0])
  fs.writeFileSync(target, '{broken')
  expect(() => f.make().get('a', 'goods-1')).toThrow('存档损坏')
  expect(() => f.make().upsert('a', detail())).toThrow('存档损坏')
  expect(fs.readFileSync(target, 'utf8')).toBe('{broken')
})
it('未暴露SKU ID时保留空值，以真实规格组合区分，不生成假编号', () => {
  const f = fixture(),
    store = f.make()
  const first = { ...detail().skus[0], skuId: '' }
  const second = {
    ...first,
    specs: [{ name: '版本', value: '国内版' }],
    merchantCode: '',
    barcode: '',
  }
  store.upsert('a', { ...detail(), skus: [first, second] })
  expect(store.get('a', 'goods-1')?.skus.map((row) => row.skuId)).toEqual(['', ''])
  expect(() =>
    store.upsert('a', { ...detail(), skus: [first, { ...first, skuId: 'other' }] }),
  ).toThrow('规格组合重复')
})
it('同店多次读取只解析一次，返回值不污染缓存，外部变化与upsert均失效', () => {
  const f = fixture(),
    store = f.make()
  store.upsert('a', detail())
  const read = vi.spyOn(fs, 'readFileSync')
  const first = store.get('a', 'goods-1')!
  first.title = '调用方修改'
  first.skus[0].barcode = '伪造条码'
  expect(store.get('a', 'goods-1')?.title).toBe('门卡')
  expect(store.get('a', 'goods-1')?.skus[0].barcode).toBe('0001234567890')
  expect(read).toHaveBeenCalledTimes(1)
  const directory = path.join(f.directory, 'platform-products')
  const target = path.join(directory, fs.readdirSync(directory)[0])
  fs.writeFileSync(
    target,
    JSON.stringify({
      version: 1,
      items: [{ ...detail(), title: '外部更新后的商品', capturedAt: 200 }],
    }),
  )
  expect(store.get('a', 'goods-1')?.title).toBe('外部更新后的商品')
  expect(read).toHaveBeenCalledTimes(2)
  store.upsert('a', { ...detail(), title: '再次采集', capturedAt: 300 })
  expect(store.get('a', 'goods-1')?.title).toBe('再次采集')
  expect(read).toHaveBeenCalledTimes(3)
  expect(store.get('b', 'goods-1')).toBeNull()
})
