import { describe, expect, it } from 'vitest'
import { commandSchema, emptySnapshot, snapshotSchema } from '../src/shared/contracts/backend'

describe('本地业务契约', () => {
  it('快照只返回模型配置状态，不允许携带密钥字段', () => {
    const safe = emptySnapshot()
    const parsed = snapshotSchema.parse({
      ...safe,
      config: { ...safe.config, ai: { ...safe.config.ai, apiKey: 'fixture-secret' } },
      secrets: { apiKey: 'fixture-secret' },
    })
    expect(JSON.stringify(parsed)).not.toContain('fixture-secret')
  })
  it('拒绝任意动作、畸形工作区和额外能力字段', () => {
    const workspaceId = '41895a31-2871-4e3c-a84a-3a5e5c0f5461'
    expect(commandSchema.safeParse({ workspaceId, action: 'refresh' }).success).toBe(true)
    expect(commandSchema.safeParse({ workspaceId, action: 'exec-shell', values: {} }).success).toBe(
      false,
    )
    expect(commandSchema.safeParse({ workspaceId: 'broken', action: 'refresh' }).success).toBe(
      false,
    )
    expect(
      commandSchema.safeParse({ workspaceId, action: 'refresh', arbitraryPath: 'C:/' }).success,
    ).toBe(false)
  })
  it('空状态明确为本机模式，AI 与识图默认不启用', () => {
    const value = emptySnapshot()
    expect(value.capabilities.modelMode).toBe('local')
    expect(value.capabilities.apiKeyConfigured).toBe(false)
    expect(value.config.reply.enabled).toBe(false)
    expect(value.capabilities.vision.supported).toBe(false)
  })
})
