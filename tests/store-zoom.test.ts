import { expect, it, vi } from 'vitest'
import { applyStoreZoom } from '../electron/store-zoom'
import { storeZoomSchema } from '../src/shared/contracts/store-zoom'
it('按百分比缩放注册页面并恢复100%，拒绝异常范围与已关闭页面', () => {
  let factor = 1
  const setZoomFactor = vi.fn((value: number) => {
    factor = value
  })
  const page = { isDestroyed: () => false, setZoomFactor, getZoomFactor: () => factor }
  const adapter = { _wc: () => page }
  expect(applyStoreZoom(adapter, 175)).toBe(175)
  expect(setZoomFactor).toHaveBeenLastCalledWith(1.75)
  expect(applyStoreZoom(adapter, 100)).toBe(100)
  expect(() => applyStoreZoom(adapter, 1000)).toThrow('范围')
  expect(() => applyStoreZoom({ _wc: () => ({ ...page, isDestroyed: () => true }) }, 150)).toThrow(
    '不可缩放',
  )
  expect(
    storeZoomSchema.safeParse({ workspaceId: 'old', storeId: 's', percent: 150 }).success,
  ).toBe(false)
})
