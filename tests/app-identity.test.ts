import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveAppUserData } from '../electron/app-identity'
import { PRODUCT_NAME } from '../src/shared/brand'

describe('灵兔 AI 改名的数据兼容', () => {
  it('新产品名继续定位原账户数据目录，不创建新的空账户', () => {
    expect(PRODUCT_NAME).toBe('灵兔 AI')
    expect(resolveAppUserData(path.resolve('profile-root'), '')).toBe(
      path.join(path.resolve('profile-root'), 'yunduo-ui-restored'),
    )
  })
  it('显式隔离目录仍优先，打包验收不能碰日常账户', () => {
    const isolated = path.resolve('isolated-brand-check')
    expect(resolveAppUserData(path.resolve('profile-root'), isolated)).toBe(isolated)
  })
})
