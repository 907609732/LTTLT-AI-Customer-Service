import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CustomPhraseStore } from '../electron/custom-phrases-store'
import { createCustomPhrasesPreload } from '../electron/custom-phrases-preload'
import {
  parsePhraseImport,
  serializePhraseExport,
} from '../src/shared/customer-service/custom-phrases'

const folders: string[] = []
afterEach(() =>
  folders.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
)
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-phrases-'))
  folders.push(root)
  return { root, store: new CustomPhraseStore(root) }
}
const scope = { workspaceId: 'workspace-a', storeId: 'shop-a' }
const draft = { title: '物流核实', scene: '物流', reply: '我先核实一下。' }
describe('自定义快捷话术', () => {
  it('preload工厂仅转发受限通道并验证返回库', async () => {
    const calls: unknown[][] = []
    const api = createCustomPhrasesPreload(async (...args) => {
      calls.push(args)
      return { revision: 0, rows: [] }
    })
    expect(await api.list(scope)).toEqual({ revision: 0, rows: [] })
    expect(calls).toEqual([['custom-phrases:list', scope]])
    await expect(
      createCustomPhrasesPreload(async () => ({ rows: 'bad' })).list(scope),
    ).rejects.toThrow()
  })
  it('新增编辑删除持久化，并隔离店铺与工作区', () => {
    const { root, store } = setup()
    const initial = store.list(scope)
    const saved = store.save(scope, { revision: initial.revision, draft })
    expect(saved.rows).toHaveLength(1)
    expect(new CustomPhraseStore(root).list(scope)).toEqual(saved)
    expect(store.list({ ...scope, storeId: 'shop-b' }).rows).toEqual([])
    expect(store.list({ ...scope, workspaceId: 'restarted-workspace' })).toEqual(saved)
    expect(new CustomPhraseStore(path.join(root, 'another-account')).list(scope).rows).toEqual([])
    const row = saved.rows[0]!
    const edited = store.save(scope, {
      revision: saved.revision,
      id: row.id,
      draft: { ...draft, reply: '已修改' },
    })
    expect(edited.rows[0]?.reply).toBe('已修改')
    expect(store.remove(scope, { revision: edited.revision, id: row.id }).rows).toEqual([])
  })
  it('拒绝过期写入、未知 ID、越界输入及损坏文件，不静默覆盖', () => {
    const { root, store } = setup()
    const saved = store.save(scope, { revision: 0, draft })
    expect(() => store.save(scope, { revision: 0, draft })).toThrow(/已变化/)
    expect(() => store.save(scope, { revision: saved.revision, id: 'missing', draft })).toThrow()
    expect(() =>
      store.save(scope, { revision: saved.revision, draft: { ...draft, reply: ' ' } }),
    ).toThrow()
    const file = fs.readdirSync(root).find((name) => name.endsWith('.json'))!
    fs.writeFileSync(path.join(root, file), '{broken')
    expect(() => store.list(scope)).toThrow(/损坏/)
    expect(() => store.save(scope, { revision: 0, draft })).toThrow()
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe('{broken')
  })
  it('导出不含工作区信息，导入全量校验后追加去重且不信任文件 ID', () => {
    const { store } = setup()
    const saved = store.save(scope, { revision: 0, draft })
    const text = serializePhraseExport(saved.rows)
    expect(text).not.toContain('workspace-a')
    expect(parsePhraseImport(text)).toEqual([draft])
    const imported = store.import(scope, { revision: saved.revision, text })
    expect(imported.rows).toHaveLength(1)
    expect(() =>
      store.import(scope, {
        revision: imported.revision,
        text: JSON.stringify({ version: 1, phrases: [draft, { ...draft, reply: '' }] }),
      }),
    ).toThrow()
    expect(store.list(scope)).toEqual(imported)
    expect(() => parsePhraseImport('x'.repeat(2_000_001))).toThrow()
  })
})
