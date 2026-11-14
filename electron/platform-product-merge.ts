import {
  platformProductDetailSchema,
  type PlatformProductDetail,
} from '../src/shared/contracts/platform-product'
import type { NativePlatformProduct } from './platform-product-observer'
const signature = (specs: Array<{ name: string; value: string }>) =>
  JSON.stringify(
    specs.map((x) => [x.name.trim(), x.value.trim()]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
  )
const cents = (price: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(price)) throw Error('商品价格格式未核对')
  const [whole, fraction = ''] = price.split('.')
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
}
/** A virtual table can reuse rows; overlap must describe the same snapshot before deduplication. */
export function combinePlatformProductViewports(
  first: PlatformProductDetail,
  next: PlatformProductDetail,
): PlatformProductDetail {
  if (
    first.productId !== next.productId ||
    first.title !== next.title ||
    first.merchantCode !== next.merchantCode ||
    first.sourceUrl !== next.sourceUrl
  )
    throw Error('SKU滚动期间商品身份已变化')
  const rows = new Map(first.skus.map((row) => [signature(row.specs), row]))
  for (const row of next.skus) {
    const key = signature(row.specs),
      old = rows.get(key)
    if (
      old &&
      (old.skuId !== row.skuId ||
        old.merchantCode !== row.merchantCode ||
        old.barcode !== row.barcode ||
        old.price !== row.price ||
        old.stock !== row.stock)
    )
      throw Error('SKU滚动期间资料已变化')
    rows.set(key, row)
  }
  return platformProductDetailSchema.parse({
    ...first,
    capturedAt: next.capturedAt,
    skus: [...rows.values()],
  })
}
/** Reconcile by actual specification names and values, never native response row order. */
export function mergePlatformProductDetail(
  dom: PlatformProductDetail,
  native: NativePlatformProduct,
  mallId: string,
): PlatformProductDetail {
  if (
    dom.productId !== native.productId ||
    native.mallId !== mallId ||
    dom.title !== native.title ||
    dom.merchantCode !== native.merchantCode
  )
    throw Error('商品详情身份或平台编码不一致')
  const bySpec = new Map(native.skus.map((x) => [signature(x.specs), x]))
  if (bySpec.size !== native.skus.length || dom.skus.length !== bySpec.size)
    throw Error('商品SKU数量或规格组合不一致')
  const skus = dom.skus.map((row) => {
    const source = bySpec.get(signature(row.specs))
    if (!source) throw Error('商品SKU规格组合不一致')
    if (
      row.merchantCode !== source.merchantCode ||
      (row.skuId && row.skuId !== source.skuId) ||
      (row.barcode && row.barcode !== source.barcode)
    )
      throw Error('商品SKU编码或条形码不一致')
    if (row.price && source.price && cents(row.price) !== cents(source.price))
      throw Error('商品SKU价格不一致')
    if (row.stock !== null && source.stock !== null && row.stock !== source.stock)
      throw Error('商品SKU库存在读取期间已变化，请重试')
    return { ...source, specs: row.specs }
  })
  return platformProductDetailSchema.parse({
    ...dom,
    description: native.description || dom.description,
    skus,
    detailStatus: 'partial',
    detailNote:
      '商品与全部SKU已由原生响应和详情表格交叉核对；未提供的条形码保持空白。详情图片未OCR；价格和库存为采集时快照。',
  })
}
