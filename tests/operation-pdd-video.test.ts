import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPddVideoScript, type PddVideoScriptInput } from '../electron/pdd-native-video'

const mediaUrl = 'https://example.com/approved.mp4'
const asset = () => ({
  id: 17,
  name: '已审核欢迎视频',
  url: mediaUrl,
  size: 12345,
  extension: 'mp4',
  check_status: 2,
  file_type: 'video',
  is_deleted: false,
  extra_info: { duration: 4, video_cover_url: 'https://example.com/cover.jpg' },
})
type NativeAsset = ReturnType<typeof asset> & { info?: { status: number } }
interface Result {
  status: string
  proof?: string
  pageId?: string
  assets?: { id?: string; name?: string; url: string; sizeBytes: number }[]
  attempted?: boolean
  accepted?: boolean
}
function environment() {
  document.body.innerHTML =
    '<div id="app"></div><div class="middle-panel"></div><textarea id="replyTextarea"></textarea>'
  const seller = { id: 'staff', mall_id: 'mall', cs_uid: 'staff-uid' }
  Object.assign(document.querySelector('#app')!, {
    __vue__: { $store: { state: { userInfo: seller } } },
  })
  let uid = 'buyer'
  let pageId = 'page'
  let messages = [{ from: 'buyer', content: '请介绍产品', media: [] as string[] }]
  let rows: NativeAsset[] = [asset()]
  let nextRows: NativeAsset[] = [asset()]
  let fresh = true
  let respond = true
  let throwAfterAttempt = false
  let reads = 0
  const writes: NativeAsset[] = []
  const callbacks: (() => void)[] = []
  const watchers = new Set<(value: unknown, previous: unknown) => void>()
  const vm = {
    $options: { name: 'middlePanel' },
    currentUid: 'buyer',
    videoList: rows,
    $watch: (_expression: string, callback: (value: unknown, previous: unknown) => void) => {
      watchers.add(callback)
      return () => watchers.delete(callback)
    },
    queryVideoList: () => {
      reads++
      if (fresh)
        queueMicrotask(() => {
          const previous = rows
          rows = [...nextRows]
          vm.videoList = rows
          for (const watcher of [...watchers]) watcher(rows, previous)
        })
    },
    sendVideo: (item: NativeAsset, callback: () => void) => {
      writes.push(item)
      callbacks.push(callback)
      if (throwAfterAttempt) throw Error('Native transport failed after dispatch')
      if (respond) queueMicrotask(callback)
    },
  }
  Object.assign(document.querySelector('.middle-panel')!, { __vue__: vm })
  Object.defineProperty(window, '__pddWeb', {
    configurable: true,
    value: {
      currentUid: () => uid,
      reviewHistory: () => ({ known: true, uid, page: pageId, messages }),
    },
  })
  const evaluate = (input: PddVideoScriptInput): Promise<Result> =>
    Promise.resolve(
      runInNewContext(buildPddVideoScript({ timeoutMs: 25, ...input }), {
        window,
        document,
        crypto: webcrypto,
        setTimeout,
        clearTimeout,
        URL,
      }) as Result,
    )
  const prepare = (overrides: Partial<PddVideoScriptInput> = {}) =>
    evaluate({
      mode: 'prepare',
      runId: 'run',
      uid: 'buyer',
      pageId: 'page',
      url: mediaUrl,
      expiresAt: Date.now() + 60_000,
      ...overrides,
    })
  const execute = (proof: string | undefined, overrides: Partial<PddVideoScriptInput> = {}) =>
    evaluate({
      mode: 'execute',
      runId: 'run',
      uid: 'buyer',
      pageId: 'page',
      url: mediaUrl,
      proof,
      ...overrides,
    })
  return {
    vm,
    writes,
    callbacks,
    watchers,
    evaluate,
    prepare,
    execute,
    reads: () => reads,
    rows: () => rows,
    fresh: (value: boolean) => {
      fresh = value
    },
    respond: (value: boolean) => {
      respond = value
    },
    failAfterAttempt: () => {
      throwAfterAttempt = true
    },
    resultRows: (value: NativeAsset[]) => {
      nextRows = value
    },
    changeUid: () => {
      uid = 'other'
      vm.currentUid = 'other'
    },
    changePage: () => {
      pageId = 'other-page'
    },
    newMessage: () => {
      messages = [...messages, { from: 'buyer', content: '等等', media: [] }]
    },
    changeSeller: () => {
      seller.id = 'other-staff'
    },
  }
}
afterEach(() => {
  Reflect.deleteProperty(window, '__pddWeb')
  Reflect.deleteProperty(window, '__lingtuPddVideoState')
  document.body.innerHTML = ''
})

describe('拼多多已审核原生视频', () => {
  it('相同买家、页面及消息仍不能在平台卖家身份切换后复用视频批准', async () => {
    const f = environment(),
      prepared = await f.prepare()
    expect(prepared.status).toBe('ready')
    f.changeSeller()
    expect((await f.execute(prepared.proof)).attempted).toBe(false)
    expect(f.writes).toEqual([])
  })
  it('等待原生查询的新数组，仅返回审核通过的视频DTO并释放watch', async () => {
    const f = environment()
    f.resultRows([
      asset(),
      { ...asset(), url: 'https://example.com/rejected.mp4', check_status: 1 },
    ])
    expect(await f.evaluate({ mode: 'read' })).toMatchObject({
      status: 'ready',
      pageId: 'page',
      assets: [{ id: '17', name: '已审核欢迎视频', url: mediaUrl, sizeBytes: 12345 }],
    })
    expect(f.reads()).toBe(1)
    expect(f.watchers.size).toBe(0)
    expect(f.writes).toEqual([])
  })

  it('查询未产生新数组时，旧缓存不能冒充读取或准备成功', async () => {
    const f = environment()
    f.fresh(false)
    expect((await f.evaluate({ mode: 'read' })).status).toBe('blocked')
    expect((await f.prepare()).status).toBe('blocked')
    expect(f.watchers.size).toBe(0)
    expect(f.writes).toEqual([])
  })

  it.each([
    ['未审核', { check_status: 1 }],
    ['文件', { file_type: 'file' }],
    ['已删除', { is_deleted: true }],
    ['达到300MiB', { size: 314572800 }],
    ['被封禁', { info: { status: 1 } }],
  ])('%s素材不能准备发送', async (_label, changed) => {
    const f = environment()
    f.resultRows([{ ...asset(), ...changed }])
    expect((await f.prepare()).status).toBe('blocked')
    expect(f.writes).toEqual([])
  })

  it('重复URL或未入库的URL无法准备', async () => {
    const f = environment()
    f.resultRows([asset(), { ...asset(), id: 18 }])
    expect((await f.prepare()).status).toBe('blocked')
    f.resultRows([asset()])
    expect((await f.prepare({ url: 'https://example.com/arbitrary.mp4' })).status).toBe('blocked')
    expect(f.writes).toEqual([])
  })

  it('准备不发送；回调只代表原生受理，重复执行不再次调用', async () => {
    const f = environment()
    const prepared = await f.prepare()
    expect(prepared).toMatchObject({ status: 'ready', pageId: 'page', proof: expect.any(String) })
    expect(f.writes).toEqual([])
    const result = await f.execute(prepared.proof)
    expect(result).toMatchObject({ status: 'started', attempted: true, accepted: true })
    expect(result.status).not.toBe('confirmed')
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toBe(f.rows()[0])
    expect((await f.execute(prepared.proof)).status).toBe('uncertain')
    expect(f.writes).toHaveLength(1)
  })

  it('相同审批的再次准备必须重新读取且保持相同proof', async () => {
    const f = environment()
    const prepared = await f.prepare()
    expect((await f.prepare({ proof: prepared.proof })).proof).toBe(prepared.proof)
    expect(f.reads()).toBe(2)
    expect(f.writes).toEqual([])
  })

  it.each(['uid', 'page', 'message', 'asset', 'draft', 'proof', 'expiry', 'destroyed'])(
    '%s变化使批准失效且零调用',
    async (change) => {
      const f = environment()
      const prepared = await f.prepare()
      if (change === 'uid') f.changeUid()
      if (change === 'page') f.changePage()
      if (change === 'message') f.newMessage()
      if (change === 'asset') f.rows()[0].check_status = 1
      if (change === 'destroyed') Object.assign(f.vm, { $isDestroyed: true })
      if (change === 'draft') document.querySelector('textarea')!.value = '人工草稿'
      const result = await f.execute(
        change === 'proof' ? 'forged' : prepared.proof,
        change === 'expiry' ? { expiresAt: Date.now() - 1 } : {},
      )
      expect(result).toMatchObject({ status: 'failure', attempted: false, accepted: false })
      expect(f.writes).toEqual([])
    },
  )

  it('取消审批阻止执行和再次准备', async () => {
    const f = environment()
    const prepared = await f.prepare()
    expect((await f.evaluate({ mode: 'cancel', runId: 'run' })).status).toBe('cancelled')
    expect(await f.execute(prepared.proof)).toMatchObject({ status: 'failure', attempted: false })
    expect((await f.prepare()).status).toBe('blocked')
    expect(f.writes).toEqual([])
  })

  it('查询尚未完成时取消，晚到的库结果不能产生批准', async () => {
    const f = environment()
    f.fresh(false)
    const preparing = f.prepare()
    await f.evaluate({ mode: 'cancel', runId: 'run' })
    expect((await preparing).status).toBe('blocked')
    expect(f.watchers.size).toBe(0)
    expect(f.writes).toEqual([])
  })

  it.each(['missing-callback', 'throw-after-attempt'])(
    '%s仍为不确定，不能再次调用',
    async (failure) => {
      const f = environment()
      f.respond(false)
      if (failure === 'throw-after-attempt') f.failAfterAttempt()
      const prepared = await f.prepare()
      expect(await f.execute(prepared.proof)).toMatchObject({
        status: 'uncertain',
        attempted: true,
        accepted: false,
      })
      expect(f.writes).toHaveLength(1)
      expect((await f.execute(prepared.proof)).status).toBe('uncertain')
      expect(f.writes).toHaveLength(1)
    },
  )

  it('原生调用已开始后取消，晚到回调不能变成批准或送达', async () => {
    const f = environment()
    f.respond(false)
    const prepared = await f.prepare()
    const executing = f.execute(prepared.proof)
    await f.evaluate({ mode: 'cancel', runId: 'run' })
    f.callbacks[0]?.()
    expect(await executing).toMatchObject({ status: 'uncertain', attempted: true, accepted: false })
    expect(f.writes).toHaveLength(1)
  })
})
