import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PlatformOrderService, type PlatformOrderPort } from '../electron/platform-order-service'
import { platformOrderSchema } from '../src/shared/contracts/platform-orders'

const workspaceId = '299929d3-1fba-4907-bffa-1dfcd21217dc'
const range = { from: '2026-11-14', to: '2026-11-14' }
const roots: string[] = []
const services: PlatformOrderService[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
const row = (suffix: string) =>
  platformOrderSchema.parse({
    id: '261114-' + suffix.padStart(15, '0'),
    title: '合成商品',
    quantity: 1,
    rawStatus: '待发货',
    status: 'unshipped',
    createdAt: Date.parse('2026-11-14T10:00:00+08:00'),
    paidAt: null,
    goodsAmountCents: 1000,
    receivedCents: 980,
    refundedCents: null,
  })
function create(overrides: Partial<PlatformOrderPort> = {}, directory?: string) {
  const root = directory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-order-test-'))
  if (!directory) roots.push(root)
  const port: PlatformOrderPort = {
    assertActive() {},
    async identity() {
      return { accountId: 'account-a', platformStoreId: 'mall-a' }
    },
    async readPage(input) {
      return {
        platformStoreId: 'mall-a',
        range: { ...range, timezone: 'Asia/Shanghai', status: 'all', timeField: 'created' },
        page: input.page,
        total: 2,
        hasNext: input.page === 1,
        orders: [row(String(input.page))],
      }
    },
    ...overrides,
  }
  const service = new PlatformOrderService({ directory: root, workspaceId, port })
  services.push(service)
  return { service, root }
}
async function finish(service: PlatformOrderService) {
  for (let i = 0; i < 150; i++) {
    const value = service.snapshot(workspaceId, 'store-a')
    if (value.task?.state !== 'reading') return value
    await new Promise((r) => setTimeout(r, 10))
  }
  throw Error('采集未在测试期限完成')
}
describe('平台订单持久化与完整性', () => {
  it('CSV保留金额与来源，但用户文件不能冒充平台分页完整性', async () => {
    const { service } = create()
    const result = await service.execute({
      type: 'import',
      workspaceId,
      storeId: 'store-a',
      range,
      confirmed: true,
      csv: '订单号,商品名称,订单状态,商品数量,商品总价,实收金额,退款金额,下单时间\n261114-000000000000001,测试商品,已完成,1,10.00,9.80,0.00,2026-11-14 10:00:00',
    })
    expect(result.report).toMatchObject({ source: 'csv-import', complete: false, total: null })
    expect(result.report?.records[0]).toMatchObject({
      receivedCents: 980,
      refundedCents: 0,
      source: 'csv-import',
    })
    await expect(
      service.execute({
        type: 'import',
        workspaceId,
        storeId: 'store-a',
        range,
        confirmed: true,
        csv: '订单号,商品名称\n261114-000000000000002,缺字段',
      }),
    ).rejects.toThrow()
    expect(service.snapshot(workspaceId, 'store-a').report?.records[0].id).toBe(
      '261114-000000000000001',
    )
  })
  it('逐页采集、核对总数后发布，重启与店铺隔离', async () => {
    const { service, root } = create()
    await service.execute({ type: 'read', workspaceId, storeId: 'store-a', range })
    const result = await finish(service)
    expect(result.task?.state).toBe('complete')
    expect(result.report).toMatchObject({ complete: true, total: 2, pages: 2 })
    expect(result.report?.records).toHaveLength(2)
    service.dispose()
    const restored = create({}, root).service
    expect(restored.snapshot(workspaceId, 'store-a').report?.records).toHaveLength(2)
    expect(restored.snapshot(workspaceId, 'store-b').report).toBeNull()
    expect(() => restored.snapshot('different-workspace', 'store-a')).toThrow()
  })
  it('失败保留上次完整结果，不能以部分数据冒充完成', async () => {
    let failed = false
    const { service } = create({
      async readPage(input) {
        if (failed && input.page === 2) throw Error('平台查询中断')
        return {
          platformStoreId: 'mall-a',
          range: { ...range, timezone: 'Asia/Shanghai', status: 'all', timeField: 'created' },
          page: input.page,
          total: 2,
          hasNext: input.page === 1,
          orders: [row(String(input.page))],
        }
      },
    })
    await service.execute({ type: 'read', workspaceId, storeId: 'store-a', range })
    await finish(service)
    failed = true
    await service.execute({ type: 'read', workspaceId, storeId: 'store-a', range })
    const result = await finish(service)
    expect(result.task?.state).toBe('failed')
    expect(result.report?.complete).toBe(true)
    expect(result.report?.records).toHaveLength(2)
    expect(result.task?.error).toContain('中断')
  })
  it('拒绝重复整页、店铺身份改变和总数不符', async () => {
    for (const kind of ['repeated', 'identity', 'total']) {
      const { service } = create({
        async readPage(input) {
          return {
            platformStoreId: kind === 'identity' && input.page === 2 ? 'wrong-mall' : 'mall-a',
            range: { ...range, timezone: 'Asia/Shanghai', status: 'all', timeField: 'created' },
            page: input.page,
            total: kind === 'total' ? 3 : 2,
            hasNext: input.page === 1,
            orders: [row(kind === 'repeated' ? '1' : String(input.page))],
          }
        },
      })
      await service.execute({ type: 'read', workspaceId, storeId: 'store-a', range })
      const result = await finish(service)
      expect(result.task?.state).toBe('failed')
      expect(result.report).toBeNull()
    }
  })
  it('取消后迟到结果不得发布；重启未完成任务暂停', async () => {
    let release: (() => void) | undefined
    const { service, root } = create({
      async readPage(input) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return {
          platformStoreId: 'mall-a',
          range: { ...range, timezone: 'Asia/Shanghai', status: 'all', timeField: 'created' },
          page: input.page,
          total: 1,
          hasNext: false,
          orders: [row('1')],
        }
      },
    })
    const state = await service.execute({ type: 'read', workspaceId, storeId: 'store-a', range })
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 1))
    expect(create({}, root).service.snapshot(workspaceId, 'store-a').task?.state).toBe('paused')
    await service.execute({
      type: 'cancel',
      workspaceId,
      storeId: 'store-a',
      taskId: state.task!.id,
    })
    release?.()
    await new Promise((r) => setTimeout(r, 20))
    expect(service.snapshot(workspaceId, 'store-a').task?.state).toBe('cancelled')
    expect(service.snapshot(workspaceId, 'store-a').report).toBeNull()
  })
})
