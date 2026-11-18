import type { SizeRuleRecord } from '../../src/shared/contracts/size-rules'

/**
 * 规则归属是“店铺 + 商品”复合键，停用规则也占用绑定。
 * 该检查在启动读盘和每次保存前执行，不能只在界面层提示。
 */
export function assertUniqueBindingOwnership(rules: SizeRuleRecord[]): void {
  const owners = new Map<string, string>()
  for (const rule of rules)
    for (const binding of rule.bindings) {
      const key = JSON.stringify([binding.storeId, binding.productId])
      const owner = owners.get(key)
      if (owner)
        throw new Error(`店铺商品已归属规则“${owner}”，同一商品只能绑定一条尺码规则（含停用规则）`)
      owners.set(key, rule.name)
    }
}

export function assertUniqueRuleIds(rules: SizeRuleRecord[]): void {
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error('尺码规格规则编号重复')
    ids.add(rule.id)
  }
}

export function bindingKey(binding: { storeId: string; productId: string }): string {
  return JSON.stringify([binding.storeId, binding.productId])
}

/** Validate every distinct binding on save; cached conversation reads recheck the active one. */
export function uniqueBindings<T extends { storeId: string; productId: string }>(
  bindings: T[],
): T[] {
  const seen = new Set<string>()
  return bindings.filter((binding) => {
    const key = bindingKey(binding)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
