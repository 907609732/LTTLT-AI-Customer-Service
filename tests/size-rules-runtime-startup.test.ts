// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSizeRulesAssembly } from '../electron/size-rules/runtime-assembly'
import { createSizeRulesService } from '../electron/size-rules/service'
import { createSizeContextPreparation } from '../electron/size-rules/inject'
import type { CompressionInput } from '../electron/context-compression'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('size domain assembly containment', () => {
  it('keeps the runtime alive on a corrupt size file, preserves it and fails size work explicitly', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'size-rules-startup-'))
    directories.push(directory)
    const file = path.join(directory, 'size-rules.json')
    fs.writeFileSync(file, '{broken')
    const before = fs.readFileSync(file, 'utf8')
    const assembly = createSizeRulesAssembly(() =>
      createSizeRulesService({
        directory,
        assertActive: () => {},
        isBindingValid: async () => true,
      }),
    )
    expect(assembly.service).toBeUndefined()
    expect(assembly.error).toMatch(/损坏|原文件/)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    await expect(assembly.execute('list-size-rules', {})).rejects.toThrow(/尺码规则不可用/)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)

    const next = vi.fn(async (input: CompressionInput) => ({
      messages: input.messages,
      compression: { triggered: false },
    }))
    const prepare = createSizeContextPreparation(
      {
        assertActive: () => {},
        unavailable: `尺码规则不可用：${assembly.error}；请恢复备份后重试。`,
        resolve: (storeId, productId, question, thread) =>
          assembly.resolve(storeId, productId, question, thread),
      },
      next,
    )
    const ordinary = await prepare({
      messages: [{ role: 'system', content: 'system' }],
      thread: [{ from: 'buyer', type: 'text', content: '你好' }],
      reviewContext: { storeId: 'a', productId: 'g' },
      knowledge: [],
      complete: async () => '',
    })
    expect(ordinary.messages).toHaveLength(1)
    expect(next).toHaveBeenCalledOnce()

    await expect(
      prepare({
        messages: [{ role: 'system', content: 'system' }],
        thread: [{ from: 'buyer', type: 'text', content: '推荐什么尺码' }],
        reviewContext: { storeId: 'a', productId: 'g' },
        knowledge: [],
        complete: async () => '',
      }),
    ).rejects.toThrow(/尺码规则不可用/)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })
})
