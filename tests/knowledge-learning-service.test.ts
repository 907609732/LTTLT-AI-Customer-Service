// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLearningService } from '../src/modules/knowledge/services'
import { candidatePack, documentCandidates } from '../src/modules/knowledge/learning'
import type { CommandInput, IntentPack } from '../src/shared/contracts/backend'

const require = createRequire(import.meta.url)
interface Knowledge {
  list(): IntentPack[]
  summary(): { revision: number }
  save(value: unknown): IntentPack
  search(storeId: string, query: string, productId?: string): unknown[]
  exportJson(): string
}
const { createIntentKnowledge } =
  require('../vendor/lingtu-runtime/electron/intent-knowledge.cjs') as {
    createIntentKnowledge(file: string): Knowledge
  }
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'lingtu-knowledge-'))
  directories.push(directory)
  const file = join(directory, 'intents.json'),
    knowledge = createIntentKnowledge(file)
  const commands: CommandInput[] = []
  const service = createLearningService(async (command) => {
    commands.push(command)
    if (command.action === 'list-intent-packs')
      return { data: { packs: knowledge.list(), revision: knowledge.summary().revision } }
    if (command.action === 'save-intent-pack')
      return { data: { ...knowledge.save(command.values) } }
    throw new Error('unexpected command')
  })
  return { file, knowledge, commands, service }
}

describe('learning service with real upstream persistence', () => {
  it('requires explicit confirmation before making commands', async () => {
    const { service, commands } = setup()
    const [row] = documentCandidates('shop', '政策', '问：发货\n答：48小时')
    await expect(service.confirm(row!, false)).rejects.toThrow('确认')
    expect(commands).toEqual([])
  })
  it('persists original and reviewed text, keeps inactive until human enables, isolates stores', async () => {
    const { service, file } = setup()
    const [row] = documentCandidates('shop', '政策', '问：发货\n答：48小时')
    await service.confirm(
      {
        ...row!,
        answer: '以页面承诺为准',
        original: { question: row!.question, answer: row!.answer },
      },
      true,
    )
    const reloaded = createIntentKnowledge(file),
      pack = reloaded.list()[0]!
    expect(pack.enabled).toBe(false)
    expect(reloaded.search('shop', '发货')).toEqual([])
    const audit = JSON.parse(pack.entries[1]!.answer)
    expect(audit.original.answer).toBe('48小时')
    expect(audit.reviewed.answer).toBe('以页面承诺为准')
    reloaded.save({ ...pack, enabled: true })
    expect(reloaded.search('shop', '发货')).toHaveLength(1)
    expect(reloaded.search('other', '发货')).toEqual([])
    expect(reloaded.search('shop', '学习来源审计')).toEqual([])
  })
  it('prevents same-source same-answer duplicates and concurrent clicks', async () => {
    const { service, knowledge } = setup()
    const [row] = documentCandidates('shop', '政策', '问：发货\n答：48小时')
    const first = service.confirm(row!, true)
    await expect(service.confirm(row!, true)).rejects.toThrow('正在入库')
    await first
    await expect(service.confirm(row!, true)).rejects.toThrow('已入库')
    expect(knowledge.list()).toHaveLength(1)
  })
  it('checks workspace/store again after async listing', async () => {
    const { service, knowledge, commands } = setup()
    const [row] = documentCandidates('shop', '政策', '问：发货\n答：48小时')
    await expect(service.confirm(row!, true, () => false)).rejects.toThrow('已变化')
    expect(knowledge.list()).toHaveLength(0)
    expect(commands.map((c) => c.action)).toEqual(['list-intent-packs'])
  })
  it('rejects audit overflow before any persistence', () => {
    const [row] = documentCandidates('shop', '政策', '问：发货\n答：' + '长'.repeat(3990))
    expect(() => candidatePack(row!)).toThrow('容量')
  })
  it('adds size knowledge without replacing existing facts and binds exact product', async () => {
    const { service, knowledge } = setup()
    const [existing] = documentCandidates('shop', '旧资料', '问：衣服规格\n答：旧内容')
    knowledge.save({ ...candidatePack(existing!), enabled: true })
    await service.confirm(
      {
        question: '衣服规格',
        answer: 'M | 100 cm',
        productIds: ['product-1'],
        source: { kind: 'size', storeId: 'shop', label: '人工尺码表' },
      },
      true,
    )
    const packs = knowledge.list()
    expect(packs[0]!.entries[0]!.answer).toBe('旧内容')
    knowledge.save({ ...packs[1]!, enabled: true })
    expect(knowledge.search('shop', '衣服规格', 'product-1')).toHaveLength(2)
    expect(knowledge.search('shop', '衣服规格', 'product-2')).toHaveLength(1)
    const exported = JSON.parse(knowledge.exportJson())
    expect(JSON.parse(exported[1].entries[1].answer).source.kind).toBe('size')
    expect(exported[1].entries[1].enabled).toBe(false)
  })
})
