// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeSourcePipeline } from '../electron/knowledge/source-pipeline'
it('archives only selected dates and store, reports actual text/media counts and imports chat locators', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-chat-'))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'w' })
  const port = createKnowledgeSourcePipeline({
    repository,
    assertActive() {},
    changed() {},
    chooseFiles: async () => [],
    model: {
      vision: () => ({ supported: false, maxImages: 0, reason: '' }),
      complete: async () => {
        throw Error('must not call model')
      },
    },
    chats: () => [
      {
        storeId: 's',
        uid: 'u',
        name: '测试',
        status: 'active',
        messages: [
          { from: 'buyer', content: '旧消息', ts: 10, msgId: 'old' },
          { from: 'buyer', content: '发货?', ts: 20, msgId: 'q' },
          { from: 'seller', content: '两日内', ts: 30, msgId: 'a' },
          { from: 'buyer', content: 'image', type: 'image', ts: 25, msgId: 'image' },
        ],
      },
      {
        storeId: 'other',
        uid: 'x',
        name: '',
        status: 'active',
        messages: [{ from: 'seller', content: '不能导入', ts: 20 }],
      },
    ],
  })
  try {
    const result = (await port.request({
      action: 'archive-chat',
      storeId: 's',
      from: 15,
      to: 35,
    })) as { sourceIds: string[]; range: string }
    expect(result.range).toContain('2条文字')
    expect(result.range).toContain('1条媒体')
    const preview = (await port.request({
      action: 'preview-import',
      storeId: 's',
      sourceIds: result.sourceIds,
      bindingIds: [],
    })) as { previewId: string; rows: { text: string }[] }
    expect(preview.rows).toHaveLength(2)
    expect(JSON.stringify(preview.rows)).not.toContain('旧消息')
    await port.request({
      action: 'start',
      kind: 'import',
      storeId: 's',
      estimateId: preview.previewId,
    })
    await new Promise((r) => setTimeout(r, 50))
    const sources = repository.listSources().filter((s) => s.kind === 'chat')
    expect(sources.map((s) => s.locator.messageId)).toEqual(['q', 'a'])
    expect(sources.every((s) => s.storeId === 's' && !s.bindingId)).toBe(true)
  } finally {
    port.dispose()
    repository.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
