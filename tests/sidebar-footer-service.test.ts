import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedState } from '../src/shared/contracts/managed'

const desktop = vi.hoisted(() => ({ isElectron: true, openExternal: vi.fn(async () => {}) }))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => desktop }))

import {
  OFFICIAL_TUTORIAL_URL,
  deriveSidebarBalance,
  openOfficialTutorial,
} from '../src/app/sidebar-footer'

afterEach(() => {
  desktop.isElectron = true
  desktop.openExternal.mockReset()
})

function managedState(overrides: Partial<ManagedState> = {}): ManagedState {
  return {
    active: {
      mode: 'managed',
      apiOrigin: 'https://api.example.test',
      portalOrigin: 'https://account.example.test',
    },
    configured: {
      mode: 'managed',
      apiOrigin: 'https://api.example.test',
      portalOrigin: 'https://account.example.test',
    },
    restartRequired: false,
    session: {
      status: 'signed_in',
      account: {
        userId: 'fixture-user',
        displayName: '合成账号',
        trial: { limit: 20000, used: 7655, reserved: 0, remaining: 12345, expiresAt: 0 },
      },
      expiresAt: null,
      login: null,
      message: null,
    },
    ...overrides,
  }
}

function derive(managed = managedState(), available = true, workspaceId = 'fixture-workspace') {
  return deriveSidebarBalance({ available, workspaceId, loading: false, managed })
}

describe('左下角算力状态', () => {
  it('托管登录后显示服务端聚合字段中的账号当前可用次数', () => {
    expect(derive()).toMatchObject({
      state: 'ready',
      balance: 12345,
      label: '12,345',
      detail: '账号当前可用次数',
      canRecharge: true,
    })
  })
  it('零额度如实显示 0，不替换成演示数字', () => {
    const state = managedState()
    state.session.account!.trial.remaining = 0
    expect(derive(state)).toMatchObject({ state: 'ready', balance: 0, label: '0' })
  })
  it('本机 Key、需登录、待重启和待核对分别显示短文案', () => {
    expect(
      derive(
        managedState({
          active: {
            mode: 'local',
            apiOrigin: 'https://api.example.test',
            portalOrigin: 'https://account.example.test',
          },
        }),
      ),
    ).toMatchObject({ state: 'local', label: '本机 Key', balance: null })
    expect(
      derive(
        managedState({
          session: { ...managedState().session, status: 'signed_out', account: null },
        }),
      ),
    ).toMatchObject({ state: 'login', label: '需登录', canRecharge: false })
    expect(derive(managedState({ restartRequired: true }))).toMatchObject({
      state: 'restart',
      label: '待重启',
      canRecharge: false,
    })
    expect(
      derive(managedState({ session: { ...managedState().session, account: null } })),
    ).toMatchObject({
      state: 'unknown',
      label: '待核对',
      detail: '已登录，但尚未取得可用额度',
      canRecharge: true,
    })
    expect(
      deriveSidebarBalance({
        available: false,
        workspaceId: '',
        loading: true,
        managed: managedState(),
      }),
    ).toMatchObject({
      state: 'loading',
      label: '待核对',
    })
  })
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
