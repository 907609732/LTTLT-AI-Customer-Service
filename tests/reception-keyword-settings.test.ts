// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ReceptionKeywordSettingsStore,
  normalizeReceptionKeywords,
  parseReceptionKeywordSaveInput,
  resolveReceptionKeywordSafety,
} from '../electron/reception-keyword-settings'

const require = createRequire(import.meta.url)
const { createBackend } = require('../vendor/lingtu-runtime/electron/backend.cjs') as {
  createBackend: (options: Record<string, unknown>) => Backend
}

interface Backend {
  engine: {
    startStore(storeId: string): Promise<{ safety: Record<string, unknown> }>
    worker(storeId: string): { safety: Record<string, unknown> } | null
    stopAll(): void
  }
  execute(input: unknown): Promise<{ data: Record<string, unknown> }>
  snapshot(): { config: { safety: Record<string, unknown> } }
  dispose(): void
}

const directories: string[] = []
const backends: Backend[] = []
afterEach(() => {
  for (const backend of backends.splice(0)) backend.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

describe('reception keyword settings persistence', () => {
  it('defaults both switches on and survives a restart while keeping raw keywords', () => {
    const directory = tempDirectory('lingtu-keyword-settings-')
    const store = new ReceptionKeywordSettingsStore(directory)
    expect(store.snapshot()).toEqual({ handoffEnabled: true, manualReplyEnabled: true })
    expect(store.saveEnabled('handoff', false, true)).toMatchObject({ changed: true })
    expect(new ReceptionKeywordSettingsStore(directory).snapshot()).toEqual({
      handoffEnabled: false,
      manualReplyEnabled: true,
    })
  })

  it('uses the loaded switch value as a CAS guard and never writes on a stale request', () => {
    const directory = tempDirectory('lingtu-keyword-settings-cas-')
    const store = new ReceptionKeywordSettingsStore(directory)
    store.saveEnabled('manual', false, true)
    expect(() => store.saveEnabled('manual', true, true)).toThrow(/已更新/)
    expect(store.snapshot().manualReplyEnabled).toBe(false)
    expect(new ReceptionKeywordSettingsStore(directory).snapshot().manualReplyEnabled).toBe(false)
  })

  it('normalizes and rejects each keyword field with its own user-facing label', () => {
    expect(normalizeReceptionKeywords([' 我来 ', '', '我来', '转人工'], 'manual')).toEqual([
      '我来',
      '转人工',
    ])
    expect(() => normalizeReceptionKeywords(['超'.repeat(31)], 'handoff')).toThrow(/30/)
    expect(() =>
      normalizeReceptionKeywords(
        Array.from({ length: 101 }, (_, index) => `词${index}`),
        'handoff',
      ),
    ).toThrow(/100/)
  })

  it('parses keyword text and switch commands without accepting unrelated fields', () => {
    expect(
      parseReceptionKeywordSaveInput({
        kind: 'handoff',
        mode: 'keywords',
        keywords: ['投诉'],
        expectedKeywords: [],
      }),
    ).toEqual({ kind: 'handoff', mode: 'keywords', keywords: ['投诉'], expectedKeywords: [] })
    expect(
      parseReceptionKeywordSaveInput({
        kind: 'manual',
        mode: 'enabled',
        enabled: false,
        expectedEnabled: true,
      }),
    ).toEqual({ kind: 'manual', mode: 'enabled', enabled: false, expectedEnabled: true })
    expect(() =>
      parseReceptionKeywordSaveInput({
        kind: 'manual',
        mode: 'enabled',
        enabled: false,
        expectedEnabled: true,
        keywords: ['不应出现'],
      }),
    ).toThrow()
  })

  it('disables inherited global and seller matching but keeps custom store keywords intact', () => {
    const safety = { handoffKeywords: ['投诉'], manualReplyKeywords: ['我来接待'] }
    expect(
      resolveReceptionKeywordSafety(safety, undefined, {
        handoffEnabled: false,
        manualReplyEnabled: false,
      }),
    ).toEqual({ handoffKeywords: [], manualReplyKeywords: [] })
    expect(
      resolveReceptionKeywordSafety(safety, ['本店专属'], {
        handoffEnabled: false,
        manualReplyEnabled: true,
      }),
    ).toEqual({ handoffKeywords: ['本店专属'], manualReplyKeywords: ['我来接待'] })
  })
})

describe('runtime keyword matching hook', () => {
  it('applies the app-owned switches through the real engine config without clearing config', async () => {
    const directory = tempDirectory('lingtu-keyword-engine-')
    const settings = { handoffEnabled: true, manualReplyEnabled: true }
    const adapter = {
      id: 'keyword-fixture',
      accessMode: 'webview',
      supports: () => true,
      ensure: async () => ({ ok: true }),
      preparePending: async () => ({ ok: true }),
      popPending: async () => null,
      pendingSnapshot: async () => ({ ok: true, count: 0, uids: [] }),
      conversationHistory: async () => ({ ok: true, messages: [] }),
      focusConversation: async () => ({ ok: true }),
      sendText: async () => ({ ok: true, msgId: 'fixture-send' }),
      sendImage: async () => ({ ok: true }),
      sendVideo: async () => ({ ok: true }),
      release: async () => ({ ok: true }),
      discard: async () => ({ ok: true }),
      popMerchantSent: async () => [],
      syncAiEnabled: async () => ({ ok: true }),
    }
    const backend = createBackend({
      dataDir: directory,
      adapterFactory: () => adapter,
      managerFactory: () => ({
        stateOf: () => ({ open: true, online: true, authenticated: true }),
        closeAll() {},
      }),
      resolveKeywordSafety: (
        safety: { handoffKeywords: string[]; manualReplyKeywords: string[] },
        customKeywords: string[] | undefined,
      ) => resolveReceptionKeywordSafety(safety, customKeywords, settings),
    })
    backends.push(backend)
    const added = await backend.execute({
      action: 'add-store',
      values: { platform: 'pdd-web', storeName: '关键词测试店' },
    })
    const storeId = String(added.data.id)
    await backend.execute({
      action: 'save-config',
      screenId: 'UX08',
      values: { handoffKeywords: ['投诉'] },
    })
    await backend.execute({
      action: 'save-config',
      screenId: 'MANUAL_REPLY_KEYWORDS',
      values: { keywords: ['我来接待'], expectedKeywords: [] },
    })
    await backend.engine.startStore(storeId)
    const worker = backend.engine.worker(storeId)!
    expect(worker.safety.handoffKeywords).toEqual(['投诉'])
    expect(worker.safety.manualReplyKeywords).toEqual(['我来接待'])

    settings.handoffEnabled = false
    settings.manualReplyEnabled = false
    expect(worker.safety.handoffKeywords).toEqual([])
    expect(worker.safety.manualReplyKeywords).toEqual([])
    // The raw values used by the settings UI remain persisted; only matching is disabled.
    expect(backend.snapshot().config.safety).toMatchObject({
      handoffKeywords: ['投诉'],
      manualReplyKeywords: ['我来接待'],
    })

    await backend.execute({
      action: 'save-store-handoff',
      storeId,
      values: { mode: 'custom', keywords: ['本店专属'] },
    })
    expect(worker.safety.handoffKeywords).toEqual(['本店专属'])
    expect(worker.safety.manualReplyKeywords).toEqual([])
  })
})
