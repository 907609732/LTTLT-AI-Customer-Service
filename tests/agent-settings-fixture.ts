// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type {
  BackendCommand,
  BackendResult,
  BackendSnapshot,
} from '../src/shared/contracts/backend'
import { normalizeWelcomeSetting } from '../src/shared/contracts/welcome'
import { createAgentService } from '../electron/agent/service'

/**
 * Simulates the three native CAS saves with the same version fields the vendor
 * handlers use. Tests must exercise the real command values, not a parallel
 * settings store.
 */
export function createConfigExecute(state: BackendSnapshot, writes: BackendCommand[] = []) {
  return async (input: BackendCommand): Promise<BackendResult> => {
    writes.push(structuredClone(input))
    if (input.workspaceId !== state.workspaceId) throw Error('stale workspace')
    if (input.action === 'save-config' && input.screenId === 'REPLY_PACING') {
      const values = input.values
      const current = state.config.reply.pacing
      const expected = values.expected
      if (
        !expected ||
        typeof expected !== 'object' ||
        (expected as typeof current).mode !== current.mode ||
        (expected as typeof current).customMinSeconds !== current.customMinSeconds ||
        (expected as typeof current).customMaxSeconds !== current.customMaxSeconds
      )
        throw Error('回复间隔配置已更新，请载入已保存设置后再修改')
      state.config.reply.pacing = {
        mode: values.mode as typeof current.mode,
        customMinSeconds: values.customMinSeconds as number,
        customMaxSeconds: values.customMaxSeconds as number,
      }
      state.revision += 1
      return {
        status: 'ok',
        message: '回复间隔已保存',
        data: { pacing: structuredClone(state.config.reply.pacing) },
      }
    }
    if (input.action === 'save-welcome') {
      const storeId = input.storeId ?? ''
      const current = normalizeWelcomeSetting(state.welcomeByStore[storeId])
      if (input.values.version !== current.version) throw Error('欢迎配置已更新，请重新载入')
      const text = String(input.values.text ?? current.text).trim()
      const enabled =
        input.values.enabled === undefined ? current.enabled : Boolean(input.values.enabled)
      const delayMinSeconds =
        typeof input.values.delayMinSeconds === 'number'
          ? input.values.delayMinSeconds
          : current.delayMinSeconds
      const delayMaxSeconds =
        typeof input.values.delayMaxSeconds === 'number'
          ? input.values.delayMaxSeconds
          : current.delayMaxSeconds
      if (enabled && !text) throw Error('请先填写欢迎语')
      if (delayMinSeconds > delayMaxSeconds) throw Error('欢迎延迟下限不能大于上限')
      state.welcomeByStore[storeId] = {
        text,
        enabled,
        version: current.version + 1,
        delayMinSeconds,
        delayMaxSeconds,
      }
      state.revision += 1
      return {
        status: 'ok',
        message: '本店新会话欢迎已保存，AI接待开关未改变。',
        data: { ...state.welcomeByStore[storeId] },
      }
    }
    if (input.action === 'save-vision-settings') {
      const storeId = input.storeId ?? ''
      const current = state.visionByStore[storeId] ?? { enabled: false, version: 0 }
      if (input.values.version !== current.version) throw Error('图片识别配置已更新，请重新载入')
      const enabled = Boolean(input.values.enabled)
      if (enabled && !state.capabilities.vision.supported)
        throw Error(state.capabilities.vision.reason || '当前模型不支持图片识别')
      state.visionByStore[storeId] = { enabled, version: current.version + 1 }
      state.revision += 1
      return {
        status: 'ok',
        message: '本店图片识别设置已保存，AI接待开关未改变。',
        data: { ...state.visionByStore[storeId] },
      }
    }
    return { status: 'ok', message: 'opened', data: {} }
  }
}

export function createAgentSettingsFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lingtu-agent-settings-'))
  const state = emptySnapshot()
  state.workspaceId = 'w'
  state.revision = 10
  state.stores = [
    {
      id: 'a',
      storeName: 'A',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
    {
      id: 'b',
      storeName: 'B',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
  ]
  state.config.reply.pacing = { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 }
  state.welcomeByStore.a = {
    text: '旧欢迎',
    enabled: true,
    version: 4,
    delayMinSeconds: 2,
    delayMaxSeconds: 5,
  }
  state.visionByStore.a = { enabled: false, version: 2 }
  state.capabilities.vision = {
    supported: true,
    model: '',
    maxImages: 4,
    reason: '',
  }
  const writes: BackendCommand[] = []
  const execute = createConfigExecute(state, writes)
  const service = createAgentService({
    version: 'test',
    runtime: () => ({
      snapshot: () => structuredClone(state),
      knowledge: () => {
        throw Error('knowledge is not part of configuration tools')
      },
      execute,
    }),
  })
  return {
    directory,
    state,
    writes,
    execute,
    service,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  }
}
