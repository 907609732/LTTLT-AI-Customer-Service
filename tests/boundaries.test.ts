import { describe, expect, it } from 'vitest'
// 工具脚本保持 ESM，边界规则也用实际源码回归，避免检查器成为文档摆设。
import { checkSource, dependencyError } from '../scripts/check-boundaries.mjs'

describe('架构约束', () => {
  it('接受公开模块入口，拒绝反向依赖和跨模块内部引用', () => {
    expect(dependencyError('app/main.ts', 'modules/shops')).toBe('')
    expect(dependencyError('modules/quality/index.ts', 'modules/shops')).toBe('')
    expect(dependencyError('shared/ui/Button.vue', 'modules/shops')).not.toBe('')
    expect(
      dependencyError('modules/quality/index.ts', 'modules/shops/components/List.vue'),
    ).not.toBe('')
    expect(dependencyError('modules/shops/index.ts', 'app/services.ts')).not.toBe('')
  })
  it('拦截组件直接调用网络和存储', () => {
    expect(
      checkSource(
        'modules/shops/components/List.vue',
        "fetch('/shops'); localStorage.setItem('secret', 'x')",
      ),
    ).toHaveLength(2)
  })
})
