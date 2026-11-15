// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge/repository'
import { createKnowledgeImageOcr } from '../electron/knowledge/image-ocr'
it('caches OCR per actual tile, rejects other-shop access and rejects late results after source changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ocr-scope-')),
    repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  let calls = 0,
    release: () => void = () => {},
    wait = false
  const service = createKnowledgeImageOcr({
    repository: repo,
    assertActive() {},
    recognize: async () => {
      calls++
      if (wait)
        await new Promise<void>((r) => {
          release = r
        })
      return { text: '型号 XM-YSP', lines: ['型号 XM-YSP'], language: 'zh-Hans-CN' }
    },
  })
  try {
    const c = repo.saveCanonical({ title: '商品' }),
      b = repo.bindProduct({ canonicalId: c.id, storeId: 's', productId: '1' })
    const canvas = createCanvas(40, 40),
      a = repo.addAsset(canvas.toBuffer('image/png'), { name: '图片', mimeType: 'image/png' })
    const s = repo.saveSource({
      storeId: 's',
      bindingId: b.id,
      kind: 'platform',
      label: '平台图片资料',
      text: '{"images":[]}',
      assetIds: [a.id],
    })
    const first = await service.recognize('s', [b.id], [s.id])
    expect(first.images).toBe(1)
    expect(first.items[0]?.text).toBe('型号 XM-YSP')
    await service.recognize('s', [b.id], [s.id])
    expect(calls).toBe(1)
    await expect(service.recognize('other', [b.id], [s.id])).rejects.toThrow('本店')
    canvas.getContext('2d').fillRect(0, 0, 10, 10)
    const nextAsset = repo.addAsset(canvas.toBuffer('image/png'), {
      name: '新图片',
      mimeType: 'image/png',
    })
    const next = repo.saveSource({
      id: s.id,
      expectedRevision: s.revision,
      storeId: 's',
      bindingId: b.id,
      kind: 'platform',
      label: s.label,
      text: s.text,
      assetIds: [nextAsset.id],
    })
    wait = true
    const pending = service.recognize('s', [b.id], [s.id])
    const rejected = expect(pending).rejects.toThrow('变化')
    for (let n = 0; n < 100 && calls < 2; n++) await new Promise((r) => setTimeout(r, 2))
    repo.saveSource({
      id: next.id,
      expectedRevision: next.revision,
      storeId: 's',
      bindingId: b.id,
      kind: 'platform',
      label: s.label,
      text: 'changed',
      assetIds: [],
    })
    release()
    await rejected
  } finally {
    service.dispose()
    repo.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
