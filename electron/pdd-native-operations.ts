export interface PddNativeOperationInput {
  mode:
    | 'snapshot'
    | 'read-transfer'
    | 'prepare-transfer'
    | 'execute-transfer'
    | 'prepare-payment'
    | 'execute-payment'
    | 'inspect'
    | 'cancel'
  uid?: string
  pageId?: string
  agentId?: string
  orderId?: string
  runId?: string
  proof?: unknown
  expiresAt?: number
  timeoutMs?: number
  transferKeywords?: string[]
}

/** Runs only inside the verified PDD WebContents. Native Vue methods retain platform auth,
 * validation and transport. No guessed write API, automatic discounts or protocol signing. */
async function pddNativeOperation(input: PddNativeOperationInput) {
  type Row = Record<string, unknown>
  interface Vm {
    $options?: { name?: string }
    $children?: Vm[]
    $parent?: Vm
    $store?: { state: Row }
    [key: string]: unknown
  }
  interface Receipt {
    status: 'executing' | 'confirmed' | 'failed' | 'uncertain'
    reason: string
    attempted: boolean
    cancelled?: boolean
    evidenceId?: string
  }
  interface Axios {
    post(path: string, data?: unknown, ...extra: unknown[]): Promise<unknown>
  }
  const object = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {})
  const norm = (v: unknown) =>
    String(v ?? '')
      .trim()
      .replace(/-\d+-reply$/, '')
      .replace(/-0-all$/, '')
  const root = (document.querySelector('#app') as (Element & { __vue__?: Vm }) | null)?.__vue__
  if (!root?.$store) return { status: 'blocked', reason: '原生Vue店铺状态尚未载入' }
  const state = root.$store.state
  const view = window as unknown as {
    __pddWeb?: { currentUid?(): string; reviewHistory?(uid: string): unknown }
    __lingtuPddNativeReceipts?: Map<string, Receipt>
  }
  const receipts = (view.__lingtuPddNativeReceipts ??= new Map())
  if (input.mode === 'cancel') {
    const r = receipts.get(input.runId ?? '')
    if (r) r.cancelled = true
    return { cancelled: true }
  }
  if (input.mode === 'inspect')
    return (
      receipts.get(input.runId ?? '') ?? {
        status: 'uncertain',
        reason: '没有本次原生操作回执',
        attempted: false,
      }
    )
  const hook = view.__pddWeb
  const components = () => {
    const found: Vm[] = [],
      pending = [root]
    while (pending.length && found.length < 2000) {
      const vm = pending.shift()!
      found.push(vm)
      pending.push(...(vm.$children ?? []))
    }
    return found
  }
  const vms = components()
  const method = (vm: Vm, key: string, args: unknown[] = []) => {
    const fn = vm[key]
    if (typeof fn !== 'function') throw Error(`原生${key}能力不可用`)
    return Reflect.apply(fn, vm, args) as unknown
  }
  const current = () =>
    norm(hook?.currentUid?.() ?? object(object(state.currentUserInfo).userInfo).uid)
  const page = () => String(object(hook?.reviewHistory?.(current())).page ?? '')
  const conversationRevision = () => {
    const review = object(hook?.reviewHistory?.(current()))
    if (
      review.known !== true ||
      norm(review.uid) !== current() ||
      !Array.isArray(review.messages) ||
      review.messages.length > 1000
    )
      return
    const serialized = JSON.stringify(review.messages)
    return serialized.length <= 1000000 ? serialized : undefined
  }
  const platformIdentity = () => {
    const own = object(state.userInfo)
    return JSON.stringify([
      String(own.id ?? ''),
      String(own.mall_id ?? object(own.mall).mall_id ?? ''),
      String(own.cs_uid ?? ''),
    ])
  }
  const targetValid = () =>
    !!input.uid && current() === input.uid && (!input.pageId || page() === input.pageId)
  const composerEmpty = () => {
    const el = document.querySelector<HTMLTextAreaElement>('#replyTextarea')
    return !!el && !el.value.trim()
  }
  const lease = input.runId ? receipts.get(input.runId) : undefined
  const guard = () =>
    targetValid() &&
    composerEmpty() &&
    (!input.expiresAt || input.expiresAt > Date.now()) &&
    (!input.mode.startsWith('execute-') ||
      (typeof object(input.proof).conversationRevision === 'string' &&
        object(input.proof).conversationRevision === conversationRevision() &&
        object(input.proof).platformIdentity === platformIdentity())) &&
    !lease?.cancelled
  const waitFor = async (test: () => boolean) => {
    const end = Date.now() + 5000
    while (!test() && Date.now() < end)
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    return test()
  }
  const orderBuyer = (vm: Vm) => {
    const order = object(vm.orderInfo),
      uid = norm(vm.currentUid)
    let parent = vm.$parent
    for (let depth = 0; parent && depth < 12; depth++, parent = parent.$parent) {
      const query = String(object(parent.recordRequestList).url ?? '')
      if (
        [
          'ordersAll',
          'unfinishedOrders',
          'unshippedOrders',
          'shippedNotReceivedOrders',
          'receivedOrders',
          'refundOrders',
        ].includes(query) &&
        norm(parent.currentUid) === uid &&
        parent.requestFetching === false &&
        Array.isArray(parent.orderItems) &&
        parent.orderItems.some((value) => value === order)
      )
        return uid
    }
    return ''
  }
  const nativeOrders = vms
    .filter((vm) => vm.$options?.name === 'UrgeDialog' && typeof vm.currentUid === 'string')
    .flatMap((vm) => {
      const order = object(vm.orderInfo),
        uid = orderBuyer(vm),
        orderId = String(order.orderSn ?? '')
      return uid && orderId && order.urgePayAvailable === true
        ? [
            {
              orderId,
              uid,
              label: String(object(order.orderGoodsList).goodsName ?? orderId).slice(0, 250),
              status: 'unpaid' as const,
            },
          ]
        : []
    })
  if (input.mode === 'snapshot') {
    const conversations = new Map<string, Row>()
    for (const value of [
      ...(Array.isArray(state.chatList) ? state.chatList : []),
      state.currentUserInfo,
    ]) {
      const conv = object(value),
        uid = norm(object(conv.userInfo).uid)
      if (uid) conversations.set(uid, conv)
    }
    const visitors: { uid: string; sessionId: string; observedAt: number }[] = []
    const transferRequests: { uid: string; id: string; observedAt: number }[] = []
    const keywords = (input.transferKeywords ?? [])
      .filter((x) => typeof x === 'string' && x.trim())
      .slice(0, 100)
      .map((x) => x.trim())
    let nativeReview:
      | {
          known: boolean
          uid: string
          page: string
          messages: { from: 'buyer' | 'seller'; content: string; media: string[] }[]
        }
      | undefined
    for (const [uid, conv] of conversations) {
      if (Array.isArray(conv.messageList) && keywords.length)
        for (const raw of conv.messageList.slice(-1000)) {
          const message = object(raw),
            role = String(object(message.from).role ?? ''),
            content = String(message.content ?? ''),
            id = String(message.msg_id ?? '')
          let ts = Number(message.ts ?? 0)
          if (ts > 0 && ts < 1e12) ts *= 1000
          if (
            role === 'user' &&
            Number(message.type) === 0 &&
            id &&
            Number.isFinite(ts) &&
            ts > 0 &&
            keywords.some((keyword) => content.includes(keyword))
          )
            transferRequests.push({ uid, id, observedAt: ts })
        }
      if (
        conv.hasMore !== false ||
        !Array.isArray(conv.messageList) ||
        conv.messageList.length > 1000
      )
        continue
      let uncertain = false,
        humans = 0
      const entries: { sessionId: string; observedAt: number }[] = []
      const messages: { from: 'buyer' | 'seller'; content: string; media: string[] }[] = []
      for (const value of conv.messageList) {
        const m = object(value),
          role = String(object(m.from).role ?? ''),
          kind = Number(m.type),
          template = String(m.template_name ?? ''),
          info = object(m.info)
        const buyer = /^(user|buyer|consumer|customer)$/.test(role),
          seller = /^(mall_cs|mall|merchant|seller|cs|kefu)$/.test(role)
        if (!buyer && !seller) {
          uncertain = true
          continue
        }
        const source =
          buyer &&
          kind === 41 &&
          template === 'user_source' &&
          /^当前用户来自/.test(String(info.title ?? '').trim())
        const metadata =
          source || (buyer && kind === 31 && template === 'mall_robot_man_intervention_and_restart')
        if (buyer && !metadata) humans++
        let ts = Number(m.ts ?? 0)
        if (ts > 0 && ts < 1e12) ts *= 1000
        const id = String(m.msg_id ?? '')
        if (source && id && !/^(ui-|st:|h-|temp-)/.test(id) && Number.isFinite(ts) && ts > 0)
          entries.push({ sessionId: id, observedAt: ts })
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
        messages.push({
          from: buyer ? 'buyer' : 'seller',
          content: content.slice(0, 10000),
          media: [],
        })
      }
      if (!uncertain && !humans) for (const entry of entries) visitors.push({ uid, ...entry })
      if (!uncertain && uid === current())
        nativeReview = { known: true, uid, page: page(), messages: messages.slice(-100) }
    }
    return { visitors, transferRequests, orders: nativeOrders, nativeReview }
  }
  const transfer = async (closeAfter: boolean) => {
    if (!targetValid()) throw Error('原生转接买家或页面已变化')
    const existed = !!state.transformChatData
    if (!existed) {
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('.transfer-chat-wrap'))
      if (buttons.length !== 1) throw Error('原生转接入口不唯一')
      buttons[0].click()
      if (!(await waitFor(() => !!object(state.transformChatData).csList)))
        throw Error('原生可转接名单读取超时')
    }
    const data = object(state.transformChatData),
      list = Array.isArray(data.uidList) ? data.uidList : []
    const vm = components().find((vm) => vm.$options?.name === 'transferChatModal')
    if (!vm || list.length !== 1 || norm(object(list[0]).uid) !== input.uid || !targetValid())
      throw Error('原生转接目标不是当前单一买家')
    const agents = Object.entries(object(data.csList))
      .slice(0, 1000)
      .map(([agentId, raw]) => {
        const row = object(raw)
        return {
          agentId,
          name: String(row.csName ?? row.nickname ?? row.username ?? agentId).slice(0, 200),
          online: null,
          canTransfer: true,
        }
      })
    const agent = agents.find((row) => row.agentId === input.agentId)
    const reasons = Array.isArray(data.transReason) ? data.transReason : []
    const reason = reasons
      .map(object)
      .find((row) => row.code === 10005 && row.desc === '无原因直接转移')
    const revision = conversationRevision()
    if (input.mode !== 'read-transfer' && !revision) throw Error('原生转接消息基线不可读')
    const proof =
      agent && reason
        ? {
            kind: 'transfer',
            conversationRevision: revision,
            platformIdentity: platformIdentity(),
            uid: input.uid,
            agentId: agent.agentId,
            agentName: agent.name,
            reasonCode: 10005,
            reason: '无原因直接转移',
            needWx: false,
          }
        : undefined
    if (closeAfter && !existed) method(vm, 'closeTransformDialog')
    return {
      agents,
      proof,
      vm,
      label: agent ? `转接到${agent.name}；无原因直接转移，不发送微信通知` : '',
    }
  }
  const terms = (value: unknown): number[] | undefined => {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 10 ||
      value.some(
        (type) => typeof type !== 'number' || !Number.isInteger(type) || ![1, 2, 3].includes(type),
      )
    )
      return
    return [...new Set(value as number[])].sort((a, b) => a - b)
  }
  const payment = async () => {
    if (!targetValid()) throw Error('原生催支付买家或页面已变化')
    const candidates = vms.filter(
      (vm) =>
        vm.$options?.name === 'UrgeDialog' &&
        orderBuyer(vm) === input.uid &&
        String(object(vm.orderInfo).orderSn) === input.orderId,
    )
    if (candidates.length !== 1 || candidates[0].visible !== true)
      throw Error('请在平台打开此订单原生催支付弹窗并选择准确条款，不会自动选择优惠或签约')
    const vm = candidates[0],
      axios = vm.$axios as Axios | undefined
    if (!axios || typeof axios.post !== 'function') throw Error('原生订单复核接口不可用')
    let check: Promise<unknown> | undefined
    const original = axios.post
    const wrapped: Axios['post'] = function (this: Axios, path, data, ...extra) {
      const result = Reflect.apply(original, this, [path, data, ...extra]) as Promise<unknown>
      if (
        path === '/latitude/order/validOrderUrge' &&
        String(object(data).orderSn) === input.orderId
      )
        check = result
      return result
    }
    axios.post = wrapped
    let validation: Row
    let validationTimer: ReturnType<typeof setTimeout> | undefined
    try {
      method(vm, 'validData', [true])
      if (!check) throw Error('原生订单校验未发起')
      validation = object(
        await Promise.race([
          check,
          new Promise<never>((_, reject) => {
            validationTimer = setTimeout(
              () => reject(Error('原生订单复核超时')),
              Math.max(5, Math.min(input.timeoutMs ?? 5000, 10000)),
            )
          }),
        ]),
      )
    } finally {
      if (validationTimer) clearTimeout(validationTimer)
      if (axios.post === wrapped) axios.post = original
    }
    if (!targetValid() || vm.visible !== true) throw Error('订单复核期间页面已变化')
    const selected = terms(vm.urgeTypes) ?? []
    const available = Array.isArray(validation.urgeResults)
      ? validation.urgeResults.map(object)
      : []
    if (
      !selected.length ||
      selected.some(
        (type) =>
          ![1, 2, 3].includes(type) ||
          !available.some((result) => result.type === type && result.available === true),
      )
    )
      throw Error('所选催付条款不可用，订单可能已支付、关闭或条款已失效')
    const revision = conversationRevision()
    if (!revision) throw Error('原生催付消息基线不可读')
    const order = object(vm.orderInfo),
      labels: string[] = [],
      proof: Row = {
        kind: 'payment',
        uid: input.uid,
        orderId: input.orderId,
        urgeTypes: selected,
        conversationRevision: revision,
        platformIdentity: platformIdentity(),
      }
    if (selected.includes(1)) {
      if (vm.priceUrgeEnable !== true || object(vm.editPrice).error === true)
        throw Error('原生降价内容无效')
      const discount = object(method(vm, 'submitEdit'))
      if (
        !Number.isSafeInteger(Number(discount.goodsDiscount)) ||
        Number(discount.goodsDiscount) <= 0 ||
        !Number.isFinite(Number(discount.collectionAmount))
      )
        throw Error('降价金额不可核对')
      proof.goodsDiscount = discount.goodsDiscount
      proof.collectionAmount = discount.collectionAmount
      labels.push(
        `降价催付：新增优惠${(Number(discount.goodsDiscount) / 100).toFixed(2)}元，订单实付变为${Number(discount.collectionAmount).toFixed(2)}元`,
      )
    }
    if (selected.includes(2)) {
      if (vm.shippingUrgeEnable !== true) throw Error('发货承诺不可用')
      labels.push('承诺24小时发货及揽收')
    }
    if (selected.includes(3)) {
      if (
        vm.privilegeUrgeEnable !== true ||
        vm.hasNotSignMallProtocol === true ||
        vm.firstPrivilegeVisible === true
      )
        throw Error('特权未开通或需签约，不能自动开通/签约')
      const expense = Number(vm.expense)
      if (!Number.isFinite(expense) || expense < 0) throw Error('特权费用不可核对')
      proof.expense = expense
      labels.push(
        `赠送退货包运费及免拼单；页面预计费用${expense.toFixed(2)}元，平台按实际保障记录结算`,
      )
    }
    proof.label = labels.join('；')
    return {
      vm,
      axios,
      proof,
      label: String(proof.label),
      orderLabel: String(object(order.orderGoodsList).goodsName ?? input.orderId).slice(0, 250),
    }
  }
  try {
    if (input.mode === 'read-transfer' || input.mode === 'prepare-transfer') {
      const data = await transfer(true)
      return {
        status: input.mode === 'read-transfer' || data.proof ? 'ready' : 'blocked',
        agents: data.agents,
        proof: data.proof,
        label: data.label,
        reason: data.proof ? '' : '目标已不在原生可转接名单',
      }
    }
    if (input.mode === 'prepare-payment') {
      const data = await payment()
      return { status: 'ready', proof: data.proof, label: data.label, orderLabel: data.orderLabel }
    }
    if (!input.runId || receipts.has(input.runId) || receipts.size >= 500)
      return { status: 'failed', reason: '原生事项已消费或回执缓存已满', attempted: false }
    const receipt: Receipt = { status: 'executing', reason: '正在复核原生目标', attempted: false }
    receipts.set(input.runId, receipt)
    const isCurrent = () => guard() && !receipt.cancelled
    const timeout = Math.max(5, Math.min(input.timeoutMs ?? 10000, 30000))
    if (input.mode === 'execute-transfer') {
      const data = await transfer(false)
      if (
        !data.proof ||
        JSON.stringify(data.proof) !== JSON.stringify(input.proof) ||
        !isCurrent()
      ) {
        receipt.status = 'failed'
        receipt.reason = '转接目标、条款或运行状态已变化'
        return receipt
      }
      const original = WebSocket.prototype.send
      let requestId = ''
      let cleanupSocket = () => {}
      return await new Promise<Receipt>((resolve) => {
        let settled = false
        const finish = (status: Receipt['status'], reason: string, id?: string) => {
          receipt.status = status
          receipt.reason = reason
          if (id) receipt.evidenceId = id
          if (!settled) {
            settled = true
            clearTimeout(timer)
            if (WebSocket.prototype.send === wrapped) WebSocket.prototype.send = original
            cleanupSocket()
            resolve({ ...receipt })
          }
        }
        const listener = (event: MessageEvent) => {
          try {
            const reply = object(JSON.parse(String(event.data)))
            if (
              reply.response !== 'move_conversation' ||
              String(reply.request_id ?? '') !== requestId
            )
              return
            if (reply.result === 'ok' && (!reply.error_code || Number(reply.error_code) === 0))
              finish('confirmed', '原生转接已取得同一连接和请求编号的服务器成功回执', requestId)
            else if ((reply.result && reply.result !== 'ok') || Number(reply.error_code) > 0)
              finish('failed', '服务器明确拒绝本次转接，未自动重试', requestId)
          } catch {
            /* Ignore unrelated socket traffic. */
          }
        }
        const wrapped: WebSocket['send'] = function (this: WebSocket, raw) {
          let request: Row
          try {
            request = object(JSON.parse(String(raw)))
          } catch {
            return Reflect.apply(original, this, [raw])
          }
          if (request.cmd !== 'move_conversation') return Reflect.apply(original, this, [raw])
          const target = object(request.conversation)
          if (
            !isCurrent() ||
            receipt.attempted ||
            String(target.uid) !== input.uid ||
            String(target.csid) !== input.agentId ||
            target.need_wx !== false ||
            target.remark !== '无原因直接转移'
          ) {
            finish('failed', '原生转接请求目标不匹配，已阻止')
            throw Error('转接请求被批准边界阻止')
          }
          requestId = String(request.request_id ?? '')
          if (!requestId) throw Error('原生转接缺少请求编号')
          cleanupSocket = () => this.removeEventListener('message', listener)
          this.addEventListener('message', listener)
          receipt.attempted = true
          return Reflect.apply(original, this, [raw])
        }
        const timer = setTimeout(
          () =>
            finish(
              receipt.attempted ? 'uncertain' : 'failed',
              '未取得对应原生转接服务器回执，禁止重发',
            ),
          timeout,
        )
        WebSocket.prototype.send = wrapped
        try {
          method(data.vm, 'transferWithRemark', [
            input.agentId,
            { code: 10005, desc: '无原因直接转移' },
            false,
          ])
        } catch {
          finish(receipt.attempted ? 'uncertain' : 'failed', '原生转接调用未确认，禁止重发')
        }
      })
    }
    if (input.mode === 'execute-payment') {
      const data = await payment()
      if (JSON.stringify(data.proof) !== JSON.stringify(input.proof) || !isCurrent()) {
        receipt.status = 'failed'
        receipt.reason = '订单、催付条款或运行状态已变化'
        return receipt
      }
      const original = data.axios.post
      return await new Promise<Receipt>((resolve) => {
        let settled = false
        const finish = (status: Receipt['status'], reason: string) => {
          receipt.status = status
          receipt.reason = reason
          if (!settled) {
            settled = true
            clearTimeout(timer)
            if (data.axios.post === wrapped) data.axios.post = original
            resolve({ ...receipt })
          }
        }
        const wrapped: Axios['post'] = function (this: Axios, path, values, ...extra) {
          if (path !== '/latitude/message/sendOrderUrge')
            return Reflect.apply(original, this, [path, values, ...extra]) as Promise<unknown>
          const body = object(values),
            proof = object(input.proof)
          if (
            !isCurrent() ||
            receipt.attempted ||
            String(body.orderSn) !== input.orderId ||
            JSON.stringify(terms(body.urgeTypes)) !== JSON.stringify(terms(proof.urgeTypes)) ||
            body.goodsDiscount !== proof.goodsDiscount
          ) {
            finish('failed', '原生催支付请求与批准条款不匹配，已阻止')
            return Promise.reject(Error('催付请求被批准边界阻止'))
          }
          receipt.attempted = true
          const pending = Reflect.apply(original, this, [
            path,
            values,
            ...extra,
          ]) as Promise<unknown>
          void pending.then(
            (raw) => {
              const reply = object(raw),
                sent = terms(reply.sentTypes),
                types = terms(proof.urgeTypes)
              if (types && sent && JSON.stringify(types) === JSON.stringify(sent)) {
                receipt.evidenceId = `native-urge:${input.runId}`
                finish('confirmed', '原生服务器sentTypes已确认全部批准条款')
              } else finish('uncertain', '原生服务器未确认全部催付条款，禁止重发')
            },
            () => finish('uncertain', '原生催支付请求结果未知，禁止重发'),
          )
          return pending
        }
        const timer = setTimeout(
          () => finish(receipt.attempted ? 'uncertain' : 'failed', '原生催支付结果超时，禁止重发'),
          timeout,
        )
        data.axios.post = wrapped
        try {
          method(data.vm, 'send')
        } catch {
          finish(receipt.attempted ? 'uncertain' : 'failed', '原生催支付调用未确认，禁止重发')
        }
      })
    }
    return { status: 'blocked', reason: '不支持的原生操作' }
  } catch (error) {
    return {
      status: input.mode.startsWith('execute-') ? 'failed' : 'blocked',
      reason: error instanceof Error ? error.message : '原生平台操作不可用',
      attempted: false,
    }
  }
}

export function buildPddNativeOperationScript(input: PddNativeOperationInput): string {
  return `/*lingtu-pdd-native*/(${pddNativeOperation.toString()})(${JSON.stringify(input)})`
}
