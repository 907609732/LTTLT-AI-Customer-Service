import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoreSync } from '../electron/store-sync-service'
import {
  emptySnapshot,
  type BackendCommand,
  type BackendResult,
  type Product,
} from '../src/shared/contracts/backend'

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lingtu-sync-'))
  const snap = emptySnapshot()
  snap.workspaceId = '00000000-0000-4000-8000-000000000001'
  snap.stores = ['source', 'target', 'other'].map((id) => ({
    id,
    storeName: id,
    platform: 'sim',
    group: '',
    aiEnabled: false,
    runtime: { open: false, online: false },
  }))
  snap.welcomeByStore.source = { text: '源店欢迎', enabled: true, version: 1 }
  snap.welcomeByStore.target = { text: '目标原文', enabled: false, version: 1 }
  let products: Product[] = [
    {
      id: '00000000-0000-4000-8000-000000000002',
      storeId: 'source',
      productId: 'sku',
      title: '商品',
      description: '资料',
      specifications: '',
      price: '',
      enabled: true,
      version: 1,
      updatedAt: 1,
    },
  ]
  let revision = 0
  const writes: BackendCommand[] = []
  let fail = ''
  const port = {
    snapshot: () => structuredClone(snap),
    assertActive: () => {},
    execute: async (command: BackendCommand): Promise<BackendResult> => {
      const v = command.values
      let data: Record<string, unknown> = {}
      if (command.action === 'list-products')
        data = {
          revision,
          total: products.filter((p) => p.storeId === command.storeId).length,
          items: products
            .filter((p) => p.storeId === command.storeId)
            .slice(Number(v.offset), Number(v.offset) + Number(v.limit)),
        }
      else {
        writes.push(command)
        if (fail === command.action) {
          fail = ''
          throw Error('disk failure')
        }
        if (command.action === 'save-product') {
          const old = products.find(
            (p) => p.storeId === command.storeId && p.productId === v.productId,
          )
          if (old && old.version !== v.version) throw Error('version conflict')
          const next = {
            ...v,
            storeId: command.storeId,
            id: old?.id || crypto.randomUUID(),
            version: (old?.version || 0) + 1,
            updatedAt: Date.now(),
          } as Product
          products = [...products.filter((p) => p.id !== next.id), next]
          revision++
        } else if (command.action === 'remove-product') {
          products = products.filter((p) => p.id !== v.id)
          revision++
        } else if (command.action === 'save-welcome')
          snap.welcomeByStore[command.storeId!] = {
            text: String(v.text),
            enabled: Boolean(v.enabled),
            version: Number(v.version) + 1,
          }
        else throw Error(`unexpected ${command.action}`)
      }
      return { status: 'ok', message: '', data }
    },
  }
  return {
    dir,
    snap,
    writes,
    port,
    service: createStoreSync({ directory: dir, port }),
    products: () => products,
    fail: (action: string) => {
      fail = action
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}
const request = {
  sourceStoreId: 'source',
  targetStoreIds: ['target'],
  sections: ['products', 'welcome'],
  productIds: ['sku'],
  conflict: 'replace',
}

describe('store sync safety', () => {
  it('previews without writes; applies only targets and rolls back after restart', async () => {
    const f = fixture()
    try {
      const preview = await f.service.preview(request)
      expect(f.writes).toHaveLength(0)
      const result = await f.service.apply({ planId: preview.planId, confirmed: true })
      expect(result.status).toBe('completed')
      expect(f.products().filter((p) => p.storeId === 'target')).toHaveLength(1)
      expect(f.snap.welcomeByStore.target.text).toBe('源店欢迎')
      expect(f.writes.every((c) => c.storeId === 'target')).toBe(true)
      const restarted = createStoreSync({ directory: f.dir, port: f.port })
      await restarted.rollback({ backupId: result.backupId, confirmed: true })
      expect(f.products().filter((p) => p.storeId === 'target')).toHaveLength(0)
      expect(f.snap.welcomeByStore.target.text).toBe('目标原文')
    } finally {
      f.cleanup()
    }
  })
  it('rejects source or target changes since preview, without writing', async () => {
    const f = fixture()
    try {
      const p = await f.service.preview(request)
      f.snap.welcomeByStore.source.text = 'changed'
      await expect(f.service.apply({ planId: p.planId, confirmed: true })).rejects.toThrow(
        '重新预览',
      )
      expect(f.writes).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
  it('keeps a recoverable journal on partial failure and does not claim success', async () => {
    const f = fixture()
    try {
      const p = await f.service.preview(request)
      f.fail('save-welcome')
      const result = await f.service.apply({ planId: p.planId, confirmed: true })
      expect(result.status).toBe('failed')
      expect(result.error).toContain('disk failure')
      const restored = await f.service.rollback({ backupId: result.backupId, confirmed: true })
      expect(restored.applied).toBe(1)
      expect(restored.restored).toBe(1)
      expect(f.products().filter((p) => p.storeId === 'target')).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
  it('refuses rollback over later edits', async () => {
    const f = fixture()
    try {
      const p = await f.service.preview(request)
      const result = await f.service.apply({ planId: p.planId, confirmed: true })
      f.snap.welcomeByStore.target = { text: '人工新修改', enabled: false, version: 3 }
      const restored = await f.service.rollback({ backupId: result.backupId, confirmed: true })
      expect(restored.status).toBe('rollback-blocked')
      expect(f.snap.welcomeByStore.target.text).toBe('人工新修改')
    } finally {
      f.cleanup()
    }
  })
  it('requires explicit confirmation and disallows source as target', async () => {
    const f = fixture()
    try {
      await expect(f.service.preview({ ...request, targetStoreIds: ['source'] })).rejects.toThrow()
      const p = await f.service.preview(request)
      await expect(f.service.apply({ planId: p.planId, confirmed: false })).rejects.toThrow()
      expect(f.writes).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
  it('preserves existing target products in skip mode', async () => {
    const f = fixture()
    try {
      await f.port.execute({
        workspaceId: f.snap.workspaceId,
        action: 'save-product',
        storeId: 'target',
        values: {
          productId: 'sku',
          title: '目标商品',
          description: '',
          specifications: '',
          price: '',
          enabled: false,
        },
      })
      f.writes.length = 0
      const p = await f.service.preview({ ...request, sections: ['products'], conflict: 'skip' })
      expect(p.rows[0].action).toBe('skip')
      await f.service.apply({ planId: p.planId, confirmed: true })
      expect(f.writes).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
  it('rejects stale target data and replayed plans', async () => {
    const f = fixture()
    try {
      const p = await f.service.preview(request)
      f.snap.welcomeByStore.target.version++
      await expect(f.service.apply({ planId: p.planId, confirmed: true })).rejects.toThrow(
        '重新预览',
      )
      await expect(f.service.apply({ planId: p.planId, confirmed: true })).rejects.toThrow('过期')
      expect(f.writes).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
  it('expires previews after ten minutes', async () => {
    const f = fixture()
    try {
      const p = await f.service.preview(request)
      const now = Date.now
      Date.now = () => p.expiresAt + 1
      try {
        await expect(f.service.apply({ planId: p.planId, confirmed: true })).rejects.toThrow('过期')
      } finally {
        Date.now = now
      }
    } finally {
      f.cleanup()
    }
  })
  it('blocks active concurrent runs and rejects work after disposal', async () => {
    const f = fixture()
    try {
      const pending = f.service.preview(request)
      expect(f.service.isBusy()).toBe(true)
      await expect(f.service.preview(request)).rejects.toThrow('等待')
      await pending
      expect(f.service.isBusy()).toBe(false)
      f.service.dispose()
      await expect(f.service.preview(request)).rejects.toThrow('关闭')
    } finally {
      f.cleanup()
    }
  })
  it('recovers a write completed just before the applied marker was saved', async () => {
    const f = fixture()
    try {
      const p = await f.service.preview({ ...request, sections: ['products'] })
      const applied = await f.service.apply({ planId: p.planId, confirmed: true })
      const file = path.join(f.dir, `${applied.backupId}.json`)
      const journal = JSON.parse(readFileSync(file, 'utf8')) as {
        status: string
        operations: { state: string }[]
      }
      journal.status = 'failed'
      journal.operations[0].state = 'writing'
      writeFileSync(file, JSON.stringify(journal))
      const restarted = createStoreSync({ directory: f.dir, port: f.port })
      expect(
        (await restarted.rollback({ backupId: applied.backupId, confirmed: true })).status,
      ).toBe('rolled-back')
      expect(f.products().filter((p) => p.storeId === 'target')).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
  it('does not mutate data when backup storage is unavailable', async () => {
    const f = fixture()
    try {
      const blocked = path.join(f.dir, 'not-a-directory')
      writeFileSync(blocked, 'existing file')
      const service = createStoreSync({ directory: blocked, port: f.port })
      const p = await service.preview(request)
      await expect(service.apply({ planId: p.planId, confirmed: true })).rejects.toThrow()
      expect(f.writes).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  })
})
