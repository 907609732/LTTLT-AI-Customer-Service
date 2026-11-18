import type { SizeRuleContext } from '../../src/shared/contracts/size-rules'
import type { SizeRulesService } from './service'

export interface SizeRulesAssembly {
  service?: SizeRulesService
  error: string
  resolve(
    storeId: string,
    productId: string,
    question: string,
    thread: unknown,
  ): Promise<SizeRuleContext | null>
  execute(
    action: string,
    payload: unknown,
  ): Promise<{ message: string; data: Record<string, unknown> }>
}

/**
 * Contain a corrupted/unsupported size-rules file to this domain. The rest of the local
 * runtime must still start; ordinary chat continues, while size questions and commands
 * fail closed with a clear recovery message instead of silently using no rules.
 */
export function createSizeRulesAssembly(createService: () => SizeRulesService): SizeRulesAssembly {
  let service: SizeRulesService | undefined
  let error = ''
  try {
    service = createService()
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  return {
    service,
    error,
    async resolve(storeId, productId, question, thread) {
      if (!service) return null
      return service.resolve(storeId, productId, question, thread)
    },
    async execute(action, payload) {
      if (!service) throw new Error(`尺码规则不可用：${error}`)
      return service.execute(action, payload)
    },
  }
}
