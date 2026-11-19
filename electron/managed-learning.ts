import type { KnowledgeRepository } from './knowledge/repository'
import { collectorMaterialLabels } from './knowledge/collector-materials'
import type { KnowledgeLearningSource, KnowledgeModelPort } from './knowledge-runtime'

const pddHosts = ['pinduoduo.com', 'yangkeduo.com']
const isPddHost = (hostname: string) =>
  pddHosts.some((host) => hostname === host || hostname.endsWith('.' + host))

/**
 * These server rejections are emitted before the quota/trial reservation and
 * therefore cannot mean a paid call. Unknown transport results stay uncertain.
 */
const preAdmissionCodes = new Set([
  'invalid_request',
  'policy_version_required',
  'policy_version_stale',
  'account_disabled',
  'model_not_ready',
  'model_not_allowed',
  'vision_unavailable',
  'learning_disabled',
  'learning_source_not_allowed',
  'learning_source_mismatch',
  'vision_disabled',
  'context_too_large',
  'configuration_unavailable',
])

export interface ManagedLearningPolicyApproval {
  policyVersion: number
  maxTokens: number
  maxCallsPerProduct: number
}

/**
 * Resolve only collector-owned PDD detail pages into the server's closed source
 * vocabulary. A user document, chat import or source from another platform can
 * never be relabeled as a Pinduoduo detail page.
 */
export function resolvePddLearningSource(
  repository: KnowledgeRepository,
  platformForStore: (storeId: string) => string | undefined,
  sourceId: string,
  withImages: boolean,
): KnowledgeLearningSource {
  const source = repository.getSource(sourceId)
  if (!source || source.removed) throw Error('学习来源不存在或已移除；未发送学习请求')
  if (source.kind !== 'platform' || !source.bindingId)
    throw Error('该资料不是拼多多商品详情采集来源，不能标记为 pdd_detail；未发送学习请求')
  const binding = repository.getBinding(source.bindingId)
  if (!binding?.active || binding.storeId !== source.storeId)
    throw Error('学习来源的商品关联无效；未发送学习请求')
  if (platformForStore(binding.storeId) !== 'pdd-web')
    throw Error('该店铺不是拼多多店铺，不能标记为 pdd_detail；未发送学习请求')
  const image = withImages
  const expected = image ? collectorMaterialLabels.images : null
  const textLabels: string[] = [collectorMaterialLabels.static, collectorMaterialLabels.dynamic]
  if (image ? source.label !== expected : !textLabels.includes(source.label))
    throw Error('学习来源与 pdd_detail_text/pdd_detail_image 语义不一致；未发送学习请求')
  const raw = source.locator.url
  if (!raw) throw Error('学习来源缺少拼多多采集地址；未发送学习请求')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw Error('学习来源地址无效；未发送学习请求')
  }
  if (url.protocol !== 'https:' || url.username || url.password || !isPddHost(url.hostname))
    throw Error('学习来源不是可信的拼多多采集地址；未发送学习请求')
  return image ? 'pdd_detail_image' : 'pdd_detail_text'
}

/**
 * Managed-only decorator around the knowledge model port. It deliberately has
 * no URL, key or account argument. The fixed managed chat transport keeps the
 * native request id, owner, timeout, abort signal and trace handling.
 */
export function createManagedLearningPort(options: {
  base: KnowledgeModelPort
  repository: KnowledgeRepository
  platformForStore(storeId: string): string | undefined
  policy(input: {
    learningSource: KnowledgeLearningSource
    withImages: boolean
    signal?: AbortSignal
  }): Promise<ManagedLearningPolicyApproval>
  assertReady?(): void
}): KnowledgeModelPort {
  const resolve = (sourceId: string, withImages: boolean) =>
    resolvePddLearningSource(options.repository, options.platformForStore, sourceId, withImages)
  const preflight = async (input: {
    sourceId: string
    withImages: boolean
    signal?: AbortSignal
    isCurrent?: () => boolean
  }) => {
    const learningSource = resolve(input.sourceId, input.withImages)
    const approval = await options.policy({
      learningSource,
      withImages: input.withImages,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    if (input.signal?.aborted || input.isCurrent?.() === false) throw Error('知识任务已取消')
    // Source rows can change while the policy request is in flight.
    if (resolve(input.sourceId, input.withImages) !== learningSource)
      throw Error('学习来源已变化，请重新估算；未发送学习请求')
    if (
      !Number.isSafeInteger(approval.policyVersion) ||
      approval.policyVersion < 0 ||
      !Number.isSafeInteger(approval.maxTokens) ||
      approval.maxTokens < 1 ||
      !Number.isSafeInteger(approval.maxCallsPerProduct) ||
      approval.maxCallsPerProduct < 1
    )
      throw Error('托管学习策略返回值无效；未发送学习请求')
    return { learningSource, ...approval }
  }
  return {
    ...options.base,
    async prepareLearning(input) {
      const approval = await preflight(input)
      return {
        maxTokens: approval.maxTokens,
        maxCallsPerProduct: approval.maxCallsPerProduct,
      }
    },
    async complete(input) {
      const { learning, purpose, policyVersion, learningSource, ...rest } = input
      if (!learning) {
        if (purpose !== undefined || policyVersion !== undefined || learningSource !== undefined)
          throw Error('学习用途、策略版本和来源必须由托管学习适配器预检生成；未发送请求')
        return options.base.complete(rest)
      }
      if (purpose !== undefined || policyVersion !== undefined || learningSource !== undefined)
        throw Error('学习用途、策略版本和来源不能由调用方直接声明；未发送请求')
      const approval = await preflight({
        sourceId: learning.sourceId,
        withImages: learning.withImages,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.isCurrent ? { isCurrent: input.isCurrent } : {}),
      })
      options.assertReady?.()
      if (input.signal?.aborted || input.isCurrent?.() === false) throw Error('知识任务已取消')
      let submitted = false
      const markSubmitted = () => {
        if (submitted) return
        learning.beforeSubmit({
          maxTokens: approval.maxTokens,
          maxCallsPerProduct: approval.maxCallsPerProduct,
        })
        submitted = true
      }
      // The vendor managed transport calls isCurrent only after its account
      // queue. Marking submission there avoids claiming a paid call while the
      // learning job is still waiting for a free managed slot.
      const current = () => {
        const value = input.signal?.aborted !== true && input.isCurrent?.() !== false
        if (value) {
          // The vendor calls this only inside its managed queue. Recheck the
          // owned source and live account/issue state at that exact boundary.
          resolve(learning.sourceId, learning.withImages)
          options.assertReady?.()
          markSubmitted()
        }
        return value
      }
      let result: string
      try {
        result = await options.base.complete({
          ...rest,
          maxTokens: approval.maxTokens,
          purpose: 'learning',
          policyVersion: approval.policyVersion,
          learningSource: approval.learningSource,
          isCurrent: current,
        })
      } catch (cause) {
        const code = cause instanceof Error ? Reflect.get(cause, 'code') : undefined
        // A known server pre-admission rejection never reserved quota. When the
        // current hook was not reached, no managed chat request was started.
        if (!submitted || preAdmissionCodes.has(String(code)))
          Object.assign(cause as Error, { knowledgeLearningNotCharged: true })
        throw cause
      }
      // A managed port must call current before the paid request. Returning a
      // result without that hook is handled by the learner as uncertain, not
      // silently accepted or marked free.
      return result
    },
  }
}
