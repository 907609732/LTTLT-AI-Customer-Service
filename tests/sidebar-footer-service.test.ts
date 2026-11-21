import { afterEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({ isElectron: true, openExternal: vi.fn(async () => {}) }))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => desktop }))

import { OFFICIAL_TUTORIAL_URL, openOfficialTutorial } from '../src/app/sidebar-footer'

afterEach(() => {
  desktop.isElectron = true
  desktop.openExternal.mockReset()
})

describe('固定使用教程入口', () => {
  it('只通过现有桌面桥接打开固定官方 README 锚点', async () => {
    await openOfficialTutorial()
    expect(OFFICIAL_TUTORIAL_URL).toBe(
      'https://github.com/907609732/LTTLT-AI-Customer-Service#快速使用',
    )
    expect(desktop.openExternal).toHaveBeenCalledWith(OFFICIAL_TUTORIAL_URL)
  })
  it('浏览器预览和缺少桌面包时如实失败，不伪造已打开', async () => {
    desktop.isElectron = false
    await expect(openOfficialTutorial()).rejects.toThrow('浏览器预览')
    expect(desktop.openExternal).not.toHaveBeenCalled()
  })
})
