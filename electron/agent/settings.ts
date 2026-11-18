import { createHash } from 'node:crypto'
import type {
  BackendCommand,
  BackendResult,
  BackendSnapshot,
  ReplyPacing,
} from '../../src/shared/contracts/backend'
import { replyPacingSchema } from '../../src/shared/contracts/backend'
import { normalizeWelcomeSetting } from '../../src/shared/contracts/welcome'
import {
  agentConfigDescription,
  replyPacingConfigPatchSchema,
  visionConfigPatchSchema,
  welcomeConfigPatchSchema,
  type AgentConfigGroup,
} from '../../src/shared/contracts/agent-settings'

export type ReplyPacingSettings = ReplyPacing
export interface WelcomeSettings {
  text: string
  enabled: boolean
  delayMinSeconds: number
  delayMaxSeconds: number
}
export interface VisionSettings {
  enabled: boolean
}
export type AgentConfigSettings = ReplyPacingSettings | WelcomeSettings | VisionSettings

export type AgentConfigTarget =
  | { workspaceId: string; group: 'reply-pacing' }
  | { workspaceId: string; group: 'welcome'; storeId: string }
  | { workspaceId: string; group: 'vision'; storeId: string }

export interface AgentConfigView {
  group: AgentConfigGroup
  scope: 'global' | 'store'
  workspaceId: string
  storeId?: string
  version: string
  settings: AgentConfigSettings
}

interface AgentConfigState {
  view: AgentConfigView
  /** Native record version used only for the vendor CAS field, never as a credential. */
  recordVersion: number
  settings: Record<string, unknown>
}

export const agentConfigSchemaDescription = agentConfigDescription

function versionOf(
  group: AgentConfigGroup,
  storeId: string | undefined,
  recordVersion: number,
  settings: object,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ group, storeId: storeId ?? '', recordVersion, settings }))
    .digest('hex')
}

function readState(snapshot: BackendSnapshot, target: AgentConfigTarget): AgentConfigState {
  if (snapshot.workspaceId !== target.workspaceId) throw Error('账号工作区已改变，请重新获取状态')
  if (target.group === 'reply-pacing') {
    const settings: ReplyPacingSettings = {
      mode: snapshot.config.reply.pacing.mode,
      customMinSeconds: snapshot.config.reply.pacing.customMinSeconds,
      customMaxSeconds: snapshot.config.reply.pacing.customMaxSeconds,
    }
    const recordVersion = 0
    return {
      view: {
        group: target.group,
        scope: 'global',
        workspaceId: target.workspaceId,
        version: versionOf(target.group, undefined, recordVersion, settings),
        settings,
      },
      recordVersion,
      settings: { ...settings },
    }
  }
  if (target.group === 'welcome') {
    const raw = normalizeWelcomeSetting(snapshot.welcomeByStore[target.storeId])
    const settings: WelcomeSettings = {
      text: raw.text,
      enabled: raw.enabled,
      delayMinSeconds: raw.delayMinSeconds,
      delayMaxSeconds: raw.delayMaxSeconds,
    }
    return {
      view: {
        group: target.group,
        scope: 'store',
        workspaceId: target.workspaceId,
        storeId: target.storeId,
        version: versionOf(target.group, target.storeId, raw.version, settings),
        settings,
      },
      recordVersion: raw.version,
      settings: { ...settings },
    }
  }
  const raw = snapshot.visionByStore[target.storeId] ?? { enabled: false, version: 0 }
  const settings: VisionSettings = { enabled: raw.enabled }
  return {
    view: {
      group: target.group,
      scope: 'store',
      workspaceId: target.workspaceId,
      storeId: target.storeId,
      version: versionOf(target.group, target.storeId, raw.version, settings),
      settings,
    },
    recordVersion: raw.version,
    settings: { ...settings },
  }
}

export function getAgentConfig(
  snapshot: BackendSnapshot,
  target: AgentConfigTarget,
): AgentConfigView {
  return readState(snapshot, target).view
}

function mergeConfig(
  group: AgentConfigGroup,
  current: Record<string, unknown>,
  rawPatch: unknown,
): Record<string, unknown> {
  if (group === 'reply-pacing') {
    const patch = replyPacingConfigPatchSchema.parse(rawPatch)
    const merged = replyPacingSchema.safeParse({
      mode: patch.mode ?? current.mode,
      customMinSeconds: patch.customMinSeconds ?? current.customMinSeconds,
      customMaxSeconds: patch.customMaxSeconds ?? current.customMaxSeconds,
    })
    if (!merged.success) throw Error(merged.error.issues[0]?.message || '回复间隔参数无效')
    return { ...merged.data }
  }
  if (group === 'welcome') {
    const patch = welcomeConfigPatchSchema.parse(rawPatch)
    const merged: WelcomeSettings = {
      text: String(patch.text ?? current.text ?? '').trim(),
      enabled: patch.enabled ?? Boolean(current.enabled),
      delayMinSeconds: Number(patch.delayMinSeconds ?? current.delayMinSeconds),
      delayMaxSeconds: Number(patch.delayMaxSeconds ?? current.delayMaxSeconds),
    }
    if (merged.text.length > 200) throw Error('欢迎文字最多200字')
    if (
      !Number.isInteger(merged.delayMinSeconds) ||
      !Number.isInteger(merged.delayMaxSeconds) ||
      merged.delayMinSeconds < 1 ||
      merged.delayMaxSeconds > 3600
    )
      throw Error('欢迎延迟请填写1～3600的整数秒')
    if (merged.delayMinSeconds > merged.delayMaxSeconds) throw Error('欢迎延迟下限不能大于上限')
    if (merged.enabled && !merged.text) throw Error('启用欢迎语前请先填写欢迎文字')
    return { ...merged }
  }
  const patch = visionConfigPatchSchema.parse(rawPatch)
  return { enabled: patch.enabled }
}

export interface AgentConfigPreview extends AgentConfigView {
  effective: AgentConfigSettings
  changes: Record<string, { from: unknown; to: unknown }>
}

export function previewAgentConfig(
  snapshot: BackendSnapshot,
  target: AgentConfigTarget,
  patch: unknown,
): AgentConfigPreview {
  const state = readState(snapshot, target)
  const effective = mergeConfig(target.group, state.settings, patch)
  if (
    target.group === 'vision' &&
    effective.enabled === true &&
    !snapshot.capabilities.vision.supported
  )
    throw Error(snapshot.capabilities.vision.reason || '当前模型不支持图片识别')
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of Object.keys(effective)) {
    if (state.settings[key] !== effective[key])
      changes[key] = { from: state.settings[key], to: effective[key] }
  }
  return {
    ...state.view,
    effective: effective as AgentConfigSettings,
    changes,
  }
}

export interface AgentConfigApplyResult extends AgentConfigView {
  requestId: string
}

/**
 * Saves through the same business commands and native expected values the
 * desktop UI uses. The returned record is read back from a fresh snapshot; a
 * caller must never treat command acceptance alone as saved configuration.
 */
export async function applyAgentConfig(
  runtime: {
    snapshot(): BackendSnapshot
    execute(input: BackendCommand): Promise<BackendResult>
  },
  target: AgentConfigTarget,
  expectedVersion: string,
  patch: unknown,
  requestId: string,
): Promise<AgentConfigApplyResult> {
  const snapshot = runtime.snapshot()
  const before = readState(snapshot, target)
  if (before.view.version !== expectedVersion)
    throw Error('配置已更新，请重新读取后再提交；本次未写入')
  const effective = mergeConfig(target.group, before.settings, patch)
  if (
    target.group === 'vision' &&
    effective.enabled === true &&
    !snapshot.capabilities.vision.supported
  )
    throw Error(snapshot.capabilities.vision.reason || '当前模型尚未支持图片识别')
  if (target.group === 'reply-pacing') {
    await runtime.execute({
      workspaceId: target.workspaceId,
      action: 'save-config',
      screenId: 'REPLY_PACING',
      values: { ...effective, expected: before.settings },
    })
  } else if (target.group === 'welcome') {
    await runtime.execute({
      workspaceId: target.workspaceId,
      action: 'save-welcome',
      storeId: target.storeId,
      values: { ...effective, version: before.recordVersion },
    })
  } else {
    await runtime.execute({
      workspaceId: target.workspaceId,
      action: 'save-vision-settings',
      storeId: target.storeId,
      values: { ...effective, version: before.recordVersion },
    })
  }
  const after = readState(runtime.snapshot(), target)
  for (const key of Object.keys(effective)) {
    if (after.settings[key] !== effective[key])
      throw Error('保存后回读与提交不一致，请重新读取；不要重复提交')
  }
  return { ...after.view, requestId }
}
