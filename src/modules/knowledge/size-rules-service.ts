import {
  sizeRuleExportResultSchema,
  sizeRuleFieldsSchema,
  sizeRuleListResultSchema,
  sizeRulePreviewSchema,
  sizeRuleRemoveResultSchema,
  sizeRuleSaveResultSchema,
  sizeRuleTemplateKindSchema,
  type SizeRuleExportResult,
  type SizeRuleFields,
  type SizeRuleListResult,
  type SizeRulePreview,
  type SizeRuleRemovePayload,
  type SizeRuleRemoveResult,
  type SizeRuleSavePayload,
  type SizeRuleSaveResult,
  type SizeRuleTemplateKind,
} from '../../shared/contracts/size-rules'
import { productCatalogPageSchema } from '../../shared/contracts/product-catalog'
import type { CommandInput } from '../../shared/contracts/backend'

type Execute = (command: CommandInput) => Promise<{ data: Record<string, unknown> }>

/** Renderer boundary: every command still goes through the existing runtime.execute bridge. */
export function createSizeRulesClient(execute: Execute) {
  return {
    async list(): Promise<SizeRuleListResult> {
      return sizeRuleListResultSchema.parse(
        (await execute({ action: 'list-size-rules', values: {} })).data,
      )
    },
    async save(payload: SizeRuleSavePayload): Promise<SizeRuleSaveResult> {
      return sizeRuleSaveResultSchema.parse(
        (await execute({ action: 'save-size-rule', values: payload })).data,
      )
    },
    async remove(payload: SizeRuleRemovePayload): Promise<SizeRuleRemoveResult> {
      return sizeRuleRemoveResultSchema.parse(
        (await execute({ action: 'remove-size-rule', values: payload })).data,
      )
    },
    async preview(table: string): Promise<SizeRulePreview> {
      return sizeRulePreviewSchema.parse(
        (await execute({ action: 'preview-size-table', values: { table } })).data,
      )
    },
    async exportCsv(id: string): Promise<SizeRuleExportResult> {
      return sizeRuleExportResultSchema.parse(
        (await execute({ action: 'export-size-table', values: { id } })).data,
      )
    },
    async template(kind: SizeRuleTemplateKind): Promise<SizeRuleFields> {
      return sizeRuleFieldsSchema.parse(
        (
          await execute({
            action: 'size-rule-template',
            values: { kind: sizeRuleTemplateKindSchema.parse(kind) },
          })
        ).data,
      )
    },
    async products(storeId: string, query: string, offset: number) {
      return productCatalogPageSchema.parse(
        (
          await execute({
            action: 'list-products',
            storeId,
            values: { offset, limit: 20, query },
          })
        ).data,
      )
    },
  }
}
