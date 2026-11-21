import {
  sizeRuleExportPayloadSchema,
  sizeRuleExportResultSchema,
  sizeRuleFieldsSchema,
  sizeRuleListResultSchema,
  sizeRulePreviewPayloadSchema,
  sizeRulePreviewSchema,
  sizeRuleRemoveResultSchema,
  sizeRuleSaveResultSchema,
  sizeRuleTemplatePayloadSchema,
  type SizeBindingStatus,
  type SizeRuleBinding,
  type SizeRuleContext,
} from '../../src/shared/contracts/size-rules'
import { createSizeEvidenceResolver, type SizeEvidenceResolver } from './context'
import { createSizeRuleStore } from './store'
import {
  createSizeTableTemplate,
  exportSizeTable,
  previewSizeTable,
  sizeUnitOptions,
} from './table'

export interface SizeRulesServiceOptions {
  directory: string
  assertActive(): void
  checkBinding?(binding: SizeRuleBinding): Promise<SizeBindingStatus>
  /** Legacy boolean test port; production passes checkBinding. */
  isBindingValid?(binding: SizeRuleBinding): Promise<boolean>
  now?(): number
  id?(): string
  atomicWrite?(file: string, content: string): void
}

function validationMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = Reflect.get(error, 'issues')
    if (Array.isArray(issues))
      return issues
        .slice(0, 3)
        .map((issue) => String(Reflect.get(issue as object, 'message') ?? ''))
        .filter(Boolean)
        .join('；')
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Size rules receive the current data directory, workspace lease and real product-directory
 * validator from the composition root. Storage, evidence and CSV logic stay in focused modules.
 */
export function createSizeRulesService(options: SizeRulesServiceOptions) {
  const store = createSizeRuleStore(options)
  const evidence: SizeEvidenceResolver = createSizeEvidenceResolver({
    read: () => store.snapshot(),
    checkBinding: options.checkBinding,
    isBindingValid: options.isBindingValid,
    assertActive: options.assertActive,
  })
  return {
    async execute(
      action: string,
      payload: unknown,
    ): Promise<{ message: string; data: Record<string, unknown> }> {
      options.assertActive()
      if (action === 'list-size-rules') {
        const state = store.snapshot()
        return {
          message: '',
          data: sizeRuleListResultSchema.parse({
            revision: state.revision,
            total: state.rules.length,
            boundProducts: state.rules.reduce((sum, rule) => sum + rule.bindings.length, 0),
            units: sizeUnitOptions(),
            rules: state.rules,
          }),
        }
      }
      if (action === 'save-size-rule') {
        const result = await store.save(payload)
        return {
          message: result.rule.enabled
            ? '尺码规则已保存；AI 开关未改变，请核对后再用于接待。'
            : '尺码规则草稿已保存；未启用、未绑定商品或开启 AI。',
          data: sizeRuleSaveResultSchema.parse(result),
        }
      }
      if (action === 'remove-size-rule') {
        const result = store.remove(payload)
        return {
          message: '尺码规则已删除，原商品绑定已解除；知识包和聊天记录未改动。',
          data: sizeRuleRemoveResultSchema.parse(result),
        }
      }
      if (action === 'preview-size-table') {
        let parsed
        try {
          parsed = sizeRulePreviewPayloadSchema.parse(payload)
        } catch (error) {
          throw new Error(validationMessage(error))
        }
        return {
          message: '',
          data: sizeRulePreviewSchema.parse(previewSizeTable(parsed.table)),
        }
      }
      if (action === 'export-size-table') {
        const parsed = sizeRuleExportPayloadSchema.parse(payload)
        const rule = store.snapshot().rules.find((item) => item.id === parsed.id)
        if (!rule) throw new Error('尺码规则不存在，请刷新后重试')
        return {
          message: '',
          data: sizeRuleExportResultSchema.parse({ csv: exportSizeTable(rule) }),
        }
      }
      if (action === 'size-rule-template') {
        const parsed = sizeRuleTemplatePayloadSchema.parse(payload)
        return {
          message: '模板仅放入未保存草稿；未启用、未绑定商品或开启 AI。',
          data: sizeRuleFieldsSchema.parse(createSizeTableTemplate(parsed.kind)),
        }
      }
      throw new Error('不支持的尺码规则操作')
    },
    removeStore(storeId: string): number {
      options.assertActive()
      return store.removeStoreBindings(storeId)
    },
    resolve(
      storeId: string,
      productId: string,
      question: string,
      thread: unknown,
    ): Promise<SizeRuleContext | null> {
      return evidence.resolve(storeId, productId, question, thread)
    },
    candidateCurrent(
      generated: Pick<SizeRuleContext, 'ruleId' | 'ruleVersion' | 'storeId' | 'productId'>,
    ): string {
      options.assertActive()
      const rule = store
        .snapshot()
        .rules.find(
          (item) => item.id === generated.ruleId && item.version === generated.ruleVersion,
        )
      if (!rule || !rule.enabled) return '尺码规则已更新、停用或删除，旧候选已失效；请重新生成。'
      if (
        !rule.bindings.some(
          (binding) =>
            binding.storeId === generated.storeId && binding.productId === generated.productId,
        )
      )
        return '尺码规则已解除该商品绑定，旧候选已失效；请重新生成。'
      return ''
    },
  }
}

export type SizeRulesService = ReturnType<typeof createSizeRulesService>
