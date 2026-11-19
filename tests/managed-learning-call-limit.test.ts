import { expect, it } from 'vitest'
import { managedContextPolicySchema } from '../electron/managed-context-policy'

function projection(calls: number) {
  return {
    default_model: 'managed-1',
    models: [{ id: 'managed-1', name: '托管模型' }],
    max_tokens: 512,
    policy_version: 1,
    runtime_context: {
      enabled: false,
      retrieval_budget: 3000,
      retrieval_order: ['binding', 'store', 'canonical', 'template'],
    },
    learning: {
      enabled: false,
      vision_enabled: true,
      allowed_sources: ['pdd_detail_text', 'pdd_detail_image'],
      max_calls_per_product: calls,
      max_output_tokens: 4096,
      requires_review: true,
      video_mode: 'disabled',
      asr_mode: 'disabled',
    },
  }
}

it.each([20, 37, 40])('accepts an explicit %i-call policy without enabling learning', (calls) => {
  const policy = managedContextPolicySchema.parse(projection(calls))
  expect(policy.learning.max_calls_per_product).toBe(calls)
  expect(policy.learning.enabled).toBe(false)
  expect(policy.learning.requires_review).toBe(true)
})

it.each([0, 41, 37.5])('rejects an invalid %s-call policy', (calls) => {
  expect(managedContextPolicySchema.safeParse(projection(calls)).success).toBe(false)
})
