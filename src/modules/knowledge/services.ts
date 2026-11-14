import {
  intentsSchema,
  productsPageSchema,
  type CommandInput,
  type IntentPack,
} from '@/shared/contracts/backend'
import {
  candidateExists,
  candidatePack,
  productCandidates,
  type LearningCandidate,
} from './learning'

type Execute = (command: CommandInput) => Promise<{ data: Record<string, unknown> }>

/** 只复用现有业务命令；没有平台采集接口时不发明平台请求。 */
export function createLearningService(execute: Execute) {
  let saving = false
  return {
    async products(storeId: string) {
      const page = productsPageSchema.parse(
        (await execute({ action: 'list-products', storeId, values: { offset: 0, limit: 100 } }))
          .data,
      )
      return {
        candidates: productCandidates(storeId, page.items),
        total: page.total,
        loaded: page.items.length,
      }
    },
    async confirm(
      candidate: LearningCandidate,
      confirmed: boolean,
      isCurrent: () => boolean = () => true,
    ) {
      if (!confirmed) throw new Error('请先预览并确认候选')
      if (saving) throw new Error('正在入库，请稍候')
      saving = true
      try {
        const pack = candidatePack(candidate)
        const packs: IntentPack[] = intentsSchema.parse(
          (await execute({ action: 'list-intent-packs' })).data,
        ).packs
        if (candidateExists(candidate, packs))
          throw new Error('此来源与问答已入库，请到意图知识查看')
        if (!isCurrent()) throw new Error('店铺或工作区已变化，请重新预览')
        return await execute({ action: 'save-intent-pack', values: { ...pack } })
      } finally {
        saving = false
      }
    },
  }
}
