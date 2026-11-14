import { describe, it, expect, afterEach, vi } from 'vitest'
import { createPddOperationsProvider } from '../electron/pdd-operations-provider'
import { ReceptionScheduler } from '../electron/scheduler-runtime'
import { ReceptionOperationExecutor } from '../electron/reception-operation-executor'
import {
  buildPddNativeOperationScript,
  type PddNativeOperationInput,
} from '../electron/pdd-native-operations'
const now = Date.now()
const evaluate = <T>(input: PddNativeOperationInput): Promise<T> =>
  Promise.resolve(Function(`return (${buildPddNativeOperationScript(input)})`)())
function environment() {
  document.body.innerHTML =
    '<div id="app"></div><textarea id="replyTextarea"></textarea><div class="transfer-chat-wrap">转移会话</div>'
  const writes: unknown[] = [],
    reads: unknown[] = []
  const state = {
    userInfo: { id: 'staff', mall_id: 'mall', cs_uid: 'staff' },
    currentUserInfo: {
      userInfo: { uid: 'buyer', nickname: '买家' },
      hasMore: false,
      messageList: [
        {
          type: 41,
          template_name: 'user_source',
          info: { title: '当前用户来自 商品详情页' },
          from: { role: 'user' },
          content: '当前用户来自 商品详情页',
          msg_id: 'entry-1',
          ts: Math.floor(now / 1000),
        },
      ],
    },
    chatList: [],
    transformChatData: null as null | {
      uidList: { uid: string }[]
      csList: Record<string, { id: number; username: string; csName: string }>
      transReason: { code: number; desc: string }[]
    },
  }
  let responseId = 'request-1',
    result = 'ok',
    availableTypes = [2],
    sentTypes = [2]
  class FakeSocket extends EventTarget {
    send(raw: string) {
      const request = JSON.parse(raw)
      writes.push(request)
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ response: 'move_conversation', request_id: responseId, result }),
          }),
        ),
      )
    }
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  const socket = new FakeSocket()
  const transferVm = {
    $options: { name: 'transferChatModal' },
    $children: [],
    closeTransformDialog: () => {
      state.transformChatData = null
    },
    transferWithRemark: (agent: string, reason: { code: number; desc: string }, needWx: boolean) =>
      socket.send(
        JSON.stringify({
          cmd: 'move_conversation',
          request_id: 'request-1',
          conversation: { csid: agent, uid: 'buyer', need_wx: needWx, remark: reason.desc },
        }),
      ),
  }
  const orderInfo = {
    orderSn: 'order',
    urgePayAvailable: true,
    collectionAmount: 25,
    orderGoodsList: { goodsName: '真实商品', goodsPrice: 25, goodsNumber: 1 },
    rapidDeliverSent: false,
  }
  const axios = {
    post: async (path: string, values: unknown) => {
      if (path === '/latitude/order/validOrderUrge') {
        reads.push(values)
        return { urgeResults: availableTypes.map((type) => ({ type, available: true })) }
      }
      writes.push({ path, values })
      return { sentTypes }
    },
  }
  const urgeVm = {
    $options: { name: 'UrgeDialog' },
    $children: [],
    currentUid: 'buyer',
    orderInfo,
    visible: true,
    urgeTypes: [2],
    priceUrgeEnable: false,
    shippingUrgeEnable: true,
    privilegeUrgeEnable: false,
    hasNotSignMallProtocol: false,
    firstPrivilegeVisible: false,
    editPrice: { error: false, editPriceInput: 0, discountInput: 10 },
    realAmount: 25,
    expense: 0,
    $axios: axios,
    validData: () => {
      void axios.post('/latitude/order/validOrderUrge', { orderSn: 'order' })
    },
    send: () => {
      void axios
        .post('/latitude/message/sendOrderUrge', {
          orderSn: 'order',
          urgeTypes: urgeVm.urgeTypes,
          goodsDiscount: undefined,
        })
        .catch(() => {})
    },
  }
  const orderScope = {
    $options: { name: 'rightPanel' },
    $children: [urgeVm],
    currentUid: 'buyer',
    requestFetching: false,
    recordRequestList: { url: 'unfinishedOrders' },
    orderItems: [orderInfo],
  }
  Object.assign(urgeVm, { $parent: orderScope })
  const root = { $store: { state }, $children: [transferVm, orderScope] }
  Object.assign(document.querySelector('#app')!, { __vue__: root })
  Object.defineProperty(window, '__pddWeb', {
    configurable: true,
    value: {
      currentUid: () => 'buyer',
      reviewHistory: () => ({
        known: true,
        uid: 'buyer',
        page: 'page',
        messages: [{ from: 'buyer', content: '当前用户来自 商品详情页', media: [] }],
      }),
    },
  })
  document.querySelector('.transfer-chat-wrap')!.addEventListener('click', () => {
    state.transformChatData = {
      uidList: [{ uid: 'buyer' }],
      csList: { 'native-agent': { id: 9, username: '原生客服', csName: '可转接客服' } },
      transReason: [{ code: 10005, desc: '无原因直接转移' }],
    }
  })
  return {
    state,
    writes,
    reads,
    urgeVm,
    orderScope,
    transferVm,
    root,
    setResponse: (id: string, value = 'ok') => {
      responseId = id
      result = value
    },
    setSentTypes: (types: number[]) => {
      sentTypes = types
    },
    setAvailableTypes: (types: number[]) => {
      availableTypes = types
    },
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, '__pddWeb')
  Reflect.deleteProperty(window, '__lingtuPddNativeReceipts')
  document.body.innerHTML = ''
})
describe('原生接待来源与一次操作', () => {
  it.each(['transfer', 'payment'] as const)(
    '原生%s写入瞬间出现新消息，已批准事项也不发送',
    async (kind) => {
      const f = environment(),
        prepared = await evaluate<{ proof: unknown }>({
          mode: kind === 'transfer' ? 'prepare-transfer' : 'prepare-payment',
          uid: 'buyer',
          pageId: 'page',
          agentId: 'native-agent',
          orderId: 'order',
        })
      const change = () =>
        Object.assign(Reflect.get(window, '__pddWeb'), {
          reviewHistory: () => ({
            known: true,
            uid: 'buyer',
            page: 'page',
            messages: [{ from: 'buyer', content: '新消息', media: [] }],
          }),
        })
      if (kind === 'transfer') {
        const original = f.transferVm.transferWithRemark
        f.transferVm.transferWithRemark = (...args) => {
          change()
          return original(...args)
        }
      } else {
        const original = f.urgeVm.send
        f.urgeVm.send = () => {
          change()
          original()
        }
      }
      expect(
        (
          await evaluate<{ status: string }>({
            mode: kind === 'transfer' ? 'execute-transfer' : 'execute-payment',
            runId: 'changed-at-write',
            uid: 'buyer',
            pageId: 'page',
            agentId: 'native-agent',
            orderId: 'order',
            proof: prepared.proof,
            expiresAt: now + 600000,
            timeoutMs: 10,
          })
        ).status,
      ).toBe('failed')
      expect(f.writes).toEqual([])
    },
  )
  it.each([false, true])(
    '图片使用原生审批基线，文件准备期间账号变化=%s时停止',
    async (changeIdentity) => {
      const f = environment(),
        bytes = Buffer.from('fixture image bytes')
      const old = {
        ...f.state.currentUserInfo.messageList[0],
        type: 0,
        from: { role: 'mall_cs', uid: 'mall', cs_uid: 'staff' },
        content: '旧卖家回复',
        msg_id: 'old-server',
      }
      f.state.currentUserInfo.messageList.push(
        Object.assign(old, { to: { role: 'user', uid: 'buyer' }, status: 'read' }),
      )
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/jpeg,image/png'
      Object.defineProperty(input, 'files', { value: null, writable: true })
      document.body.append(input)
      vi.stubGlobal(
        'DataTransfer',
        class {
          files: File[] = []
          items = {
            add: (file: File) => {
              this.files.push(file)
              if (changeIdentity) f.state.userInfo.id = 'different-account'
            },
          }
        },
      )
      Object.assign(document.querySelector('#replyTextarea')!, {
        getBoundingClientRect: () => ({ width: 300, height: 50 }),
      })
      Object.assign(Reflect.get(window, '__pddWeb'), { prepareNativeTextSend: () => {} })
      input.addEventListener('change', () => {
        f.writes.push('image-native-change')
        f.state.currentUserInfo.messageList.push(
          Object.assign(
            {
              ...old,
              type: 1,
              content: 'https://example.com/image.png',
              msg_id: 'actual-image-ack',
            },
            { to: { role: 'user', uid: 'buyer' }, status: 'read' },
          ),
        )
      })
      const wc = {
        id: 1,
        getURL: () => 'https://mms.pinduoduo.com/chat-merchant/index.html#/',
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => Function(`return (${script})`)() as unknown,
      }
      const adapter = {
        _wc: () => wc,
        readIdentity: async () => ({
          authenticated: true,
          mallId: 'mall',
          storeName: '本店',
          customerServiceId: 'staff',
        }),
        focusConversation: async (uid: string) => ({ ok: uid === 'buyer' }),
        reviewHistory: async () => ({ known: true, uid: 'buyer', page: 'page', messages: [] }),
        sendText: async () => {
          throw Error('image must never call text sender')
        },
      }
      const port = createPddOperationsProvider({
        workspaceId: 'w',
        accountId: 'account',
        getStore: () => ({ id: 's', mallId: 'mall', platform: 'pdd-web' }),
        getAdapter: () => adapter,
        assertActive: () => {},
        confirmationTimeoutMs: 10,
        loadMedia: async () => ({ bytes, mimeType: 'image/png' }),
      })
      const prepared = await port.prepare({
        workspaceId: 'w',
        storeId: 's',
        uid: 'buyer',
        runId: 'image-baseline',
        action: { kind: 'welcome-image', url: 'https://example.com/image.png' },
      })
      expect(prepared.status).toBe('ready')
      if (prepared.status !== 'ready') throw Error('missing image preparation')
      expect((await port.execute(prepared.prepared, { isCurrent: () => true })).status).toBe(
        changeIdentity ? 'failed' : 'confirmed',
      )
      expect(f.writes).toEqual(changeIdentity ? [] : ['image-native-change'])
    },
  )
  it('用户先选3再选2仍按相同条款集合发送一次，不因原生数组顺序误拦', async () => {
    const f = environment()
    f.urgeVm.urgeTypes = [3, 2]
    f.urgeVm.privilegeUrgeEnable = true
    f.setAvailableTypes([2, 3])
    f.setSentTypes([3, 2])
    const prepared = await evaluate<{ status: string; proof: unknown }>({
      mode: 'prepare-payment',
      uid: 'buyer',
      pageId: 'page',
      orderId: 'order',
    })
    expect(prepared.status).toBe('ready')
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'execute-payment',
          runId: 'ordered-terms',
          uid: 'buyer',
          pageId: 'page',
          orderId: 'order',
          proof: prepared.proof,
          expiresAt: now + 600000,
          timeoutMs: 10,
        })
      ).status,
    ).toBe('confirmed')
    expect(f.writes).toHaveLength(1)
  })
  it.each([{ sent: [2, 3] }, { sent: [2, 99] }, { sent: [] }])(
    '服务器sentTypes=$sent 与批准集合不同则待核对，不重发',
    async ({ sent }) => {
      const f = environment()
      f.setSentTypes(sent)
      const prepared = await evaluate<{ proof: unknown }>({
        mode: 'prepare-payment',
        uid: 'buyer',
        pageId: 'page',
        orderId: 'order',
      })
      const input: PddNativeOperationInput = {
        mode: 'execute-payment',
        runId: 'ack-terms',
        uid: 'buyer',
        pageId: 'page',
        orderId: 'order',
        proof: prepared.proof,
        expiresAt: now + 600000,
        timeoutMs: 10,
      }
      expect((await evaluate<{ status: string }>(input)).status).toBe('uncertain')
      await evaluate(input)
      expect(f.writes).toHaveLength(1)
    },
  )
  it('真实provider和批准执行器连用，未批准零转接，批准一次后记录服务器证据', async () => {
    const f = environment()
    const wc = {
      id: 1,
      getURL: () => 'https://mms.pinduoduo.com/chat-merchant/index.html#/',
      isDestroyed: () => false,
      executeJavaScript: async (script: string) => Function(`return (${script})`)() as unknown,
    }
    const adapter = {
      _wc: () => wc,
      readIdentity: async () => ({
        authenticated: true,
        mallId: 'mall',
        storeName: '本店',
        customerServiceId: 'staff',
      }),
      focusConversation: async (uid: string) => ({ ok: uid === 'buyer' }),
      reviewHistory: async () => ({
        known: true,
        uid: 'buyer',
        page: 'page',
        messages: [{ from: 'buyer', content: '当前用户来自 商品详情页', media: [] }],
      }),
      sendText: async () => {
        throw Error('transfer must never call text sender')
      },
    }
    const port = createPddOperationsProvider({
      workspaceId: 'w',
      accountId: 'account',
      getStore: () => ({ id: 's', mallId: 'mall', platform: 'pdd-web', aiEnabled: false }),
      getAdapter: () => adapter,
      assertActive: () => {},
      confirmationTimeoutMs: 100,
    })
    const scheduler = new ReceptionScheduler({
      workspaceId: 'w',
      load: () => undefined,
      save: () => {},
      capability: () => '',
    })
    scheduler.enqueueEvent({
      key: 'trusted-human-request',
      ruleId: 'transfer',
      storeId: 's',
      uid: 'buyer',
      actions: [{ kind: 'transfer', agentId: 'native-agent' }],
    })
    const executor = new ReceptionOperationExecutor({ workspaceId: 'w', scheduler, port })
    const id = scheduler.snapshot().runs[0].id
    await executor.prepare(id)
    expect(scheduler.snapshot().runs[0].approvalId).toBeTruthy()
    expect(f.writes).toEqual([])
    await executor.approve({
      workspaceId: 'w',
      id,
      approvalId: scheduler.snapshot().runs[0].approvalId!,
    })
    expect(scheduler.snapshot().runs[0]).toMatchObject({
      state: 'confirmed',
      evidence: { id: 'request-1' },
    })
    expect(f.writes).toHaveLength(1)
  })
  it('原生弹窗按需挂载时重新发现组件，不使用打开前的旧Vue树', async () => {
    const f = environment()
    f.root.$children = f.root.$children.filter((child) => child !== f.transferVm)
    document
      .querySelector('.transfer-chat-wrap')!
      .addEventListener('click', () => queueMicrotask(() => f.root.$children.push(f.transferVm)))
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'prepare-transfer',
          uid: 'buyer',
          pageId: 'page',
          agentId: 'native-agent',
        })
      ).status,
    ).toBe('ready')
    expect(f.writes).toEqual([])
  })
  it('全店待支付列表不能借当前聊天UID冒充订单买家', async () => {
    const f = environment()
    f.orderScope.recordRequestList.url = 'unpaidOrders'
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'prepare-payment',
          uid: 'buyer',
          pageId: 'page',
          orderId: 'order',
        })
      ).status,
    ).toBe('blocked')
    expect(f.writes).toEqual([])
  })
  it('新鲜真实用户文字命中人工关键词才记录转接请求，来源提示不算请求', async () => {
    const f = environment()
    expect(
      (
        await evaluate<{ transferRequests: unknown[] }>({
          mode: 'snapshot',
          transferKeywords: ['转人工'],
        })
      ).transferRequests,
    ).toEqual([])
    f.state.currentUserInfo.messageList.push({
      ...f.state.currentUserInfo.messageList[0],
      type: 0,
      template_name: '',
      content: '请转人工客服',
      msg_id: 'actual-request',
    })
    expect(
      (
        await evaluate<{ transferRequests: { id: string }[] }>({
          mode: 'snapshot',
          transferKeywords: ['转人工'],
        })
      ).transferRequests,
    ).toMatchObject([{ id: 'actual-request' }])
    expect(f.writes).toEqual([])
  })
  it('仅明确type41/user_source、完整历史及0用户消息产生真实访客事件', async () => {
    const f = environment()
    const value = await evaluate<{
      visitors: { uid: string; sessionId: string; observedAt: number }[]
    }>({ mode: 'snapshot' })
    expect(value.visitors).toEqual([
      { uid: 'buyer', sessionId: 'entry-1', observedAt: Math.floor(now / 1000) * 1000 },
    ])
    f.state.currentUserInfo.hasMore = true
    expect((await evaluate<{ visitors: unknown[] }>({ mode: 'snapshot' })).visitors).toEqual([])
    expect(f.writes).toEqual([])
  })
  it('type31机器人提示和真实用户文字/商品卡均不能推断0消息访客', async () => {
    const f = environment()
    Object.assign(f.state.currentUserInfo.messageList[0], {
      type: 31,
      template_name: 'mall_robot_man_intervention_and_restart',
    })
    expect((await evaluate<{ visitors: unknown[] }>({ mode: 'snapshot' })).visitors).toEqual([])
    Object.assign(f.state.currentUserInfo.messageList[0], {
      type: 41,
      template_name: 'user_source',
    })
    f.state.currentUserInfo.messageList.push({
      ...f.state.currentUserInfo.messageList[0],
      type: 5,
      template_name: '',
      msg_id: 'buyer-product-card',
    })
    expect((await evaluate<{ visitors: unknown[] }>({ mode: 'snapshot' })).visitors).toEqual([])
  })
  it('原生可转接名单保留在线未知，准备无写动作', async () => {
    const f = environment()
    const result = await evaluate<{ status: string; agents: unknown[]; proof: unknown }>({
      mode: 'prepare-transfer',
      uid: 'buyer',
      pageId: 'page',
      agentId: 'native-agent',
    })
    expect(result.status).toBe('ready')
    expect(result.agents).toEqual([
      { agentId: 'native-agent', name: '可转接客服', online: null, canTransfer: true },
    ])
    expect(f.writes).toEqual([])
  })
  it('批准后仅调用原生转接一次，并用同socket/request_id/result=ok确认', async () => {
    const f = environment()
    const prepared = await evaluate<{ proof: unknown }>({
      mode: 'prepare-transfer',
      uid: 'buyer',
      pageId: 'page',
      agentId: 'native-agent',
    })
    const input: PddNativeOperationInput = {
      mode: 'execute-transfer',
      runId: 'transfer-run',
      uid: 'buyer',
      pageId: 'page',
      agentId: 'native-agent',
      proof: prepared.proof,
      expiresAt: now + 600000,
      timeoutMs: 10,
    }
    expect((await evaluate<{ status: string }>(input)).status).toBe('confirmed')
    expect(f.writes).toEqual([
      {
        cmd: 'move_conversation',
        request_id: 'request-1',
        conversation: {
          csid: 'native-agent',
          uid: 'buyer',
          need_wx: false,
          remark: '无原因直接转移',
        },
      },
    ])
    await evaluate(input)
    expect(f.writes).toHaveLength(1)
  })
  it('其他request_id的回执不能确认转接，也不能重发', async () => {
    const f = environment()
    f.setResponse('different-request')
    const prepared = await evaluate<{ proof: unknown }>({
      mode: 'prepare-transfer',
      uid: 'buyer',
      pageId: 'page',
      agentId: 'native-agent',
    })
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'execute-transfer',
          runId: 'unknown',
          uid: 'buyer',
          pageId: 'page',
          agentId: 'native-agent',
          proof: prepared.proof,
          expiresAt: now + 600000,
          timeoutMs: 10,
        })
      ).status,
    ).toBe('uncertain')
    expect(f.writes).toHaveLength(1)
  })
  it('催支付读取用户当前原生条款，不默认改价或开通特权，服务器sentTypes才确认', async () => {
    const f = environment()
    const prepared = await evaluate<{ status: string; label: string; proof: unknown }>({
      mode: 'prepare-payment',
      uid: 'buyer',
      pageId: 'page',
      orderId: 'order',
    })
    expect(prepared.status).toBe('ready')
    expect(prepared.label).toContain('承诺24小时发货及揽收')
    expect(f.writes).toEqual([])
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'execute-payment',
          runId: 'payment',
          uid: 'buyer',
          pageId: 'page',
          orderId: 'order',
          proof: prepared.proof,
          expiresAt: now + 600000,
          timeoutMs: 10,
        })
      ).status,
    ).toBe('confirmed')
    expect(f.writes).toEqual([
      {
        path: '/latitude/message/sendOrderUrge',
        values: { orderSn: 'order', urgeTypes: [2], goodsDiscount: undefined },
      },
    ])
  })
  it('催付条款变化或服务器未确认全部sentTypes时不伪造成功', async () => {
    const f = environment()
    const prepared = await evaluate<{ proof: unknown }>({
      mode: 'prepare-payment',
      uid: 'buyer',
      pageId: 'page',
      orderId: 'order',
    })
    f.urgeVm.urgeTypes = [1]
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'execute-payment',
          runId: 'stale',
          uid: 'buyer',
          pageId: 'page',
          orderId: 'order',
          proof: prepared.proof,
          expiresAt: now + 600000,
          timeoutMs: 10,
        })
      ).status,
    ).toBe('failed')
    expect(f.writes).toEqual([])
    f.urgeVm.urgeTypes = [2]
    f.setSentTypes([])
    expect(
      (
        await evaluate<{ status: string }>({
          mode: 'execute-payment',
          runId: 'unconfirmed',
          uid: 'buyer',
          pageId: 'page',
          orderId: 'order',
          proof: prepared.proof,
          expiresAt: now + 600000,
          timeoutMs: 10,
        })
      ).status,
    ).toBe('uncertain')
  })
})
