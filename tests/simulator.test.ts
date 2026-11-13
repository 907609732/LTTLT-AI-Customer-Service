import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SIM_PLATFORM_ID } from '../src/shared/contracts/simulation'
import { SimHub } from '../electron/sim-hub'
import { createSimAdapter } from '../electron/sim-adapter'
import { SimStoreManager, createSimManagerFactory } from '../electron/sim-manager'
import { createSimServer, type SimServer } from '../electron/sim-server'

/** 本机模拟店铺的自有链路回归：中枢、适配器、管理器包装与顾客模拟页服务。 */

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-sim-'))
  tempDirs.push(dir)
  return path.join(dir, 'simulator-stores.json')
}

function request(
  port: number,
  pathname: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const payload = init.body === undefined ? '' : JSON.stringify(init.body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: init.method ?? 'GET',
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            contentType: String(res.headers['content-type'] ?? ''),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** 只保留本机模拟店铺，避免测试里混入真实平台店铺口径。 */
function simStoresOf(hub: SimHub): { storeId: string; storeName: string }[] {
  return hub.stores().map((store) => ({ storeId: store.storeId, storeName: store.storeName }))
}

describe('本机模拟店铺中枢', () => {
  it('首次打开生成默认顾客，买家消息进入待回复队列并可被认领一次', () => {
    const hub = new SimHub({ file: tempFile(), now: () => 1_700_000_000_000 })
    hub.attach('sim-1', '演示模拟店')
    const personas = hub.personas('sim-1')
    expect(personas).toHaveLength(3)
    expect(personas[0]?.name).toBe('小雨')

    const uid = personas[0]!.uid
    const message = hub.buyerMessage('sim-1', uid, '你好，这件有 M 码吗')
    expect(message.from).toBe('buyer')
    expect(hub.thread('sim-1', uid)).toHaveLength(1)

    const first = hub.claim('sim-1')
    expect(first?.uid).toBe(uid)
    expect(first?.messages[0]?.content).toBe('你好，这件有 M 码吗')
    // 认领中的会话不能被第二次认领，避免重复回复同一买家。
    expect(hub.claim('sim-1')).toBeNull()
    hub.release('sim-1', uid)
    expect(hub.claim('sim-1')?.uid).toBe(uid)

    hub.discard('sim-1', uid)
    expect(hub.pendingSnapshot('sim-1')).toEqual({ count: 0, uids: [] })
  })

  it('事件流水按 seq 增量返回，客服消息与买家消息方向保持真实格式', () => {
    const hub = new SimHub({ file: tempFile(), now: () => 1_700_000_000_000 })
    hub.attach('sim-1', '演示模拟店')
    const uid = hub.personas('sim-1')[0]!.uid
    hub.buyerMessage('sim-1', uid, '在吗')
    hub.sellerMessage('sim-1', uid, '在的，请说')

    const drained = hub.drainEvents('sim-1', 0)
    expect(drained.events.map((event) => event.from)).toEqual(['buyer', 'seller'])
    expect(drained.events[0]?.username).toBe('小雨')
    expect(drained.events.every((event) => event.type === 'text')).toBe(true)
    expect(drained.events.every((event) => typeof event.ts === 'number' && event.ts > 0)).toBe(true)
    expect(hub.drainEvents('sim-1', drained.seq).events).toHaveLength(0)
  })

  it('顾客与消息落盘后可在重启时恢复，删除店铺即清空', () => {
    const file = tempFile()
    const first = new SimHub({ file })
    first.attach('sim-1', '演示模拟店')
    const created = first.addPersona('sim-1', '新顾客甲', '问发票')
    first.buyerMessage('sim-1', created.uid, '能开发票吗')
    expect(first.persistError).toBe('')

    const second = new SimHub({ file })
    second.attach('sim-1', '演示模拟店')
    expect(second.personas('sim-1').map((persona) => persona.name)).toContain('新顾客甲')

    second.forget('sim-1')
    const third = new SimHub({ file })
    third.attach('sim-1', '演示模拟店')
    expect(third.personas('sim-1').map((persona) => persona.name)).not.toContain('新顾客甲')
  })
})

describe('本机模拟店铺适配器', () => {
  it('只有 sim-local 店铺能创建适配器，其他平台明确拒绝', () => {
    const hub = new SimHub({ file: tempFile() })
    expect(() => createSimAdapter({ id: 'x', platform: 'pdd-web' }, hub)).toThrow(
      '该店铺不是本机模拟店铺',
    )
    expect(createSimAdapter({ id: 'sim-1', platform: SIM_PLATFORM_ID }, hub).id).toBe(
      SIM_PLATFORM_ID,
    )
  })

  it('发文字写入本机线程，图片与视频如实报不支持，网页复核返回未知', async () => {
    const hub = new SimHub({ file: tempFile(), now: () => 1_700_000_000_000 })
    hub.attach('sim-1', '演示模拟店')
    const adapter = createSimAdapter(
      { id: 'sim-1', storeName: '演示模拟店', platform: SIM_PLATFORM_ID },
      hub,
    )
    const uid = hub.personas('sim-1')[0]!.uid

    const sent = await adapter.sendText(uid, '已下单，请放心')
    expect(sent.ok).toBe(true)
    expect(hub.thread('sim-1', uid).at(-1)?.from).toBe('seller')

    const image = await adapter.sendImage(uid)
    expect(image.ok).toBe(false)
    if (!image.ok) expect(image.reason).toBe('input_not_found')

    const reviewed = await adapter.reviewHistory(uid)
    expect(reviewed.known).toBe(false)

    hub.buyerMessage('sim-1', uid, '好的')
    const drained = await adapter.drainEvents(0)
    expect(drained.ok).toBe(true)
  })
})

describe('本机模拟店铺管理器包装', () => {
  const registry = {
    get: (storeId: string) =>
      storeId.startsWith('sim-')
        ? { id: storeId, storeName: '演示模拟店', platform: SIM_PLATFORM_ID }
        : { id: storeId, storeName: '真实店铺', platform: 'pdd-web' },
  }
  const delegate = {
    stateOf: () => ({ open: true, online: true, authenticated: true }),
    open: () => Promise.resolve('vendor-open'),
    close: () => undefined,
    closeAll: () => undefined,
    restartClient: () => Promise.resolve('vendor-restart'),
  }

  it('模拟店铺的打开状态来自本机中枢，且不冒充已登录', () => {
    const hub = new SimHub({ file: tempFile() })
    const manager = new SimStoreManager(delegate, hub, registry)
    expect(manager.stateOf('sim-1')).toEqual({
      open: false,
      online: false,
      awaitingClient: false,
      lastError: '',
    })
    void manager.open('sim-1')
    expect(hub.isOpen('sim-1')).toBe(true)
    expect(manager.stateOf('sim-1')).toEqual({
      open: true,
      online: true,
      awaitingClient: false,
      lastError: '',
    })
    expect('authenticated' in manager.stateOf('sim-1')).toBe(false)
    manager.close('sim-1')
    expect(hub.isOpen('sim-1')).toBe(false)
  })

  it('真实平台店铺仍走厂商管理器，模拟店铺没有可重启客户端', async () => {
    const hub = new SimHub({ file: tempFile() })
    const manager = new SimStoreManager(delegate, hub, registry)
    expect(manager.stateOf('pdd-1')).toEqual({ open: true, online: true, authenticated: true })
    expect(await manager.open('pdd-1')).toBe('vendor-open')
    expect(() => manager.restartClient('sim-1')).toThrow('本机模拟店铺没有可重启的客户端')
  })

  it('工厂按同签名注入，并从依赖里取店铺注册表', () => {
    const hub = new SimHub({ file: tempFile() })
    const factory = createSimManagerFactory(() => delegate, hub)
    const manager = factory({ registry })
    expect(manager.stateOf('sim-2').open).toBe(false)
  })
})

describe('模拟顾客页服务', () => {
  const servers: SimServer[] = []

  afterEach(async () => {
    for (const server of servers) await server.dispose()
    servers.length = 0
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  async function startServer() {
    const hub = new SimHub({ file: tempFile(), now: () => Date.now() })
    hub.attach('sim-1', '演示模拟店')
    const server = createSimServer({
      hub,
      listStores: () => [{ storeId: 'sim-1', storeName: '演示模拟店' }],
      ensureStore: () => true,
      ports: [0],
    })
    servers.push(server)
    const status = await server.start()
    expect(status.running).toBe(true)
    const token = new URL(status.url).searchParams.get('token') ?? ''
    expect(token.length).toBeGreaterThan(10)
    return { hub, server, status, token }
  }

  it('只监听回环地址，未带口令的页面与接口都拒绝', async () => {
    const { server, status } = await startServer()
    expect(status.url.startsWith('http://127.0.0.1:')).toBe(true)
    const page = await request(status.port, '/')
    expect(page.status).toBe(403)
    // 拒绝页要能被人看懂：是 HTML 说明页，而不是一行纯文本或空白；也不要回显对方给的口令。
    expect(page.contentType).toContain('text/html')
    expect(page.body).toContain('模拟顾客页打不开')
    expect(page.body).toContain('打开模拟顾客页')
    const guess = await request(status.port, '/?token=leak-me')
    expect(guess.status).toBe(403)
    expect(guess.body).not.toContain('leak-me')
    const api = await request(status.port, '/api/stores')
    expect(api.status).toBe(401)
    const wrong = await request(status.port, `/api/stores?token=${'x'.repeat(32)}`)
    expect(wrong.status).toBe(401)
    expect(server.status().port).toBe(status.port)
  })

  it('带口令时返回顾客模拟页与店铺列表，健康检查如实可用', async () => {
    const { status, token } = await startServer()
    const page = await request(status.port, `/?token=${token}`)
    expect(page.status).toBe(200)
    expect(page.contentType).toContain('text/html')
    const health = await request(status.port, `/api/health?token=${token}`)
    expect(health.status).toBe(200)
    expect(JSON.parse(health.body).running).toBe(true)
    const stores = await request(status.port, `/api/stores?token=${token}`)
    expect(JSON.parse(stores.body).stores).toEqual([{ storeId: 'sim-1', storeName: '演示模拟店' }])
  })

  it('顾客资料可增改删，状态里带最后一条消息与待回复条数', async () => {
    const { status, token } = await startServer()
    const created = await request(status.port, `/api/persona?token=${token}`, {
      method: 'POST',
      body: { storeId: 'sim-1', name: '顾客乙', note: '问物流' },
    })
    expect(created.status).toBe(200)
    const persona = JSON.parse(created.body).persona
    expect(persona.name).toBe('顾客乙')
    expect(persona.unread).toBe(0)

    const renamed = await request(status.port, `/api/persona?token=${token}`, {
      method: 'PATCH',
      body: { storeId: 'sim-1', uid: persona.uid, name: '顾客乙改名' },
    })
    expect(JSON.parse(renamed.body).persona.name).toBe('顾客乙改名')

    await request(status.port, `/api/send?token=${token}`, {
      method: 'POST',
      body: { storeId: 'sim-1', uid: persona.uid, text: '发顺丰吗', as: 'buyer' },
    })
    const state = await request(status.port, `/api/state?token=${token}&storeId=sim-1`)
    const listed = JSON.parse(state.body).personas.find(
      (item: { uid: string }) => item.uid === persona.uid,
    )
    expect(listed.lastMessage).toBe('发顺丰吗')
    expect(listed.unread).toBe(1)

    const removed = await request(status.port, `/api/persona?token=${token}`, {
      method: 'DELETE',
      body: { storeId: 'sim-1', uid: persona.uid },
    })
    expect(removed.status).toBe(200)
    const thread = await request(
      status.port,
      `/api/thread?token=${token}&storeId=sim-1&uid=${persona.uid}`,
    )
    expect(thread.status).toBe(400)
    expect(JSON.parse(thread.body).message).toBe('顾客不存在或已被删除')
  })

  it('只允许顾客身份发言，未知店铺与越权参数如实拒绝', async () => {
    const { hub, status, token } = await startServer()
    const uid = hub.personas('sim-1')[0]!.uid
    const asSeller = await request(status.port, `/api/send?token=${token}`, {
      method: 'POST',
      body: { storeId: 'sim-1', uid, text: '客服回复', as: 'seller' },
    })
    expect(asSeller.status).toBe(400)
    expect(JSON.parse(asSeller.body).message).toContain('只能以顾客身份发言')

    const unknown = await request(status.port, `/api/state?token=${token}&storeId=other`)
    expect(unknown.status).toBe(404)
    expect(JSON.parse(unknown.body).message).toBe('该店铺不是本机模拟店铺')

    const empty = await request(status.port, `/api/send?token=${token}`, {
      method: 'POST',
      body: { storeId: 'sim-1', uid, text: '   ' },
    })
    expect(empty.status).toBe(400)
    expect(JSON.parse(empty.body).message).toBe('消息内容不能为空')

    const wrongMethod = await request(status.port, `/api/persona?token=${token}`, { method: 'GET' })
    expect(wrongMethod.status).toBe(405)
  })

  it('顾客页直接打开时也会看到默认顾客（不依赖先前打开店铺）', async () => {
    // 真实流程里顾客页允许在店铺关闭后继续加载，所以 /api/state 必须自己把店铺接上并生成默认顾客；
    // 否则页面会显示“还没有顾客”，让用户以为必须先去桌面端开一次店铺。
    const hub = new SimHub({ file: tempFile(), now: () => Date.now() })
    const server = createSimServer({
      hub,
      listStores: () => [{ storeId: 'sim-1', storeName: '演示模拟店' }],
      ensureStore: (storeId: string) => {
        if (!hub.isOpen(storeId)) hub.attach(storeId, '演示模拟店')
        return true
      },
      ports: [0],
    })
    servers.push(server)
    const status = await server.start()
    const token = new URL(status.url).searchParams.get('token') ?? ''
    const state = await request(status.port, `/api/state?token=${token}&storeId=sim-1`)
    expect(state.status).toBe(200)
    const personas = JSON.parse(state.body).personas as { name: string }[]
    expect(personas.map((persona) => persona.name)).toEqual(['小雨', '阿哲', '陈女士'])
  })

  it('店铺打开后买家消息可被采集，店内顾客列表与中枢一致', async () => {
    const { hub, status, token } = await startServer()
    const uid = hub.personas('sim-1')[0]!.uid
    const sent = await request(status.port, `/api/send?token=${token}`, {
      method: 'POST',
      body: { storeId: 'sim-1', uid, text: '请问今天能发货吗' },
    })
    expect(sent.status).toBe(200)
    const drained = hub.drainEvents('sim-1', 0)
    expect(drained.events.at(-1)?.content).toBe('请问今天能发货吗')
    const thread = await request(status.port, `/api/thread?token=${token}&storeId=sim-1&uid=${uid}`)
    expect(JSON.parse(thread.body).messages).toHaveLength(1)
    expect(simStoresOf(hub)).toEqual([{ storeId: 'sim-1', storeName: '演示模拟店' }])
  })
})
