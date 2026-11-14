import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptySnapshot, storeSchema } from '../src/shared/contracts/backend'
import { registerCustomPhrasesIpc } from '../electron/custom-phrases-ipc'
import type { PhraseLibrary } from '../src/shared/customer-service/custom-phrases'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, scope: unknown, input?: unknown) => unknown>(),
  frame: vi.fn(),
  copy: vi.fn(),
}))
vi.mock('electron', () => ({
  clipboard: { writeText: fake.copy },
  ipcMain: {
    handle: (name: string, fn: (event: unknown, scope: unknown, input?: unknown) => unknown) =>
      fake.handlers.set(name, fn),
    removeHandler: (name: string) => fake.handlers.delete(name),
  },
}))
vi.mock('../electron/local-runtime', () => ({ requireAppFrame: fake.frame }))
const folders: string[] = []
afterEach(() => {
  fake.handlers.clear()
  vi.clearAllMocks()
  folders.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))
})
describe('自定义话术 IPC 边界', () => {
  it('每次检查可信 frame、当前工作区和店铺；仅已保存ID可复制，切账号切换数据目录', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phrase-ipc-'))
    folders.push(root)
    const snapshot = emptySnapshot()
    snapshot.workspaceId = 'w1'
    snapshot.stores = [
      storeSchema.parse({
        id: 's1',
        storeName: '店铺',
        platform: 'sim',
        aiEnabled: false,
        runtime: {},
      }),
    ]
    let account = 'a'
    const off = registerCustomPhrasesIpc({ snapshot: () => snapshot }, () =>
      path.join(root, account),
    )
    const invoke = (name: string, scope: unknown, input?: unknown) =>
      fake.handlers.get(`custom-phrases:${name}`)!({}, scope, input)
    const scope = { workspaceId: 'w1', storeId: 's1' }
    const saved = invoke('save', scope, {
      revision: 0,
      draft: { title: '问候', scene: '通用', reply: '您好' },
    }) as PhraseLibrary
    invoke('copy', scope, { id: saved.rows[0]!.id })
    expect(fake.copy).toHaveBeenCalledWith('您好')
    expect(() => invoke('copy', scope, { id: saved.rows[0]!.id, text: '任意文字' })).toThrow()
    expect(() => invoke('list', { ...scope, workspaceId: 'old' })).toThrow(/工作区/)
    expect(() => invoke('list', { ...scope, storeId: 'missing' })).toThrow(/店铺/)
    account = 'b'
    expect((invoke('list', scope) as PhraseLibrary).rows).toEqual([])
    account = 'a'
    snapshot.workspaceId = 'restarted'
    expect(
      (invoke('list', { ...scope, workspaceId: 'restarted' }) as PhraseLibrary).rows,
    ).toHaveLength(1)
    fake.frame.mockImplementationOnce(() => {
      throw new Error('untrusted')
    })
    expect(() => invoke('list', scope)).toThrow('untrusted')
    off()
    expect(fake.handlers.size).toBe(0)
  })
})
