// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs, {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisionModelExpected, VisionModelSettingsView } from '../src/shared/contracts/vision'
import { VisionModelSettingsStore, type VisionSafeStorage } from '../electron/vision-model-settings'
import { VISION_VERIFICATION_SUITE_VERSION } from '../electron/vision-model-verification'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const remove of cleanup.splice(0).reverse()) remove()
})

function directory(prefix = 'vision-settings-'): string {
  const value = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(() => rmSync(value, { recursive: true, force: true }))
  return value
}

function encryption(available = true): VisionSafeStorage {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => available,
    encryptString(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}

function expected(view: VisionModelSettingsView): VisionModelExpected {
  return {
    mode: view.snapshot.mode,
    baseUrl: view.snapshot.baseUrl,
    model: view.snapshot.model,
    apiKeyConfigured: view.snapshot.apiKeyConfigured,
    revision: view.revision,
  }
}

function store(dataDir: string, safeStorage = encryption()) {
  return new VisionModelSettingsStore({ dataDir, safeStorage })
}

describe('独立图片模型配置', () => {
  it('缺少视觉文件时沿用文字模型，不创建空配置也不强迫验证', () => {
    const root = directory()
    const current = store(root)
    const snapshot = current.snapshot()
    expect(snapshot).toMatchObject({
      mode: 'inherit',
      baseUrl: '',
      model: '',
      apiKeyConfigured: false,
      status: 'inherit',
    })
    expect(snapshot.reason).toContain('未独立验证')
    expect(existsSync(join(root, 'vision-model.json'))).toBe(false)
  })

  it('原子保存独立配置，Key 只保存系统密文且快照不含明文或密文', () => {
    const root = directory()
    mkdirSync(root, { recursive: true })
    const textConfig = join(root, 'config.json')
    writeFileSync(textConfig, JSON.stringify({ ai: { baseUrl: 'https://text', model: 'text' } }))
    const beforeText = readFileSync(textConfig, 'utf8')
    const current = store(root)
    const saved = current.save({
      mode: 'custom',
      baseUrl: 'http://127.0.0.1:41801/v1/',
      model: 'deepseek-flash',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    expect(saved.snapshot).toMatchObject({
      mode: 'custom',
      baseUrl: 'http://127.0.0.1:41801/v1',
      model: 'deepseek-flash',
      apiKeyConfigured: true,
      status: 'unverified',
    })
    expect(saved.revision).toBe(1)
    expect(readFileSync(textConfig, 'utf8')).toBe(beforeText)
    const raw = readFileSync(join(root, 'vision-model.json'), 'utf8')
    const settingsText = JSON.stringify(saved)
    expect(raw).not.toContain('vision-secret-value')
    expect(settingsText).not.toContain('vision-secret-value')
    expect(settingsText).not.toContain('ciphertext')
    expect(settingsText).not.toContain('keyVersion')
    expect(settingsText).not.toContain('digest')
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(current.resolveCustomRoute(false).apiKey).toBe('vision-secret-value')
    expect(store(root, encryption()).snapshot()).toMatchObject({
      mode: 'custom',
      apiKeyConfigured: true,
    })
  })

  it('系统加密不可用时拒绝保存 Key，不以 base64 或明文降级', () => {
    const root = directory()
    const current = store(root, encryption(false))
    expect(() =>
      current.save({
        mode: 'custom',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        apiKey: 'must-not-be-written',
        expected: expected(current.view()),
      }),
    ).toThrow(/系统加密不可用/)
    expect(existsSync(join(root, 'vision-model.json'))).toBe(false)
    expect(current.snapshot().mode).toBe('inherit')
  })

  it('保存使用可见配置和 revision CAS，旧草稿不能覆盖较新的端点或模型', () => {
    const root = directory()
    const current = store(root)
    const first = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-a.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    const second = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-a.example.com/v2',
      model: 'model-b',
      expected: expected(first),
    })
    const fileAfterSecond = readFileSync(join(root, 'vision-model.json'), 'utf8')
    expect(() =>
      current.save({
        mode: 'custom',
        baseUrl: 'https://vision-a.example.com/v3',
        model: 'model-c',
        expected: expected(first),
      }),
    ).toThrow(/已更新/)
    expect(current.view()).toEqual(second)
    expect(readFileSync(join(root, 'vision-model.json'), 'utf8')).toBe(fileAfterSecond)
  })

  it('Key 轮换即使可见字段相同也递增 revision，旧设置页不能再用旧 revision 保存', () => {
    const root = directory()
    const current = store(root)
    const first = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-one',
      expected: expected(current.view()),
    })
    const stale = expected(first)
    const rotated = current.save({
      mode: stale.mode,
      baseUrl: stale.baseUrl,
      model: stale.model,
      apiKey: 'vision-secret-two',
      expected: stale,
    })
    expect(rotated.revision).toBe(first.revision + 1)
    expect(() =>
      current.save({
        mode: stale.mode,
        baseUrl: stale.baseUrl,
        model: stale.model,
        apiKey: 'vision-secret-three',
        expected: stale,
      }),
    ).toThrow(/已更新/)
    expect(current.resolveCustomRoute(false).apiKey).toBe('vision-secret-two')
  })

  it('端点、模型、Key 和模式改变使图片验证失效，代次递增但快照不暴露代次', () => {
    const root = directory()
    const current = store(root)
    let view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    const ticket = current.captureVerificationTicket()
    const generationBeforeVerify = current.generation()
    view = current.recordVerification(ticket, { ok: true })
    expect(view.snapshot.status).toBe('verified')
    expect(current.generation()).toBeGreaterThan(generationBeforeVerify)
    expect(JSON.stringify(view.snapshot)).not.toContain('generation')

    view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v2',
      model: 'model-a',
      expected: expected(view),
    })
    expect(view.snapshot.status).toBe('unverified')

    const secondTicket = current.captureVerificationTicket()
    view = current.recordVerification(secondTicket, { ok: true })
    expect(view.snapshot.status).toBe('verified')
    view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v2',
      model: 'model-a',
      apiKey: 'rotated-secret-value',
      expected: expected(view),
    })
    expect(view.snapshot.status).toBe('unverified')

    const thirdTicket = current.captureVerificationTicket()
    view = current.recordVerification(thirdTicket, { ok: true })
    expect(view.snapshot.status).toBe('verified')
    view = current.save({
      mode: 'inherit',
      baseUrl: 'https://vision.example.com/v2',
      model: 'model-a',
      expected: expected(view),
    })
    expect(view.snapshot.status).toBe('inherit')
    view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v2',
      model: 'model-a',
      expected: expected(view),
    })
    expect(view.snapshot.status).toBe('unverified')
    expect(() => current.resolveCustomRoute(true)).toThrow(/验证/)
  })

  it('有效配置 A→B→A 仍要求重新验证，不能靠摘要回到 A 自动复活', () => {
    const root = directory()
    const current = store(root)
    let view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    view = current.recordVerification(current.captureVerificationTicket(), { ok: true })
    expect(view.snapshot.status).toBe('verified')
    view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v2',
      model: 'model-a',
      expected: expected(view),
    })
    expect(view.snapshot.status).toBe('unverified')
    view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      expected: expected(view),
    })
    expect(view.snapshot.status).toBe('unverified')
    expect(() => current.resolveCustomRoute(true)).toThrow(/验证/)
  })

  it('两个窗口同 revision 时，换 Key 后旧 expected 的保存和清 Key 都拒绝', () => {
    const root = directory()
    const current = store(root)
    const first = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-one',
      expected: expected(current.view()),
    })
    const windowOne = current.view()
    const windowTwo = current.view()
    expect(windowOne.revision).toBe(first.revision)
    expect(windowTwo.revision).toBe(first.revision)
    const rotated = current.save({
      mode: 'custom',
      baseUrl: windowOne.snapshot.baseUrl,
      model: windowOne.snapshot.model,
      apiKey: 'vision-secret-two',
      expected: expected(windowOne),
    })
    expect(rotated.revision).toBe(first.revision + 1)
    expect(() =>
      current.save({
        mode: 'custom',
        baseUrl: windowTwo.snapshot.baseUrl,
        model: windowTwo.snapshot.model,
        apiKey: 'vision-secret-three',
        expected: expected(windowTwo),
      }),
    ).toThrow(/已更新/)
    expect(() => current.clearKey(expected(windowTwo))).toThrow(/已更新/)
    expect(current.resolveCustomRoute(false).apiKey).toBe('vision-secret-two')

    const fresh = current.view()
    expect(current.clearKey(expected(fresh)).snapshot.apiKeyConfigured).toBe(false)
  })

  it('并发验证旧 ticket 在配置变化后不能记录到新配置', () => {
    const root = directory()
    const current = store(root)
    current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-one',
      expected: expected(current.view()),
    })
    const ticket = current.captureVerificationTicket()
    current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-two',
      expected: expected(current.view()),
    })
    expect(() => current.recordVerification(ticket, { ok: true })).toThrow(/变化/)
    expect(current.snapshot().status).toBe('unverified')
  })

  it('跨 origin 换地址但未重新输入 Key 时拒绝保存，同源路径和模型名变更保留 Key', () => {
    const root = directory()
    const current = store(root)
    const first = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-a.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-a',
      expected: expected(current.view()),
    })
    const fileBefore = readFileSync(join(root, 'vision-model.json'), 'utf8')
    expect(() =>
      current.save({
        mode: 'custom',
        baseUrl: 'https://vision-b.example.com/v1',
        model: 'model-a',
        expected: expected(first),
      }),
    ).toThrow(/重新输入/)
    expect(readFileSync(join(root, 'vision-model.json'), 'utf8')).toBe(fileBefore)
    expect(current.snapshot().baseUrl).toBe('https://vision-a.example.com/v1')

    const sameOrigin = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-a.example.com/v2',
      model: 'model-a-compatible',
      expected: expected(current.view()),
    })
    expect(sameOrigin.snapshot.apiKeyConfigured).toBe(true)
    expect(current.resolveCustomRoute(false).apiKey).toBe('vision-secret-a')
  })

  it('custom A/KeyA → inherit 空地址 → custom B/空 Key 仍拒绝，显式 KeyB 才成功', () => {
    const root = directory()
    const current = store(root)
    const first = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-a.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-a',
      expected: expected(current.view()),
    })
    const inherited = current.save({
      mode: 'inherit',
      baseUrl: '',
      model: '',
      expected: expected(first),
    })
    expect(inherited.snapshot).toMatchObject({
      mode: 'inherit',
      baseUrl: '',
      apiKeyConfigured: true,
    })
    const fileBefore = readFileSync(join(root, 'vision-model.json'), 'utf8')
    expect(() =>
      current.save({
        mode: 'custom',
        baseUrl: 'https://vision-b.example.com/v1',
        model: 'model-b',
        expected: expected(inherited),
      }),
    ).toThrow(/重新输入|归属/)
    expect(readFileSync(join(root, 'vision-model.json'), 'utf8')).toBe(fileBefore)
    const explicit = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-b.example.com/v1',
      model: 'model-b',
      apiKey: 'vision-secret-b',
      expected: expected(inherited),
    })
    expect(explicit.snapshot.apiKeyConfigured).toBe(true)
    expect(current.resolveCustomRoute(false).apiKey).toBe('vision-secret-b')
  })

  it('旧文件 Key 缺少 origin 且地址已清空时，迁移后新 origin 不能复用旧 Key', () => {
    const root = directory()
    const safeStorage = encryption()
    const current = store(root, safeStorage)
    const first = current.save({
      mode: 'custom',
      baseUrl: 'https://vision-a.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-a',
      expected: expected(current.view()),
    })
    current.save({
      mode: 'inherit',
      baseUrl: '',
      model: '',
      expected: expected(first),
    })
    const file = join(root, 'vision-model.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      key?: { origin?: string }
    }
    if (raw.key) delete raw.key.origin
    writeFileSync(file, JSON.stringify(raw))
    const migrated = store(root, safeStorage)
    expect(migrated.snapshot()).toMatchObject({ mode: 'inherit', apiKeyConfigured: true })
    expect(() =>
      migrated.save({
        mode: 'custom',
        baseUrl: 'https://vision-b.example.com/v1',
        model: 'model-b',
        expected: expected(migrated.view()),
      }),
    ).toThrow(/重新输入|归属/)
    const explicit = migrated.save({
      mode: 'custom',
      baseUrl: 'https://vision-b.example.com/v1',
      model: 'model-b',
      apiKey: 'vision-secret-b',
      expected: expected(migrated.view()),
    })
    expect(explicit.snapshot.apiKeyConfigured).toBe(true)
    expect(migrated.resolveCustomRoute(false).apiKey).toBe('vision-secret-b')
  })

  it('旧 suite1 验证记录仍保留 Key 和配置，但读取为 stale 且不能放行图片', () => {
    const root = directory()
    const safeStorage = encryption()
    const current = store(root, safeStorage)
    let view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    view = current.recordVerification(current.captureVerificationTicket(), { ok: true })
    expect(view.snapshot.status).toBe('verified')
    const file = join(root, 'vision-model.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      verify?: { suite?: number }
    }
    expect(raw.verify?.suite).toBe(VISION_VERIFICATION_SUITE_VERSION)
    if (raw.verify) raw.verify.suite = 1
    writeFileSync(file, JSON.stringify(raw))
    const restarted = store(root, safeStorage)
    expect(restarted.snapshot()).toMatchObject({
      mode: 'custom',
      apiKeyConfigured: true,
      status: 'stale',
    })
    expect(restarted.snapshot().reason).toContain('套件')
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(raw))
    expect(() => restarted.resolveCustomRoute(true)).toThrow(/套件/)
  })

  it('清除 Key 需要显式调用，成功后移除密文并关闭独立图片路由', () => {
    const root = directory()
    const current = store(root)
    let view = current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    view = current.recordVerification(current.captureVerificationTicket(), { ok: true })
    expect(view.snapshot.status).toBe('verified')
    view = current.clearKey(expected(view))
    expect(view.snapshot).toMatchObject({ apiKeyConfigured: false, status: 'unverified' })
    expect(readFileSync(join(root, 'vision-model.json'), 'utf8')).not.toContain('ciphertext')
    expect(() => current.resolveCustomRoute(false)).toThrow(/Key/)
  })

  it('配置文件被复制到另一业务目录后，旧验证记录不可继续使用', () => {
    const firstDir = directory()
    const secondDir = directory()
    const safeStorage = encryption()
    const first = store(firstDir, safeStorage)
    let view = first.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(first.view()),
    })
    view = first.recordVerification(first.captureVerificationTicket(), { ok: true })
    expect(view.snapshot.status).toBe('verified')
    copyFileSync(join(firstDir, 'vision-model.json'), join(secondDir, 'vision-model.json'))
    const copied = store(secondDir, safeStorage)
    expect(copied.snapshot().status).toBe('stale')
    expect(copied.snapshot().reason).toContain('目录')
    expect(() => copied.resolveCustomRoute(true)).toThrow(/目录/)
  })

  it('rename 失败保留旧文件，临时文件清理异常不覆盖主错误', () => {
    const root = directory()
    const current = store(root)
    current.save({
      mode: 'custom',
      baseUrl: 'https://vision.example.com/v1',
      model: 'model-a',
      apiKey: 'vision-secret-value',
      expected: expected(current.view()),
    })
    const file = join(root, 'vision-model.json')
    const before = readFileSync(file, 'utf8')
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated rename failure')
    })
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('simulated cleanup failure')
    })
    try {
      expect(() =>
        current.save({
          mode: 'custom',
          baseUrl: 'https://vision.example.com/v2',
          model: 'model-a',
          expected: expected(current.view()),
        }),
      ).toThrow(/保存失败/)
      expect(readFileSync(file, 'utf8')).toBe(before)
      expect(current.snapshot().baseUrl).toBe('https://vision.example.com/v1')
      // 清理本身失败时临时文件可能保留，但旧文件不动且主错误仍是保存失败。
      expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toHaveLength(1)
    } finally {
      rename.mockRestore()
      unlink.mockRestore()
    }
  })

  it('损坏文件明确报错并保留原文件，不静默回退为继承', () => {
    const root = directory()
    const file = join(root, 'vision-model.json')
    writeFileSync(file, '{not-json')
    expect(() => store(root)).toThrow(/损坏/)
    expect(readFileSync(file, 'utf8')).toBe('{not-json')
  })
})
