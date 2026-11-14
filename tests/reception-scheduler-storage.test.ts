import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileScheduler } from '../electron/scheduler-storage'

describe('调度工作区文件', () => {
  it('原子保存后新实例恢复任务，旧workspace令牌不能操作', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-scheduler-test-'))
    try {
      const first = createFileScheduler({ workspaceId: 'first', directory, validateTask: () => {} })
      first.execute({
        type: 'save',
        workspaceId: 'first',
        task: {
          name: 'test',
          storeId: 's',
          uid: 'u',
          enabled: false,
          action: { kind: 'welcome-text', text: 'hello' },
          schedule: { type: 'interval', minutes: 1 },
        },
      })
      const second = createFileScheduler({
        workspaceId: 'second',
        directory,
        validateTask: () => {},
      })
      expect(second.snapshot().tasks).toHaveLength(1)
      expect(() =>
        second.execute({
          type: 'remove',
          workspaceId: 'first',
          id: second.snapshot().tasks[0].id,
          revision: 1,
        }),
      ).toThrow(/工作区/)
      expect(
        JSON.parse(readFileSync(join(directory, 'reception-scheduler.json'), 'utf8')).version,
      ).toBe(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('损坏文件拒绝加载，不用空状态覆盖现有记录', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-scheduler-test-'))
    try {
      writeFileSync(join(directory, 'reception-scheduler.json'), '{invalid')
      expect(() =>
        createFileScheduler({ workspaceId: 'w', directory, validateTask: () => {} }),
      ).toThrow()
      expect(readFileSync(join(directory, 'reception-scheduler.json'), 'utf8')).toBe('{invalid')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
