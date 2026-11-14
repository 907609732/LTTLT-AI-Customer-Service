import { describe, it, expect } from 'vitest'
import {
  createPddOperationsProvider,
  buildPddOperationsReadScript,
  loadPddOperationMedia,
} from '../electron/pdd-operations-provider'
import type {
  AutomationAction,
  PreparedPlatformOperation,
} from '../src/shared/contracts/platform-operations'
const now = Date.parse('2026-11-14T00:00:00Z')
function setup(sharedLock = false) {
  let active = true,
    mallId = 'mall',
    draft = '',
    pageId = 'page',
    uid = 'buyer',
    aiEnabled = false,
    textAck = true,
    acknowledged = true
  let registeredMallId: string | undefined = 'mall'
  const writes: string[] = []
  let nativeAgents: { agentId: string; name: string; online: null; canTransfer: boolean }[] = []
  let transferRequests: { uid: string; id: string; observedAt: number }[] = []
  const reviewMessages = [{ from: 'buyer', content: '你好', media: [] as string[] }]
  const serverMessages = [
    {
      id: 'server-old',
      uid: 'buyer',
      from: 'seller',
      type: 'text',
      content: '以前回复',
      ts: now - 10000,
      acknowledged: true,
      senderId: 'service-account',
      senderMallId: 'mall',
    },
  ]
  const bytes = Buffer.from('fixture image bytes')
  let mediaEcho = 'correct'
  let senderId = 'service-account'
  let ownSenderId = 'service-account'
  let sourceChanged = false
  const wc = {
    id: 10,
    getURL: () => 'https://mms.pinduoduo.com/chat-merchant/index.html#/',
    isDestroyed: () => false,
    executeJavaScript: async (script: string) => {
      if (script.startsWith('/*lingtu-pdd-video*/')) {
        const input = JSON.parse(script.slice(script.lastIndexOf(')(') + 2, -1)) as {
          mode: string
          url?: string
        }
        if (input.mode === 'read')
          return {
            status: 'ready',
            pageId,
            assets: [
              {
                id: 'audited',
                name: '已审核视频',
                url: 'https://cdn.example.com/source.mp4',
                sizeBytes: bytes.length,
                extension: 'mp4',
                checkStatus: 2,
              },
            ],
          }
        if (input.mode === 'prepare')
          return input.url === 'https://cdn.example.com/source.mp4'
            ? {
                status: 'ready',
                pageId,
                proof: 'opaque-library-proof',
                label: '发送已审核视频「已审核视频」',
              }
            : { status: 'blocked', pageId, reason: '不是平台已审核素材' }
        if (input.mode === 'execute') {
          writes.push('native-library-video')
          if (mediaEcho !== 'none')
            serverMessages.push({
              id: 'video-server-ack',
              uid: 'buyer',
              from: 'seller',
              type: 'video',
              content: 'https://cdn.example.com/echo.mp4',
              ts: now,
              acknowledged: true,
              senderId,
              senderMallId: 'mall',
            })
          return { status: 'started', attempted: true, accepted: true }
        }
        return { status: 'cancelled' }
      }
      if (script.startsWith('/*lingtu-pdd-native*/')) {
        const input = JSON.parse(script.slice(script.lastIndexOf(')(') + 2, -1)) as { mode: string }
        if (input.mode === 'snapshot') return { visitors: [], orders: [], transferRequests }
        if (input.mode === 'read-transfer') return { status: 'ready', agents: nativeAgents }
        return { status: 'blocked', reason: '当前没有原生订单或客服样本' }
      }
      if (script.startsWith('/*lingtu-pdd-operations:read*/'))
        return {
          hookReady: true,
          pageId,
          activeUid: uid,
          sellerIdentity: {
            accountId: 'service-account',
            mallId: 'mall',
            senderId: ownSenderId,
          },
          buyers: [{ uid: 'buyer', name: '真实买家' }],
          composer: { present: true, empty: !draft },
          mediaInputs: { image: true, video: true },
          serverMessages: structuredClone(serverMessages).map((message) => ({
            ...message,
            acknowledged,
          })),
        }
      if (script.startsWith('/*lingtu-pdd-operations:upload*/')) {
        writes.push('media-change')
        if (mediaEcho !== 'none')
          serverMessages.push({
            id: 'server-new',
            uid: mediaEcho === 'wrong-buyer' ? 'other' : 'buyer',
            from: mediaEcho === 'buyer' ? 'buyer' : 'seller',
            type: mediaEcho === 'native-media' ? 'media' : 'image',
            content:
              mediaEcho === 'wrong-content'
                ? 'https://cdn.example.com/wrong.png'
                : 'https://cdn.example.com/correct.png',
            ts: now,
            acknowledged: true,
            senderId,
            senderMallId: 'mall',
          })
        return { attempted: true }
      }
      throw Error('unexpected script')
    },
  }
  const adapter = {
    _wc: () => wc,
    readIdentity: async () => ({
      authenticated: true,
      mallId,
      storeName: '真实店铺',
      customerServiceId: 'service-account',
    }),
    pendingSnapshot: async () => ({ ok: true, count: 0, uids: [] }),
    focusConversation: async (target: string) => ({ ok: target === uid }),
    reviewHistory: async () => ({
      known: true,
      uid,
      page: pageId,
      messages: structuredClone(reviewMessages.slice(-100)),
    }),
    _callHook: async (method: string) => (method === 'pendingSnapshot' ? {} : undefined),
    sendText: async (target: string, text: string, options: { isCurrent(): boolean }) => {
      if (!options.isCurrent()) return { ok: false, reason: 'cancelled' }
      writes.push(`text:${target}:${text}`)
      reviewMessages.push({ from: 'seller', content: text, media: [] })
      if (textAck)
        serverMessages.push({
          id: 'text-server-ack',
          uid: target,
          from: 'seller',
          type: 'text',
          content: text,
          ts: now,
          acknowledged: true,
          senderId,
          senderMallId: 'mall',
        })
      return { ok: true, msgId: 'ui-text', method: 'dom-click' }
    },
  }
  const provider = createPddOperationsProvider({
    workspaceId: 'w',
    accountId: 'managed-user',
    getAdapter: () => adapter,
    getStore: () => ({
      id: 's',
      name: '真实店铺',
      platform: 'pdd-web',
      aiEnabled,
      mallId: registeredMallId,
    }),
    assertActive: () => {
      if (!active) throw Error('店铺已停用')
    },
    now: () => now,
    confirmationTimeoutMs: 2,
    ...(sharedLock
      ? { withExclusive: async <T>(_storeId: string, job: () => Promise<T>): Promise<T> => job() }
      : {}),
    loadMedia: async (url: string) => ({
      bytes:
        url.includes('wrong') || (sourceChanged && url.endsWith('source.mp4'))
          ? Buffer.from('different content')
          : bytes,
      mimeType: url.endsWith('.mp4') ? 'video/mp4' : 'image/png',
    }),
  })
  const prepare = async (
    action: AutomationAction = { kind: 'welcome-text', text: '批准的最终内容' },
  ) => {
    const result = await provider.prepare({
      workspaceId: 'w',
      runId: 'run',
      storeId: 's',
      uid: 'buyer',
      action,
    })
    expect(result.status).toBe('ready')
    return (result as { status: 'ready'; prepared: PreparedPlatformOperation }).prepared
  }
  return {
    provider,
    adapter,
    wc,
    writes,
    prepare,
    setAi: (value: boolean) => {
      aiEnabled = value
    },
    setNativeAgents: (value: typeof nativeAgents) => {
      nativeAgents = value
    },
    setTransferRequests: (value: typeof transferRequests) => {
      transferRequests = value
    },
    setRegisteredMall: (value: string | undefined) => {
      registeredMallId = value
    },
    setAck: (value: boolean) => {
      acknowledged = value
    },
    setTextAck: (value: boolean) => {
      textAck = value
    },
    setSender: (value: string) => {
      senderId = value
    },
    setOwnSender: (value: string) => {
      ownSenderId = value
    },
    setActive: (value: boolean) => {
      active = value
    },
    setMall: (value: string) => {
      mallId = value
    },
    setDraft: (value: string) => {
      draft = value
    },
    setPage: (value: string) => {
      pageId = value
    },
    setUid: (value: string) => {
      uid = value
    },
    newMessage: () => {
      reviewMessages.push({ from: 'buyer', content: '新消息', media: [] })
    },
    mediaEcho: (value: string) => {
      mediaEcho = value
    },
    changeSource: () => {
      sourceChanged = true
    },
  }
}
describe('拼多多受控操作真实适配边界', () => {
  it('同账号下原生客服发者身份变化也使批准失效，未调用发送器', async () => {
    const f = setup(),
      prepared = await f.prepare()
    f.setOwnSender('different-current-cs-uid')
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toEqual([])
  })
  it.each(['other-staff', ''])(
    '异客服或未知发者%s的同内容文字与媒体回显不能确认',
    async (sender) => {
      for (const kind of ['welcome-text', 'welcome-image', 'welcome-video'] as const) {
        const f = setup(),
          action: AutomationAction =
            kind === 'welcome-text'
              ? { kind, text: '准确最终文字' }
              : {
                  kind,
                  url: `https://cdn.example.com/source.${kind === 'welcome-image' ? 'png' : 'mp4'}`,
                }
        const prepared = await f.prepare(action)
        f.setSender(sender)
        expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe(
          'uncertain',
        )
        expect(f.writes).toHaveLength(1)
      }
    },
  )
  it('乐观文字回显没有卖家服务器消息ID时保持待核对', async () => {
    const f = setup(),
      prepared = await f.prepare()
    f.setTextAck(false)
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('uncertain')
    expect(f.writes).toHaveLength(1)
  })
  it('名单可用不是转接请求；仅实际新鲜买家人工请求生成事件', async () => {
    const f = setup()
    f.setNativeAgents([{ agentId: 'native', name: '可转接客服', online: null, canTransfer: true }])
    await f.provider.read({ workspaceId: 'w', storeId: 's' })
    expect(await f.provider.observe({ workspaceId: 'w', storeId: 's' })).toEqual([])
    f.setTransferRequests([{ uid: 'buyer', id: 'human-request', observedAt: now }])
    expect(await f.provider.observe({ workspaceId: 'w', storeId: 's' })).toMatchObject([
      {
        type: 'transfer-request',
        id: 'human-request',
        uid: 'buyer',
        availableAgentIds: ['native'],
      },
    ])
    expect(f.writes).toEqual([])
  })
  it('有完整共同写锁时AI接待可继续，仍只在逐项批准后发送', async () => {
    const f = setup(true)
    f.setAi(true)
    const prepared = await f.prepare()
    expect(f.writes).toEqual([])
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('confirmed')
    expect(f.writes).toEqual(['text:buyer:批准的最终内容'])
  })
  it.each(['different-mall', undefined])(
    '注册店铺mallId为%s时拒绝读取和准备其他身份',
    async (registered) => {
      const f = setup()
      f.setRegisteredMall(registered)
      await expect(f.provider.read({ workspaceId: 'w', storeId: 's' })).rejects.toThrow()
      expect(
        (
          await f.provider.prepare({
            workspaceId: 'w',
            storeId: 's',
            runId: 'foreign',
            uid: 'buyer',
            action: { kind: 'welcome-text', text: '不能发给其他店铺' },
          })
        ).status,
      ).toBe('blocked')
      expect(f.writes).toEqual([])
    },
  )
  it('注册mallId在批准后变化使原事项失效，不借用页面实际身份发送', async () => {
    const f = setup(),
      prepared = await f.prepare()
    f.setRegisteredMall('replaced-mall')
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toEqual([])
  })
  it('读取真实平台会话和能力，空pending绝不生成无消息访客', async () => {
    const f = setup(),
      facts = await f.provider.read({ workspaceId: 'w', storeId: 's' })
    expect(facts.buyers).toEqual([{ uid: 'buyer', name: '真实买家' }])
    expect(facts.capabilities.find((row) => row.kind === 'welcome-text')?.available).toBe(true)
    expect(await f.provider.observe({ workspaceId: 'w', storeId: 's' })).toEqual([])
    expect(f.writes).toEqual([])
  })
  it('文字使用现有DOM适配器，批准前零写，发送后核对同一买家准确新增卖家内容', async () => {
    const f = setup(),
      prepared = await f.prepare()
    expect(f.writes).toEqual([])
    expect(await f.provider.revalidate(prepared)).toEqual({ status: 'valid' })
    const result = await f.provider.execute(prepared, { isCurrent: () => true })
    expect(result.status).toBe('confirmed')
    expect(result.evidence).toBeDefined()
    expect(f.writes).toEqual(['text:buyer:批准的最终内容'])
  })
  it('网页消息达到100条窗口时仍能核对唯一新增的准确文字', async () => {
    const f = setup()
    for (let index = 0; index < 99; index++) f.newMessage()
    const prepared = await f.prepare()
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('confirmed')
    expect(f.writes).toEqual(['text:buyer:批准的最终内容'])
  })
  it.each(['new-message', 'mall', 'draft', 'page', 'uid', 'stopped'])(
    '变化%s在写入前拦截',
    async (change) => {
      const f = setup(),
        prepared = await f.prepare()
      if (change === 'new-message') f.newMessage()
      if (change === 'mall') f.setMall('other-mall')
      if (change === 'draft') f.setDraft('人工草稿')
      if (change === 'page') f.setPage('other-page')
      if (change === 'uid') f.setUid('other')
      if (change === 'stopped') f.setActive(false)
      expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
      expect(f.writes).toEqual([])
    },
  )
  it('媒体只触发一次原生文件change，并以同uid卖家服务器消息和相同资源指纹确认', async () => {
    const f = setup(),
      prepared = await f.prepare({
        kind: 'welcome-image',
        url: 'https://cdn.example.com/source.png',
      })
    expect(prepared.media).toMatchObject({ mimeType: 'image/png', sizeBytes: 19 })
    expect(f.writes).toEqual([])
    const result = await f.provider.execute(prepared, { isCurrent: () => true })
    expect(result.status).toBe('confirmed')
    expect(f.writes).toEqual(['media-change'])
    expect(result.evidence?.id).toBe('server-new')
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toHaveLength(1)
  })
  it('真实已审核视频来自平台素材库，批准后仅调用原生素材发送并核对type14服务器回显', async () => {
    const f = setup()
    const facts = await f.provider.read({ workspaceId: 'w', storeId: 's' })
    expect(facts.mediaAssets).toEqual([
      {
        id: 'audited',
        name: '已审核视频',
        kind: 'video',
        url: 'https://cdn.example.com/source.mp4',
        sizeBytes: 19,
      },
    ])
    const prepared = await f.prepare({
      kind: 'welcome-video',
      url: 'https://cdn.example.com/source.mp4',
    })
    expect(f.writes).toEqual([])
    expect(prepared.operationLabel).toContain('已审核视频')
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('confirmed')
    expect(f.writes).toEqual(['native-library-video'])
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toHaveLength(1)
  })
  it('视频原生callback只有接受请求，没有卖家服务器回显则待核对不重发', async () => {
    const f = setup()
    f.mediaEcho('none')
    const prepared = await f.prepare({
      kind: 'welcome-video',
      url: 'https://cdn.example.com/source.mp4',
    })
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('uncertain')
    expect(f.writes).toEqual(['native-library-video'])
  })
  it('平台素材URL内容在批准后变化，执行前失效而不发送', async () => {
    const f = setup()
    const prepared = await f.prepare({
      kind: 'welcome-video',
      url: 'https://cdn.example.com/source.mp4',
    })
    f.changeSource()
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toEqual([])
  })
  it.each(['wrong-buyer', 'buyer', 'wrong-content', 'none'])(
    '媒体回显%s不冒充成功，也不重发',
    async (echo) => {
      const f = setup()
      f.mediaEcho(echo)
      const prepared = await f.prepare({
        kind: 'welcome-image',
        url: 'https://cdn.example.com/source.png',
      })
      expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe(
        'uncertain',
      )
      expect(f.writes).toEqual(['media-change'])
    },
  )
  it('没有真实原生催支付对象或在线客服名单时不会改成聊天文字或伪造ID', async () => {
    const f = setup()
    expect(
      (
        await f.provider.prepare({
          workspaceId: 'w',
          runId: 'pay',
          storeId: 's',
          uid: 'buyer',
          action: { kind: 'payment-reminder', orderId: 'invented', text: '不能冒充聊天催付' },
        })
      ).status,
    ).toBe('blocked')
    expect(
      (
        await f.provider.prepare({
          workspaceId: 'w',
          runId: 'transfer',
          storeId: 's',
          uid: 'buyer',
          action: { kind: 'transfer', agentId: 'invented' },
        })
      ).status,
    ).toBe('blocked')
    expect(f.writes).toEqual([])
  })
  it('跨workspace和伪造prepared不能直接写平台', async () => {
    const f = setup()
    await expect(f.provider.read({ workspaceId: 'foreign', storeId: 's' })).rejects.toThrow(
      /工作区/,
    )
    const prepared = await f.prepare()
    prepared.action = { kind: 'welcome-text', text: '篡改后内容' }
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toEqual([])
  })
  it('未经服务器明确确认的乐观媒体消息不能成为可发送证据', async () => {
    const f = setup()
    f.setAck(false)
    const prepared = await f.provider.prepare({
      workspaceId: 'w',
      runId: 'unacked',
      storeId: 's',
      uid: 'buyer',
      action: { kind: 'welcome-image', url: 'https://cdn.example.com/source.png' },
    })
    expect(prepared.status).toBe('blocked')
    expect(f.writes).toEqual([])
  })
  it('AI开启时先要求用户暂停，准备后重新开启也阻止写入', async () => {
    const f = setup()
    f.setAi(true)
    expect(
      (
        await f.provider.prepare({
          workspaceId: 'w',
          runId: 'ai',
          storeId: 's',
          uid: 'buyer',
          action: { kind: 'welcome-text', text: '批准内容' },
        })
      ).status,
    ).toBe('blocked')
    f.setAi(false)
    const prepared = await f.prepare()
    f.setAi(true)
    expect((await f.provider.execute(prepared, { isCurrent: () => true })).status).toBe('failed')
    expect(f.writes).toEqual([])
  })
  it.each([
    'https://127.0.0.1/private.png',
    'https://10.0.0.1/private.png',
    'https://[::1]/private.png',
    'https://user:secret@example.com/a.png',
    'http://example.com/a.png',
  ])('媒体下载拒绝私网或带凭据地址%s', async (url) => {
    await expect(loadPddOperationMedia(url, 'welcome-image')).rejects.toThrow()
  })
})

describe('拼多多只读页面投影', () => {
  it('仅返回当前买家明确服务器确认的卖家媒体，不把临时ID和其他买家资源当ack', () => {
    document.body.innerHTML =
      '<div id="app"></div><textarea id="replyTextarea"></textarea><input type="file" accept="image/*" />'
    const app = document.querySelector('#app')!
    const rows = [
      {
        msg_id: 'server-1',
        from: { role: 'mall' },
        to: { uid: 'buyer' },
        content: { url: 'https://example.com/image.png' },
        type: 1,
        status: 'success',
      },
      {
        msg_id: 'ui-temporary',
        from: { role: 'mall' },
        to: { uid: 'buyer' },
        content: 'https://example.com/temporary.png',
        type: 1,
        status: 'success',
      },
      {
        msg_id: 'unacknowledged',
        from: { role: 'mall' },
        to: { uid: 'buyer' },
        content: 'https://example.com/pending.png',
        type: 1,
      },
      {
        msg_id: 'other-buyer',
        from: { role: 'mall' },
        to: { uid: 'other' },
        content: 'https://example.com/wrong.png',
        type: 1,
        status: 'success',
      },
      {
        msg_id: 'native-type14',
        from: { role: 'mall_cs' },
        to: { uid: 'buyer' },
        content: 'https://example.com/original-resource',
        type: 14,
        status: 'read',
      },
    ]
    Object.assign(app, {
      __vue__: {
        $store: {
          state: {
            todayChatList: [
              { userInfo: { uid: 'buyer', nickname: '实际买家' }, messageList: rows },
            ],
          },
        },
      },
    })
    Object.defineProperty(window, '__pddWeb', {
      configurable: true,
      value: {
        currentUid: () => 'buyer',
        reviewHistory: () => ({ page: 'real-page' }),
        prepareNativeTextSend: () => {},
      },
    })
    try {
      const page = Function(`return (${buildPddOperationsReadScript()})`)() as {
        buyers: { uid: string }[]
        serverMessages: { id: string; type: string }[]
      }
      expect(page.buyers).toEqual([{ uid: 'buyer', name: '实际买家' }])
      expect(page.serverMessages.map((message) => message.id)).toEqual([
        'server-1',
        'native-type14',
      ])
      expect(page.serverMessages.find((message) => message.id === 'native-type14')?.type).toBe(
        'video',
      )
    } finally {
      Reflect.deleteProperty(window, '__pddWeb')
      document.body.innerHTML = ''
    }
  })
})
