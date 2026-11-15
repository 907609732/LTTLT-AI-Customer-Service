// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge/repository'
import { KnowledgeRestoreInterruptedError } from '../electron/knowledge/restore-intent'
import { reportStartupFailure } from '../electron/startup-failure'

it.each(['{broken', JSON.stringify({ archive: '../../outside', staged: 'C:/unrelated-secret' })])(
  'blocks incomplete or untrusted intent before migration and shows only the trusted recovery directory',
  (marker) => {
    const directory = mkdtempSync(join(tmpdir(), 'knowledge-intent-startup-'))
    try {
      writeFileSync(join(directory, 'knowledge-restore-intent.json'), marker)
      writeFileSync(join(directory, 'products.json'), 'original legacy bytes')
      const showErrorBox = vi.fn(),
        exit = vi.fn()
      let error: unknown
      try {
        createKnowledgeRepository({ directory, workspaceId: 'test' })
      } catch (cause) {
        error = cause
      }
      expect(error).toBeInstanceOf(KnowledgeRestoreInterruptedError)
      reportStartupFailure(error, { showErrorBox, exit })
      const [title, message] = showErrorBox.mock.calls[0]!
      expect(title).toContain('恢复中断')
      expect(message).toContain(directory)
      expect(message).toContain('完整复制')
      expect(message).toContain('恢复中断维护步骤')
      expect(message).not.toContain('unrelated-secret')
      expect(message).not.toContain('../../outside')
      expect(exit).toHaveBeenCalledWith(1)
      expect(existsSync(join(directory, 'knowledge.sqlite'))).toBe(false)
      expect(readFileSync(join(directory, 'products.json'), 'utf8')).toBe('original legacy bytes')
      expect(readFileSync(join(directory, 'knowledge-restore-intent.json'), 'utf8')).toBe(marker)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

it('keeps arbitrary startup exceptions out of the user dialog', () => {
  const showErrorBox = vi.fn(),
    exit = vi.fn()
  reportStartupFailure(Error('untrusted token=PRIVATE'), { showErrorBox, exit })
  expect(showErrorBox.mock.calls[0]![1]).not.toContain('PRIVATE')
  expect(exit).toHaveBeenCalledWith(1)
})
