// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createStoreSync } from '../electron/store-sync-service'
import { snapshotSchema, resultSchema, type BackendCommand } from '../src/shared/contracts/backend'

const require = createRequire(import.meta.url)
interface Backend {
  snapshot(): unknown
  execute(input: unknown): Promise<unknown>
  dispose(): void
}
const { createBackend } = require('../vendor/lingtu-runtime/electron/backend.cjs') as {
  createBackend: (options: Record<string, unknown>) => Backend
}

describe('store sync real upstream persistence', () => {
  it('copies all supported sections and restores isolated target across backend restarts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lingtu-sync-upstream-'))
    let backend = createBackend({
      dataDir: dir,
      localVisionSupport: () => ({
        supported: true,
        reason: 'test only',
        model: 'fixture',
        maxImages: 4,
      }),
    })
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    const execute = async (input: Partial<BackendCommand>) =>
      resultSchema.parse(await backend.execute(input))
    const snapshot = () =>
      snapshotSchema.parse({ ...(backend.snapshot() as Record<string, unknown>), workspaceId })
    const port = {
      snapshot,
      execute: (input: BackendCommand) => execute(input),
      assertActive: () => {},
    }
    const directory = path.join(dir, 'store-sync-backups')
    try {
      for (const name of ['源店', '目标店', '旁店'])
        await execute({ action: 'add-store', values: { storeName: name, platform: 'pdd-web' } })
      const [source, target, other] = snapshot().stores
      await execute({
        action: 'save-product',
        storeId: source.id,
        values: {
          productId: 'sku1',
          title: '源商品',
          description: '源资料',
          specifications: '',
          price: '',
          enabled: true,
        },
      })
      await execute({
        action: 'save-product',
        storeId: target.id,
        values: {
          productId: 'sku1',
          title: '目标原商品',
          description: '目标资料',
          specifications: '',
          price: '',
          enabled: false,
        },
      })
      await execute({
        action: 'save-product',
        storeId: other.id,
        values: {
          productId: 'sku1',
          title: '旁店商品',
          description: '不能被改',
          specifications: '',
          price: '',
          enabled: true,
        },
      })
      await execute({
        action: 'save-welcome',
        storeId: source.id,
        values: { text: '您好', enabled: true, version: 0 },
      })
      await execute({
        action: 'save-vision-settings',
        storeId: source.id,
        values: { enabled: true, version: 0 },
      })
      await execute({
        action: 'save-store-handoff',
        storeId: source.id,
        values: { mode: 'custom', keywords: ['人工', '投诉'] },
      })
      const service = createStoreSync({ directory, port })
      const p = await service.preview({
        sourceStoreId: source.id,
        targetStoreIds: [target.id],
        sections: ['products', 'welcome', 'vision', 'handoff'],
        productIds: ['sku1'],
        conflict: 'replace',
      })
      expect(p.rows).toHaveLength(4)
      const applied = await service.apply({ planId: p.planId, confirmed: true })
      expect(applied.status).toBe('completed')
      expect(applied.applied).toBe(4)
      expect(snapshot().handoffByStore[target.id].keywords).toEqual(['人工', '投诉'])
      expect(snapshot().welcomeByStore[target.id].text).toBe('您好')
      expect(snapshot().visionByStore[target.id].enabled).toBe(true)
      expect(snapshot().stores.every((s) => !s.aiEnabled)).toBe(true)
      backend.dispose()
      backend = createBackend({
        dataDir: dir,
        localVisionSupport: () => ({
          supported: true,
          reason: 'test only',
          model: 'fixture',
          maxImages: 4,
        }),
      })
      const restarted = createStoreSync({ directory, port })
      expect(restarted.backups()[0].backupId).toBe(applied.backupId)
      const restored = await restarted.rollback({ backupId: applied.backupId, confirmed: true })
      expect(restored.status).toBe('rolled-back')
      expect(restored.restored).toBe(4)
      const targetProducts = await execute({
        action: 'list-products',
        storeId: target.id,
        values: { offset: 0, limit: 100 },
      })
      expect((targetProducts.data.items as { title: string }[])[0].title).toBe('目标原商品')
      expect(snapshot().handoffByStore[target.id]).toBeUndefined()
      expect(snapshot().welcomeByStore[target.id].enabled).toBe(false)
      expect(snapshot().visionByStore[target.id].enabled).toBe(false)
      const otherProducts = await execute({
        action: 'list-products',
        storeId: other.id,
        values: { offset: 0, limit: 100 },
      })
      expect((otherProducts.data.items as { description: string }[])[0].description).toBe(
        '不能被改',
      )
    } finally {
      backend.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
