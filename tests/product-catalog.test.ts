import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createProductCatalog } from '../electron/product-catalog'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-catalog-'))
  roots.push(directory)
  const items = Array.from({ length: 135 }, (_, n) => ({
    id: 'p' + n,
    version: 1,
    updatedAt: 1,
    storeId: 'a',
    productId: 'platform-' + n,
    title: n === 134 ? '最后一页目标商品' : '普通商品',
    description: '',
    specifications: '',
    price: '',
    enabled: true,
  }))
  let revision = 1,
    active = true
  const execute = vi.fn(
    async (command: { storeId: string; values: { offset: number; limit: number } }) => ({
      status: 'ok',
      message: '',
      data: {
        revision,
        total: items.length,
        items: items.slice(command.values.offset, command.values.offset + command.values.limit),
      },
    }),
  )
  const assertActive = () => {
    if (!active) throw Error('工作区已变化')
  }
  const assertStore = (storeId: string) => {
    if (storeId !== 'a') throw Error('店铺不存在')
  }
  const make = () => createProductCatalog({ directory, execute, assertActive, assertStore })
  return {
    make,
    items,
    execute,
    directory,
    setRevision: (value: number) => (revision = value),
    close: () => (active = false),
  }
}
it('搜索全店各页并返回筛选后的总数，编码默认空且不改变平台商品编号', async () => {
  const f = fixture(),
    catalog = f.make()
  const page = await catalog.list('a', { query: '最后一页' })
  expect(page.total).toBe(1)
  expect(page.items[0]).toMatchObject({ id: 'p134', merchantCode: '', productId: 'platform-134' })
  expect(f.execute).toHaveBeenCalledTimes(2)
})
it('编码原子保存并跨实例恢复，编码搜索与分页保持一致', async () => {
  const f = fixture(),
    catalog = f.make()
  await catalog.setCodes('a', {
    revision: 0,
    confirmed: true,
    rows: [{ id: 'p134', version: 1, merchantCode: 'XM-YSP' }],
  })
  const page = await f.make().list('a', { merchantCode: 'xm-y', offset: 0, limit: 100 })
  expect(page.codesRevision).toBe(1)
  expect(page.total).toBe(1)
  expect(page.items[0].merchantCode).toBe('XM-YSP')
})
it('旧编码版本、商品版本、跨店和重复行均拒绝，批次失败不部分写入', async () => {
  const f = fixture(),
    catalog = f.make()
  const good = {
    revision: 0,
    confirmed: true as const,
    rows: [{ id: 'p0', version: 1, merchantCode: 'A' }],
  }
  await catalog.setCodes('a', good)
  await expect(catalog.setCodes('a', good)).rejects.toThrow('编码已更新')
  await expect(
    catalog.setCodes('a', {
      ...good,
      revision: 1,
      rows: [
        { id: 'p0', version: 1, merchantCode: 'B' },
        { id: 'p1', version: 9, merchantCode: 'C' },
      ],
    }),
  ).rejects.toThrow('商品已更新')
  await expect(catalog.setCodes('b', { ...good, revision: 1 })).rejects.toThrow('店铺不存在')
  await expect(
    catalog.setCodes('a', { ...good, revision: 1, rows: [good.rows[0], good.rows[0]] }),
  ).rejects.toThrow('商品重复')
  expect((await catalog.list('a', {})).items[0].merchantCode).toBe('A')
})
it('并发更新仅一项成功，账号关闭后的迟到读取不会发布', async () => {
  const f = fixture(),
    catalog = f.make(),
    input = {
      revision: 0,
      confirmed: true as const,
      rows: [{ id: 'p0', version: 1, merchantCode: 'A' }],
    }
  const outcomes = await Promise.allSettled([
    catalog.setCodes('a', input),
    catalog.setCodes('a', input),
  ])
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  f.execute.mockImplementationOnce(async () => {
    f.close()
    return {
      status: 'ok',
      message: '',
      data: { revision: 1, total: f.items.length, items: f.items.slice(0, 100) },
    }
  })
  await expect(catalog.list('a', {})).rejects.toThrow('工作区已变化')
})
it('分页期间商品修订变化或重复页会停止，不声明筛选完整', async () => {
  const f = fixture(),
    catalog = f.make()
  f.execute.mockImplementationOnce(async () => {
    f.setRevision(2)
    return {
      status: 'ok',
      message: '',
      data: { revision: 1, total: f.items.length, items: f.items.slice(0, 100) },
    }
  })
  await expect(catalog.list('a', {})).rejects.toThrow('采集期间已变化')
})
it('原生分页重复、跨店行和总数缺口均不能成为全店搜索结果', async () => {
  for (const variant of ['duplicate', 'foreign', 'empty']) {
    const f = fixture(),
      catalog = f.make()
    f.execute.mockImplementation(async (command) => ({
      status: 'ok',
      message: '',
      data: {
        revision: 1,
        total: 135,
        items:
          command.values.offset === 0
            ? f.items.slice(0, 100)
            : variant === 'empty'
              ? []
              : variant === 'foreign'
                ? [{ ...f.items[100], storeId: 'b' }]
                : f.items.slice(0, 35),
      },
    }))
    await expect(catalog.list('a', {})).rejects.toThrow(/分页重复|店铺不符|分页为空/)
  }
})
it('损坏编码存档不会降级为空或覆盖原文件，未知查询字段拒绝', async () => {
  const f = fixture(),
    catalog = f.make()
  await catalog.setCodes('a', {
    revision: 0,
    confirmed: true,
    rows: [{ id: 'p0', version: 1, merchantCode: 'A' }],
  })
  const directory = path.join(f.directory, 'product-codes'),
    target = path.join(directory, fs.readdirSync(directory)[0])
  fs.writeFileSync(target, '{broken')
  await expect(catalog.list('a', {})).rejects.toThrow('存档损坏')
  await expect(
    catalog.setCodes('a', {
      revision: 1,
      confirmed: true,
      rows: [{ id: 'p0', version: 1, merchantCode: 'B' }],
    }),
  ).rejects.toThrow('存档损坏')
  expect(fs.readFileSync(target, 'utf8')).toBe('{broken')
  await expect(catalog.list('a', { accountId: 'other' })).rejects.toThrow()
})
it('不同实例同时设置旧编码版本仍只有一个提交成功', async () => {
  const f = fixture(),
    input = {
      revision: 0,
      confirmed: true as const,
      rows: [{ id: 'p0', version: 1, merchantCode: 'A' }],
    }
  const result = await Promise.allSettled([
    f.make().setCodes('a', input),
    f.make().setCodes('a', input),
  ])
  expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
})
