import { z } from 'zod'

const code = z.string().trim().max(200)
const attribute = z
  .object({ name: z.string().trim().min(1).max(200), value: z.string().trim().min(1).max(1000) })
  .strict()
const secureUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => new URL(value).protocol === 'https:', '来源必须为HTTPS')
export const platformProductSkuSchema = z
  .object({
    skuId: z.string().trim().max(100),
    specs: z.array(attribute).max(30),
    merchantCode: code,
    barcode: code,
    price: z.string().trim().max(100),
    stock: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .refine(
    (row) => new Set(row.specs.map((spec) => spec.name)).size === row.specs.length,
    'SKU规格名称重复',
  )
export type PlatformProductSku = z.infer<typeof platformProductSkuSchema>
export const platformProductDetailSchema = z
  .object({
    productId: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(500),
    merchantCode: code,
    description: z.string().max(20000),
    attributes: z.array(attribute).max(200),
    images: z.array(secureUrl).max(200),
    skus: z.array(platformProductSkuSchema).max(1000),
    capturedAt: z.number().finite().nonnegative(),
    sourceUrl: secureUrl,
    detailStatus: z.enum(['complete', 'partial']).default('partial'),
    detailNote: z.string().max(2000).default(''),
  })
  .strict()
  .refine((row) => {
    const ids = row.skus.map((sku) => sku.skuId).filter(Boolean)
    const specs = row.skus.map((sku) =>
      JSON.stringify([...sku.specs].sort((a, b) => a.name.localeCompare(b.name))),
    )
    return new Set(ids).size === ids.length && new Set(specs).size === specs.length
  }, 'SKU编号或规格组合重复')
export type PlatformProductDetail = z.infer<typeof platformProductDetailSchema>
