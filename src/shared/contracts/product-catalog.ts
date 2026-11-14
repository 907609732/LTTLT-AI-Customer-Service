import { z } from 'zod'
import { productSchema } from './backend'

export const productCatalogRowSchema = productSchema.extend({
  merchantCode: z.string().max(100).default(''),
})
export type ProductCatalogRow = z.infer<typeof productCatalogRowSchema>
export const productCatalogQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(200).default(20),
    query: z.string().trim().max(200).default(''),
    merchantCode: z.string().trim().max(100).default(''),
  })
  .strict()
export type ProductCatalogQuery = z.input<typeof productCatalogQuerySchema>
export const productCatalogPageSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    codesRevision: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().max(10000),
    items: z.array(productCatalogRowSchema).max(200),
  })
  .strict()
export type ProductCatalogPage = z.infer<typeof productCatalogPageSchema>
export const setProductCodesSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    rows: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            version: z.number().int().positive(),
            merchantCode: z.string().trim().max(100),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (value) => new Set(value.rows.map((row) => row.id)).size === value.rows.length,
    '商品重复',
  )
export type SetProductCodesInput = z.infer<typeof setProductCodesSchema>
export const setProductCodesResultSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict()
