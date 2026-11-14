import { expect, it } from 'vitest'
import {
  mergePlatformProductDetail,
  combinePlatformProductViewports,
} from '../electron/platform-product-merge'
import type { PlatformProductDetail } from '../src/shared/contracts/platform-product'
const sku = {
  skuId: '',
  specs: [{ name: '型号', value: 'A款' }],
  merchantCode: 'A',
  barcode: '',
  price: '19.9',
  stock: 0,
}
const dom: PlatformProductDetail = {
  productId: 'g',
  title: '测试商品',
  merchantCode: 'G',
  description: '',
  attributes: [],
  images: [],
  skus: [
    sku,
    { ...sku, specs: [{ name: '型号', value: 'B款' }], merchantCode: 'B', price: '18.00' },
  ],
  capturedAt: 1,
  sourceUrl: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=g',
  detailStatus: 'partial',
  detailNote: '',
}
it('按真实规格组合合并原生ID和条码，不能按行序错配', () => {
  const native = {
    productId: 'g',
    mallId: 'm',
    title: '测试商品',
    merchantCode: 'G',
    description: '原始说明',
    skus: [
      { ...dom.skus[1]!, skuId: 'b', barcode: '0002' },
      { ...sku, skuId: 'a', barcode: '0001', price: '19.90' },
    ],
  }
  const detail = mergePlatformProductDetail(dom, native, 'm')
  expect(detail.skus[0]).toMatchObject({ skuId: 'a', barcode: '0001', stock: 0 })
  expect(detail.skus[1]).toMatchObject({ skuId: 'b', barcode: '0002' })
  expect(detail.description).toBe('原始说明')
  expect(() => mergePlatformProductDetail(dom, { ...native, mallId: 'other' }, 'm')).toThrow('身份')
  expect(() =>
    mergePlatformProductDetail(
      dom,
      { ...native, skus: [{ ...native.skus[0]!, price: '1' }, native.skus[1]!] },
      'm',
    ),
  ).toThrow('价格')
})
it('虚拟滚动重叠行按规格去重，冲突快照拒绝合并', () => {
  const first = { ...dom, skus: [dom.skus[0]!] }
  const next = { ...dom, capturedAt: 2, skus: [...dom.skus] }
  expect(combinePlatformProductViewports(first, next).skus).toHaveLength(2)
  expect(() =>
    combinePlatformProductViewports(first, { ...next, skus: [{ ...dom.skus[0]!, price: '9' }] }),
  ).toThrow('变化')
  expect(() => combinePlatformProductViewports(first, { ...next, productId: 'other' })).toThrow(
    '身份',
  )
})
