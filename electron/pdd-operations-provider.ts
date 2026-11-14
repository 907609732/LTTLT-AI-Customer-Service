import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { get } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { z } from 'zod'
import { pageReviewFingerprint, pageReviewSchema } from './conversation-review'
import { buildPddVideoScript } from './pdd-native-video'
import {
  buildPddNativeOperationScript,
  type PddNativeOperationInput,
} from './pdd-native-operations'
import {
  automationActionSchema,
  type AutomationAction,
  preparedPlatformOperationSchema,
  type PlatformOperationsPort,
  type PlatformOperationScope,
  type PreparedPlatformOperation,
  type PlatformOperationResult,
  type PlatformOperationValidation,
  type PlatformOperationStoreFacts,
  type PreparePlatformOperationInput,
  type ReceptionEvent,
} from '../src/shared/contracts/platform-operations'

interface PddWebContents {
  id: number
  getURL(): string
  isDestroyed(): boolean
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
}
interface PddOperationAdapter {
  _wc(): PddWebContents
  readIdentity(options?: { refresh: true }): Promise<unknown>
  focusConversation(uid: string): Promise<{ ok: boolean }>
  reviewHistory(uid: string, focus?: boolean): Promise<unknown>
  sendText(uid: string, text: string, options: { isCurrent(): boolean }): Promise<unknown>
}
export interface PddOperationsProviderOptions {
  workspaceId: string
  accountId: string | (() => string)
  getAdapter(storeId: string): unknown
  getStore(storeId: string): unknown
  assertActive(storeId: string): void
  withExclusive?<T>(storeId: string, operation: () => Promise<T>): Promise<T>
  now?(): number
  confirmationTimeoutMs?: number
  transferKeywords?(storeId: string): string[]
  loadMedia?(
    url: string,
    kind: 'welcome-image' | 'welcome-video',
  ): Promise<{ bytes: Uint8Array; mimeType: string }>
}
const identitySchema = z.object({
  authenticated: z.literal(true),
  mallId: z.string().min(1),
  storeName: z.string().min(1),
  customerServiceId: z.string().trim().min(1).max(128),
})
const storeSchema = z.object({
  id: z.string().min(1),
  mallId: z.string().trim().min(1),
  platform: z.literal('pdd-web'),
  name: z.string().optional(),
  storeName: z.string().optional(),
  aiEnabled: z.boolean().optional(),
})
const pageSchema = z.object({
  hookReady: z.boolean(),
  pageId: z.string(),
  activeUid: z.string(),
  sellerIdentity: z.object({
    accountId: z.string().max(128),
    mallId: z.string().max(128),
    senderId: z.string().max(128),
  }),
  buyers: z
    .array(z.object({ uid: z.string().min(1).max(128), name: z.string().min(1).max(200) }))
    .max(1000),
  composer: z.object({ present: z.boolean(), empty: z.boolean() }),
  mediaInputs: z.object({ image: z.boolean(), video: z.boolean() }),
  serverMessages: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        uid: z.string().min(1),
        from: z.enum(['buyer', 'seller']),
        senderId: z.string().max(128),
        senderMallId: z.string().max(128),
        type: z.enum(['text', 'image', 'video']),
        content: z.string().max(10000),
        ts: z.number().nonnegative(),
        acknowledged: z.boolean(),
      }),
    )
    .max(1000),
})
type PageSnapshot = z.infer<typeof pageSchema>
const videoLibrarySchema = z.object({
  status: z.enum(['ready', 'blocked']),
  pageId: z.string(),
  reason: z.string().optional(),
  assets: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        url: z.url().startsWith('https://'),
        sizeBytes: z.number().int().positive(),
        extension: z.string(),
        checkStatus: z.literal(2),
      }),
    )
    .max(100),
})
const nativeSnapshotSchema = z.object({
  transferRequests: z
    .array(z.object({ uid: z.string(), id: z.string(), observedAt: z.number() }))
    .max(1000)
    .default([]),
  visitors: z
    .array(z.object({ uid: z.string(), sessionId: z.string(), observedAt: z.number() }))
    .max(1000),
  orders: z
    .array(
      z.object({
        orderId: z.string(),
        uid: z.string(),
        label: z.string(),
        status: z.literal('unpaid'),
      }),
    )
    .max(1000),
  nativeReview: pageReviewSchema.optional(),
})
const nativePlanSchema = z.object({
  status: z.enum(['ready', 'blocked']),
  reason: z.string().optional(),
  proof: z.unknown().optional(),
  label: z.string().optional(),
  orderLabel: z.string().optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string(),
        name: z.string(),
        online: z.boolean().nullable(),
        canTransfer: z.boolean(),
      }),
    )
    .max(1000)
    .optional(),
})
type PageReview = z.infer<typeof pageReviewSchema>
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const mediaLimit = (kind: string) => (kind === 'welcome-image' ? 10 : 100) * 1024 * 1024
const mimeTypes = {
  'welcome-image': ['image/png', 'image/jpeg'],
  'welcome-video': ['video/mp4', 'video/webm'],
}

/** Read only the integrated native Vuex/hook fields. Never expose a store object or credentials. */
function readPddOperationsPage() {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const norm = (value: unknown) =>
    String(value ?? '')
      .trim()
      .replace(/-\d+-reply$/, '')
      .replace(/-0-all$/, '')
  const app = document.querySelector('#app') as
    | (Element & { __vue__?: { $store?: { state?: Record<string, unknown> } } })
    | null
  const state = app?.__vue__?.$store?.state ?? {}
  const hook = (
    window as unknown as {
      __pddWeb?: {
        currentUid?(): string
        reviewHistory?(uid: string): unknown
        prepareNativeTextSend?: unknown
      }
    }
  ).__pddWeb
  const activeUid = norm(hook?.currentUid?.() ?? state.selectingChatUid)
  const review = record(hook?.reviewHistory?.(activeUid))
  const buyers = new Map<string, { uid: string; name: string }>()
  const lists = [state.todayChatList, state.chatList, state.searchChatList]
  const current = record(state.currentUserInfo),
    currentUser = record(current.userInfo)
  let selected: Record<string, unknown> | undefined =
    norm(currentUser.uid) === activeUid ? current : undefined
  if (activeUid && norm(currentUser.uid) === activeUid)
    buyers.set(activeUid, {
      uid: activeUid,
      name: String(
        currentUser.nickname ?? currentUser.nickName ?? currentUser.username ?? activeUid,
      ).slice(0, 200),
    })
  for (const list of lists)
    if (Array.isArray(list))
      for (const raw of list.slice(0, 1000)) {
        const conv = record(raw),
          user = record(conv.userInfo),
          uid = norm(user.uid)
        if (!uid) continue
        const name = String(
          user.nickname ?? user.nickName ?? user.nick ?? user.user_name ?? user.username ?? uid,
        )
          .trim()
          .slice(0, 200)
        buyers.set(uid, { uid, name: name || uid })
        if (uid === activeUid && !selected) selected = conv
      }
  const serverMessages: {
    id: string
    uid: string
    from: 'buyer' | 'seller'
    senderId: string
    senderMallId: string
    type: 'text' | 'image' | 'video'
    content: string
    ts: number
    acknowledged: boolean
  }[] = []
  if (selected && Array.isArray(selected.messageList))
    for (const raw of selected.messageList.slice(-1000)) {
      const message = record(raw),
        from = record(message.from),
        to = record(message.to)
      const id = String(message.msg_id ?? message.msgId ?? message.message_id ?? '')
      if (!id || /^(ui-|img-|vid-|st:|h-|temp-|local-|client-)/.test(id)) continue
      const role = String(
        from.role ?? from.type ?? message.role ?? message.send_type ?? '',
      ).toLowerCase()
      const direction = /^(mall_cs|mall|merchant|seller|shop|cs|kefu|客服|商家)$/.test(role)
        ? 'seller'
        : /^(user|buyer|consumer|customer|买家|顾客)$/.test(role)
          ? 'buyer'
          : undefined
      if (
        !direction ||
        (direction === 'seller' &&
          (norm(to.uid) !== activeUid ||
            (to.role && !/^(user|buyer|consumer|customer)$/.test(String(to.role)))))
      )
        continue
      const status = String(message.status ?? message.send_status ?? '').toLowerCase()
      if (/(sending|pending|failed|error|cancel|上传中|失败)/.test(status)) continue
      const acknowledged =
        message.ack === true ||
        message.server_ack === true ||
        /^(sent|success|delivered|read)$/.test(status)
      if (!acknowledged) continue
      const body = message.content ?? message.message ?? message.msg
      const content =
        typeof body === 'string'
          ? body
          : String(
              record(body).url ??
                record(body).image_url ??
                record(body).img_url ??
                record(body).imageUrl ??
                record(body).video_url ??
                record(body).text ??
                '',
            )
      const declared = Number(message.type ?? message.msg_type)
      if (declared === 14 && Number(record(message.info).status) === 1) continue
      const type =
        declared === 1 ? 'image' : declared === 14 ? 'video' : declared === 0 ? 'text' : undefined
      if (!type || !content || (type !== 'text' && !/^https:\/\//.test(content))) continue
      let ts = Number(message.ts ?? message.time ?? message.timestamp ?? 0)
      if (!Number.isFinite(ts) || ts < 0) ts = 0
      if (ts > 0 && ts < 1e12) ts *= 1000
      serverMessages.push({
        id,
        uid: activeUid,
        from: direction,
        senderId: String(from.cs_uid ?? '')
          .trim()
          .slice(0, 128),
        senderMallId: String(from.uid ?? '')
          .trim()
          .slice(0, 128),
        type,
        content: content.slice(0, 10000),
        ts,
        acknowledged,
      })
    }
  const composer = document.querySelector<HTMLTextAreaElement>('#replyTextarea')
  const present = Boolean(
    composer &&
      !composer.disabled &&
      !composer.readOnly &&
      composer.getBoundingClientRect().width > 0 &&
      composer.getBoundingClientRect().height > 0,
  )
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ).filter((input) => !input.disabled && !input.files?.length)
  const matching = (kind: string) =>
    inputs.filter((input) =>
      input.accept
        .toLowerCase()
        .split(',')
        .some((value) => value.trim().startsWith(`${kind}/`)),
    ).length === 1
  return {
    hookReady: Boolean(hook?.prepareNativeTextSend && review.page),
    pageId: String(review.page ?? ''),
    activeUid,
    sellerIdentity: {
      accountId: String(record(state.userInfo).id ?? '')
        .trim()
        .slice(0, 128),
      mallId: String(
        record(state.userInfo).mall_id ?? record(record(state.userInfo).mall).mall_id ?? '',
      )
        .trim()
        .slice(0, 128),
      senderId: String(record(state.userInfo).cs_uid ?? '')
        .trim()
        .slice(0, 128),
    },
    buyers: [...buyers.values()].slice(0, 1000),
    composer: { present, empty: present && !composer!.value.trim() },
    mediaInputs: { image: matching('image'), video: matching('video') },
    serverMessages,
  }
}
export function buildPddOperationsReadScript(): string {
  return `/*lingtu-pdd-operations:read*/(${readPddOperationsPage.toString()})()`
}

/** One native file event; never combine paste/drop or click an unverified send dialog. */
function dispatchPddMediaUpload(input: {
  uid: string
  page: string
  review: PageReview
  reviewSource: 'native' | 'dom'
  sellerIdentity: PageSnapshot['sellerIdentity']
  mimeType: string
  filename: string
  base64: string
  kind: 'image' | 'video'
}) {
  const hook = (
    window as unknown as {
      __pddWeb?: { currentUid?(): string; reviewHistory?(uid: string): PageReview }
    }
  ).__pddWeb
  const composer = document.querySelector<HTMLTextAreaElement>('#replyTextarea')
  const readReview = (): PageReview | undefined => {
    const record = (v: unknown): Record<string, unknown> =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    const app = document.querySelector('#app') as
      | (Element & { __vue__?: { $store?: { state?: Record<string, unknown> } } })
      | null
    const own = record(app?.__vue__?.$store?.state?.userInfo)
    if (
      String(own.id ?? '').trim() !== input.sellerIdentity.accountId ||
      String(own.mall_id ?? record(own.mall).mall_id ?? '').trim() !==
        input.sellerIdentity.mallId ||
      String(own.cs_uid ?? '').trim() !== input.sellerIdentity.senderId
    )
      return
    const value = hook?.reviewHistory?.(input.uid)
    if (input.reviewSource === 'dom') return value
    const convo = record(app?.__vue__?.$store?.state?.currentUserInfo)
    const uid = String(record(convo.userInfo).uid ?? '')
      .replace(/-\d+-reply$/, '')
      .replace(/-0-all$/, '')
    if (
      uid !== input.uid ||
      convo.hasMore !== false ||
      !Array.isArray(convo.messageList) ||
      convo.messageList.length > 1000 ||
      !value?.page
    )
      return
    const messages: PageReview['messages'] = []
    for (const raw of convo.messageList) {
      const message = record(raw),
        role = String(record(message.from).role ?? '')
      const buyer = /^(user|buyer|consumer|customer)$/.test(role),
        seller = /^(mall_cs|mall|merchant|seller|cs|kefu)$/.test(role)
      if (!buyer && !seller) return
      messages.push({
        from: buyer ? 'buyer' : 'seller',
        content: (typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content ?? '')
        ).slice(0, 10000),
        media: [],
      })
    }
    return { known: true, uid, page: value.page, messages: messages.slice(-100) }
  }
  const fresh = readReview()
  if (
    !hook ||
    hook.currentUid?.() !== input.uid ||
    !fresh?.known ||
    fresh.page !== input.page ||
    JSON.stringify(fresh.messages) !== JSON.stringify(input.review.messages) ||
    !composer ||
    composer.disabled ||
    composer.readOnly ||
    composer.value.trim()
  )
    return { attempted: false, reason: '目标会话、消息或人工草稿已变化' }
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ).filter(
    (node) =>
      !node.disabled &&
      !node.files?.length &&
      node.accept
        .toLowerCase()
        .split(',')
        .some((value) => value.trim().startsWith(`${input.kind}/`)),
  )
  if (candidates.length !== 1) return { attempted: false, reason: '没有唯一的原生媒体文件入口' }
  const binary = atob(input.base64),
    bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  const file = new File([bytes], input.filename, { type: input.mimeType })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  if (
    hook.currentUid?.() !== input.uid ||
    composer.value.trim() ||
    JSON.stringify(readReview()?.messages) !== JSON.stringify(input.review.messages)
  )
    return { attempted: false, reason: '文件准备期间会话已变化' }
  candidates[0].files = transfer.files
  candidates[0].dispatchEvent(new Event('change', { bubbles: true }))
  return { attempted: true }
}

const deniedAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  deniedAddresses.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  deniedAddresses.addSubnet(address, prefix, 'ipv6')

/** Pin validated public DNS results and never send cookies, platform headers or follow redirects. */
export async function loadPddOperationMedia(
  rawUrl: string,
  kind: 'welcome-image' | 'welcome-video',
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('媒体仅允许不含凭据的公网 HTTPS 地址')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true })
  if (
    !addresses.length ||
    addresses.some((item) =>
      deniedAddresses.check(item.address, item.family === 6 ? 'ipv6' : 'ipv4'),
    )
  )
    throw new Error('媒体不允许读取本机、私有或保留网络')
  const selected = addresses[0],
    limit = mediaLimit(kind)
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        headers: { Accept: mimeTypes[kind].join(',') },
        family: selected.family,
        signal: AbortSignal.timeout(30000),
        lookup: (_hostname, _options, callback) =>
          callback(null, selected.address, selected.family),
      },
      (response) => {
        const mimeType = String(response.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase()
        if (
          response.statusCode !== 200 ||
          !mimeTypes[kind].includes(mimeType) ||
          Number(response.headers['content-length']) > limit
        ) {
          response.destroy()
          reject(new Error('媒体下载、真实类型或大小校验未通过'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > limit) response.destroy(new Error('媒体超出大小限制'))
          else chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () =>
          size > 0 && size <= limit
            ? resolve({ bytes: Buffer.concat(chunks), mimeType })
            : reject(new Error('媒体为空或超过大小限制')),
        )
      },
    )
    request.setTimeout(30000, () => request.destroy(new Error('媒体下载超时')))
    request.on('error', reject)
  })
}

interface PreparedRecord {
  prepared: PreparedPlatformOperation
  review: PageReview
  page: PageSnapshot
  bytes?: Uint8Array
  attemptedAt?: number
  attempted?: boolean
  nativeProof?: unknown
  reviewSource: 'native' | 'dom'
}
export function createPddOperationsProvider(
  options: PddOperationsProviderOptions,
): PlatformOperationsPort {
  const now = options.now ?? Date.now,
    mediaLoader = options.loadMedia ?? loadPddOperationMedia
  const records = new Map<string, PreparedRecord>(),
    agents = new Map<
      string,
      { accountId: string; at: number; rows: PlatformOperationStoreFacts['agents'] }
    >()
  let tail: Promise<void> = Promise.resolve()
  const videoLibraries = new Map<
    string,
    {
      accountId: string
      at: number
      assets: NonNullable<PlatformOperationStoreFacts['mediaAssets']>
    }
  >()
  const account = () =>
    typeof options.accountId === 'function' ? options.accountId() : options.accountId
  const scoped = <T>(storeId: string, job: () => Promise<T>): Promise<T> => {
    const result = tail.then(() =>
      options.withExclusive ? options.withExclusive(storeId, job) : job(),
    )
    tail = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const context = (scope: PlatformOperationScope, writing = false) => {
    if (scope.workspaceId !== options.workspaceId) throw Error('工作区已变化')
    options.assertActive(scope.storeId)
    const store = storeSchema.parse(options.getStore(scope.storeId)),
      owner = account(),
      raw = options.getAdapter(scope.storeId)
    if (store.id !== scope.storeId) throw Error('注册店铺身份不匹配')
    if (
      !raw ||
      typeof raw !== 'object' ||
      !['_wc', 'readIdentity', 'focusConversation', 'reviewHistory', 'sendText'].every(
        (k) => typeof Reflect.get(raw, k) === 'function',
      )
    )
      throw Error('原生平台接口未就绪')
    const adapter = raw as PddOperationAdapter,
      wc = adapter._wc()
    const assert = () => {
      options.assertActive(scope.storeId)
      const latest = storeSchema.parse(options.getStore(scope.storeId))
      if (
        latest.id !== store.id ||
        latest.mallId !== store.mallId ||
        account() !== owner ||
        options.getAdapter(scope.storeId) !== raw ||
        adapter._wc() !== wc ||
        wc.isDestroyed()
      )
        throw Error('注册店铺、账号或页面已经变化')
      if (writing && latest.aiEnabled && !options.withExclusive)
        throw Error('请先暂停此店铺AI，再逐项批准平台操作')
      const url = new URL(wc.getURL())
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'mms.pinduoduo.com' ||
        url.pathname !== '/chat-merchant/index.html'
      )
        throw Error('当前不是已验证的拼多多客服页面')
    }
    assert()
    return { store, adapter, wc, assert, owner }
  }
  const native = (wc: PddWebContents, input: PddNativeOperationInput) =>
    wc.executeJavaScript(buildPddNativeOperationScript(input), true)
  const readData = async (scope: PlatformOperationScope, focus?: string, writing = false) => {
    const c = context(scope, writing),
      identity = identitySchema.parse(await c.adapter.readIdentity({ refresh: true }))
    c.assert()
    if (identity.mallId !== c.store.mallId) throw Error('平台实际店铺与已注册店铺身份不匹配')
    if (focus && !(await c.adapter.focusConversation(focus)).ok) throw Error('无法定位准确平台买家')
    c.assert()
    const page = pageSchema.parse(
      await c.wc.executeJavaScript(buildPddOperationsReadScript(), true),
    )
    c.assert()
    if (
      !page.sellerIdentity.senderId ||
      page.sellerIdentity.accountId !== identity.customerServiceId ||
      page.sellerIdentity.mallId !== identity.mallId
    )
      throw Error('原生客服发者与已验证账号身份无法绑定')
    const facts = nativeSnapshotSchema.parse(
      await native(c.wc, {
        mode: 'snapshot',
        transferKeywords: options.transferKeywords?.(scope.storeId) ?? [],
      }),
    )
    c.assert()
    const after = identitySchema.parse(await c.adapter.readIdentity({ refresh: true }))
    c.assert()
    if (after.mallId !== identity.mallId || after.customerServiceId !== identity.customerServiceId)
      throw Error('平台身份在读取期间变化')
    return {
      ...c,
      page,
      native: facts,
      identity,
      accountId: digest(
        JSON.stringify([
          c.owner,
          identity.mallId,
          identity.customerServiceId,
          page.sellerIdentity.senderId,
        ]),
      ),
      storeRevision: digest(
        JSON.stringify([
          c.store.id,
          identity.mallId,
          identity.customerServiceId,
          page.sellerIdentity.senderId,
          c.wc.id,
        ]),
      ),
    }
  }
  type Data = Awaited<ReturnType<typeof readData>>
  const review = async (data: Data, uid: string, source: 'native' | 'dom') =>
    pageReviewSchema.parse(
      source === 'native' ? data.native.nativeReview : await data.adapter.reviewHistory(uid, false),
    )
  const nativePlan = async (
    data: Data,
    action: AutomationAction,
    uid: string,
    pageId: string,
    runId: string,
    proof?: unknown,
    expiresAt?: number,
  ) => {
    if (action.kind === 'welcome-video') {
      const plan = nativePlanSchema.parse(
        await data.wc.executeJavaScript(
          buildPddVideoScript({
            mode: 'prepare',
            runId,
            uid,
            pageId,
            url: action.url,
            proof,
            expiresAt,
          }),
          true,
        ),
      )
      data.assert()
      return plan
    }
    if (action.kind !== 'transfer' && action.kind !== 'payment-reminder') return undefined
    const plan = nativePlanSchema.parse(
      await native(data.wc, {
        mode: action.kind === 'transfer' ? 'prepare-transfer' : 'prepare-payment',
        uid,
        pageId,
        ...(action.kind === 'transfer' ? { agentId: action.agentId } : { orderId: action.orderId }),
      }),
    )
    data.assert()
    return plan
  }
  const validate = async (
    prepared: PreparedPlatformOperation,
  ): Promise<PlatformOperationValidation> => {
    const row = records.get(prepared.runId)
    if (!row || JSON.stringify(row.prepared) !== JSON.stringify(prepared))
      return { status: 'invalid', reason: '本次运行缺少相同准备基线' }
    if (prepared.expiresAt <= now()) return { status: 'invalid', reason: '批准已过期' }
    try {
      const data = await readData(
        { workspaceId: options.workspaceId, storeId: prepared.target.storeId },
        undefined,
        true,
      )
      if (
        data.accountId !== prepared.basis.accountId ||
        data.storeRevision !== prepared.basis.storeRevision ||
        data.page.pageId !== prepared.basis.pageId ||
        data.page.activeUid !== prepared.target.uid
      )
        return { status: 'invalid', reason: '平台账号、页面、店铺或买家已变化' }
      if (
        ['welcome-text', 'welcome-image', 'welcome-video'].includes(prepared.action.kind) &&
        (!data.page.composer.present || !data.page.composer.empty)
      )
        return { status: 'invalid', reason: '平台输入框不可用或存在人工草稿' }
      const current = await review(data, prepared.target.uid, row.reviewSource)
      data.assert()
      const hash = pageReviewFingerprint(current)
      if (!hash) return { status: 'unavailable', reason: '网页消息暂不可读' }
      if (digest(hash) !== prepared.basis.conversationRevision)
        return { status: 'invalid', reason: '平台出现新消息或人工回复，旧事项已失效' }
      const plan = await nativePlan(
        data,
        prepared.action,
        prepared.target.uid,
        prepared.basis.pageId,
        prepared.runId,
        row.nativeProof,
        prepared.expiresAt,
      )
      if (
        plan &&
        (plan.status !== 'ready' || JSON.stringify(plan.proof) !== JSON.stringify(row.nativeProof))
      )
        return { status: 'invalid', reason: plan.reason ?? '原生目标或最终条款已经变化' }
      if (prepared.action.kind === 'welcome-video') {
        const resource = await mediaLoader(prepared.action.url, 'welcome-video')
        data.assert()
        if (
          resource.mimeType !== prepared.media?.mimeType ||
          resource.bytes.length !== prepared.media.sizeBytes ||
          digest(resource.bytes) !== prepared.media.sha256
        )
          return { status: 'invalid', reason: '平台视频素材内容已变化，旧批准已失效' }
      }
      return { status: 'valid' }
    } catch (error) {
      return {
        status: 'invalid',
        reason:
          error instanceof Error && error.message.includes('暂停此店铺AI')
            ? error.message
            : '店铺停用、账号切换或原生身份无法确认',
      }
    }
  }
  const inspect = async (row: PreparedRecord): Promise<PlatformOperationResult> => {
    const p = row.prepared,
      data = await readData({ workspaceId: options.workspaceId, storeId: p.target.storeId })
    if (
      data.accountId !== p.basis.accountId ||
      data.page.pageId !== p.basis.pageId ||
      data.page.activeUid !== p.target.uid
    )
      return { status: 'uncertain', reason: '核对时页面或买家已变化，请打开原平台人工核对' }
    if (p.action.kind === 'transfer' || p.action.kind === 'payment-reminder') {
      const r = z
        .object({
          status: z.enum(['confirmed', 'failed', 'uncertain', 'executing']),
          reason: z.string(),
          evidenceId: z.string().optional(),
        })
        .parse(await native(data.wc, { mode: 'inspect', runId: p.runId }))
      return r.status === 'confirmed' && r.evidenceId
        ? {
            status: 'confirmed',
            reason: r.reason,
            evidence: { id: r.evidenceId, observedAt: now(), description: r.reason },
          }
        : { status: 'uncertain', reason: r.reason }
    }
    if (p.action.kind === 'welcome-text') {
      const current = await review(data, p.target.uid, row.reviewSource)
      data.assert()
      const expected = [
        ...row.review.messages,
        { from: 'seller', content: p.action.text, media: [] },
      ].slice(-100)
      const oldIds = new Set(row.page.serverMessages.map((message) => message.id))
      const text = p.action.text
      const echo = data.page.serverMessages.find(
        (message) =>
          !oldIds.has(message.id) &&
          message.from === 'seller' &&
          message.senderId === data.page.sellerIdentity.senderId &&
          message.senderMallId === data.identity.mallId &&
          message.uid === p.target.uid &&
          message.type === 'text' &&
          message.acknowledged &&
          message.content === text,
      )
      if (
        echo &&
        current.known &&
        current.uid === p.target.uid &&
        current.page === p.basis.pageId &&
        JSON.stringify(current.messages) !== JSON.stringify(row.review.messages) &&
        JSON.stringify(current.messages) === JSON.stringify(expected)
      )
        return {
          status: 'confirmed',
          reason: '已核对同一买家准确新增的卖家文字回显',
          evidence: {
            id: echo.id,
            observedAt: now(),
            description: '对应账号、页面和买家的新增卖家文字与批准正文完全一致',
          },
        }
      return { status: 'uncertain', reason: '未取得准确新增卖家文字回显，禁止重发' }
    }
    const ids = new Set(row.page.serverMessages.map((m) => m.id)),
      kind = p.action.kind === 'welcome-image' ? 'image' : 'video'
    const candidates = data.page.serverMessages.filter(
      (m) =>
        m.acknowledged &&
        !ids.has(m.id) &&
        m.uid === p.target.uid &&
        m.from === 'seller' &&
        m.senderId === data.page.sellerIdentity.senderId &&
        m.senderMallId === data.identity.mallId &&
        m.type === kind &&
        (!m.ts || m.ts >= (row.attemptedAt ?? p.preparedAt) - 5000),
    )
    for (const candidate of candidates)
      try {
        const body = await mediaLoader(candidate.content, p.action.kind)
        data.assert()
        if (
          body.mimeType === p.media?.mimeType &&
          body.bytes.length === p.media.sizeBytes &&
          digest(body.bytes) === p.media.sha256
        )
          return {
            status: 'confirmed',
            reason: '对应买家卖家服务器媒体消息与批准资源指纹一致',
            evidence: {
              id: candidate.id,
              observedAt: now(),
              description: '卖家服务器消息ID、目标买家、媒体类型、大小和SHA256全部一致',
            },
          }
      } catch {
        /* Transcoding or unreadable resources stay uncertain. */
      }
    return {
      status: 'uncertain',
      reason: '没有同买家卖家服务器消息ID与资源指纹一致的回显，禁止重发',
    }
  }
  const prepare = async (input: PreparePlatformOperationInput) => {
    if (records.get(input.runId)?.attempted)
      return { status: 'blocked' as const, reason: '此项已执行或待核对，不能重新准备或重发' }
    for (const [id, row] of records)
      if (!row.attempted && row.prepared.expiresAt <= now()) records.delete(id)
    const action = automationActionSchema.parse(input.action),
      data = await readData(input, input.uid, true),
      source = data.native.nativeReview?.known ? ('native' as const) : ('dom' as const),
      current = await review(data, input.uid, source)
    data.assert()
    const fingerprint = pageReviewFingerprint(current),
      buyer = data.page.buyers.find((b) => b.uid === input.uid)
    if (
      !buyer ||
      !fingerprint ||
      current.uid !== input.uid ||
      current.page !== data.page.pageId ||
      data.page.activeUid !== input.uid ||
      (['welcome-text', 'welcome-image', 'welcome-video'].includes(action.kind) &&
        (!data.page.hookReady || !data.page.composer.present || !data.page.composer.empty))
    )
      return {
        status: 'blocked' as const,
        reason: '请打开准确买家并等待原生消息/输入框可用；不会覆盖人工草稿',
      }
    const expiresAt = now() + (action.kind === 'welcome-video' ? 300000 : 600000)
    const plan = await nativePlan(
      data,
      action,
      input.uid,
      current.page,
      input.runId,
      undefined,
      expiresAt,
    )
    if (plan && (plan.status !== 'ready' || !plan.proof))
      return { status: 'blocked' as const, reason: plan.reason ?? '原生目标尚不可批准' }
    let media: { bytes: Uint8Array; mimeType: string } | undefined
    if (action.kind === 'welcome-image' || action.kind === 'welcome-video') {
      if (
        !(action.kind === 'welcome-image' ? data.page.mediaInputs.image : !!plan?.proof) ||
        !data.page.serverMessages.some((m) => m.from === 'seller' && m.acknowledged)
      )
        return {
          status: 'blocked' as const,
          reason: '缺少唯一原生媒体入口或明确服务器确认的卖家消息结构',
        }
      media = await mediaLoader(action.url, action.kind)
      data.assert()
      if (
        !media.bytes.length ||
        media.bytes.length > mediaLimit(action.kind) ||
        !mimeTypes[action.kind].includes(media.mimeType)
      )
        return { status: 'blocked' as const, reason: '媒体真实类型或大小不受支持' }
      const count = [...records.entries()].reduce(
        (sum, [id, row]) => sum + (id === input.runId ? 0 : (row.bytes?.length ?? 0)),
        0,
      )
      if (count + media.bytes.length > 100 * 1024 * 1024)
        return { status: 'blocked' as const, reason: '待批准媒体缓存已满，请先处理已有事项' }
    }
    if (records.size >= 500) return { status: 'blocked' as const, reason: '操作证据缓存已满' }
    const prepared = preparedPlatformOperationSchema.parse({
      runId: input.runId,
      action,
      target: {
        storeId: input.storeId,
        storeName: data.identity.storeName,
        uid: input.uid,
        buyerName: buyer.name,
        accountId: data.accountId,
        pageId: current.page,
      },
      basis: {
        accountId: data.accountId,
        pageId: current.page,
        conversationRevision: digest(fingerprint),
        storeRevision: data.storeRevision,
      },
      preparedAt: now(),
      expiresAt,
      ...(media
        ? {
            media: {
              mimeType: media.mimeType,
              sizeBytes: media.bytes.length,
              sha256: digest(media.bytes),
            },
          }
        : {}),
      ...(plan
        ? {
            operationLabel: plan.label,
            ...(action.kind === 'transfer'
              ? { agentName: plan.agents?.find((a) => a.agentId === action.agentId)?.name }
              : { orderLabel: plan.orderLabel }),
          }
        : {}),
      evidence: [
        {
          id: `pdd-page:${data.storeRevision.slice(0, 16)}`,
          observedAt: now(),
          description: '已核对注册店铺与平台身份、准确买家及当前原生消息；批准前再次复核',
        },
      ],
    })
    records.set(input.runId, {
      prepared: structuredClone(prepared),
      review: current,
      page: data.page,
      bytes: media?.bytes,
      nativeProof: plan?.proof,
      reviewSource: source,
    })
    return { status: 'ready' as const, prepared }
  }
  return {
    read: (scope) =>
      scoped(scope.storeId, async () => {
        const data = await readData(scope),
          ready =
            data.page.hookReady &&
            data.page.composer.present &&
            (!data.store.aiEnabled || !!options.withExclusive),
          mediaEvidence = data.page.serverMessages.some(
            (m) => m.from === 'seller' && m.acknowledged,
          )
        let list = agents.get(scope.storeId)
        if (list?.accountId !== data.accountId) list = undefined
        if (data.page.activeUid && (!list || now() - list.at > 60000)) {
          const result = nativePlanSchema.parse(
            await native(data.wc, {
              mode: 'read-transfer',
              uid: data.page.activeUid,
              pageId: data.page.pageId,
            }),
          )
          data.assert()
          if (result.status === 'ready') {
            list = { accountId: data.accountId, at: now(), rows: result.agents ?? [] }
            agents.set(scope.storeId, list)
          } else {
            list = undefined
            agents.delete(scope.storeId)
          }
        }
        let library = videoLibraries.get(scope.storeId)
        if (library?.accountId !== data.accountId) library = undefined
        if (data.page.activeUid && (!library || now() - library.at > 60000)) {
          try {
            const result = videoLibrarySchema.parse(
              await data.wc.executeJavaScript(
                buildPddVideoScript({
                  mode: 'read',
                  uid: data.page.activeUid,
                  pageId: data.page.pageId,
                }),
                true,
              ),
            )
            data.assert()
            library = {
              accountId: data.accountId,
              at: now(),
              assets:
                result.status === 'ready' && result.pageId === data.page.pageId
                  ? result.assets
                      .filter(
                        (a) =>
                          a.sizeBytes <= mediaLimit('welcome-video') &&
                          a.url.length <= 4096 &&
                          (!a.id || a.id.length <= 128),
                      )
                      .map((a) => ({
                        ...(a.id ? { id: a.id } : {}),
                        name: a.name || '已审核视频素材',
                        kind: 'video' as const,
                        url: a.url,
                        sizeBytes: a.sizeBytes,
                      }))
                  : [],
            }
            videoLibraries.set(scope.storeId, library)
          } catch {
            library = undefined
            videoLibraries.delete(scope.storeId)
          }
        }
        return {
          storeId: scope.storeId,
          storeName: data.identity.storeName,
          accountId: data.accountId,
          observedAt: now(),
          buyers: data.page.buyers,
          orders: data.native.orders,
          agents: list?.rows ?? [],
          mediaAssets: library?.assets ?? [],
          capabilities: [
            {
              kind: 'welcome-text' as const,
              available: ready,
              reason:
                data.store.aiEnabled && !options.withExclusive
                  ? '请先暂停此店铺AI，再逐项批准平台操作'
                  : ready
                    ? '原生逐字DOM文字入口可读，准确卖家回显后才确认'
                    : '原生输入框不可写或消息尚未载入',
            },
            {
              kind: 'welcome-image' as const,
              available: ready && data.page.mediaInputs.image && mediaEvidence,
              reason: '需唯一原生图片入口和准确卖家服务器媒体回显；逐项批准',
            },
            {
              kind: 'welcome-video' as const,
              available: ready && !!library?.assets.length && mediaEvidence,
              reason: '需原生已审核视频素材及准确卖家服务器媒体回显',
            },
            {
              kind: 'payment-reminder' as const,
              available: !!data.native.orders.length,
              reason: data.native.orders.length
                ? '原生订单可读；在平台选择催支付条款后逐项批准'
                : '当前没有原生可核对待付款订单；不改发聊天文字',
            },
            {
              kind: 'transfer' as const,
              available: !!list?.rows.some((a) => a.canTransfer === true),
              reason: '原生当前可转接名单，在线未知；批准前重读，服务器回执后确认',
            },
          ],
        }
      }),
    observe: (scope) =>
      scoped(scope.storeId, async () => {
        const data = await readData(scope),
          events: ReceptionEvent[] = data.native.visitors
            .filter((v) => v.observedAt <= now() + 5000 && now() - v.observedAt <= 600000)
            .map((v) => ({
              type: 'visitor',
              id: v.sessionId,
              sessionId: v.sessionId,
              storeId: scope.storeId,
              uid: v.uid,
              observedAt: v.observedAt,
              messageCount: 0,
            }))
        for (const order of data.native.orders)
          events.push({
            type: 'unpaid-order',
            id: order.orderId,
            orderId: order.orderId,
            status: 'unpaid',
            storeId: scope.storeId,
            uid: order.uid,
            observedAt: now(),
          })
        const available =
          agents.get(scope.storeId)?.accountId === data.accountId
            ? agents
                .get(scope.storeId)!
                .rows.filter((a) => a.canTransfer === true || a.online === true)
            : []
        if (available.length)
          for (const request of data.native.transferRequests)
            if (request.observedAt <= now() + 5000 && now() - request.observedAt <= 600000)
              events.push({
                type: 'transfer-request',
                id: request.id,
                storeId: scope.storeId,
                uid: request.uid,
                observedAt: request.observedAt,
                availableAgentIds: available.map((a) => a.agentId),
              })
        return events
      }),
    prepare: (input) =>
      scoped(input.storeId, async () => {
        try {
          return await prepare(input)
        } catch (error) {
          return {
            status: 'blocked',
            reason:
              error instanceof Error && error.message.includes('暂停此店铺AI')
                ? error.message
                : '平台身份、原生目标或媒体校验失败，请重新只读采集',
          }
        }
      }),
    revalidate: (p) => scoped(p.target.storeId, () => validate(p)),
    execute: (p, guard) =>
      scoped(p.target.storeId, async () => {
        const row = records.get(p.runId)
        if (!row || row.attempted || !guard.isCurrent())
          return { status: 'failed', reason: '准备基线不存在、批准已消费或已失效，未执行' }
        const validation = await validate(p)
        if (validation.status !== 'valid' || !guard.isCurrent())
          return {
            status: 'failed',
            reason: validation.status === 'valid' ? '批准已失效' : validation.reason,
          }
        const data = context({ workspaceId: options.workspaceId, storeId: p.target.storeId }, true)
        row.attempted = true
        row.attemptedAt = now()
        try {
          if (p.action.kind === 'transfer' || p.action.kind === 'payment-reminder') {
            const request: PddNativeOperationInput = {
              mode: p.action.kind === 'transfer' ? 'execute-transfer' : 'execute-payment',
              runId: p.runId,
              uid: p.target.uid,
              pageId: p.basis.pageId,
              proof: row.nativeProof,
              expiresAt: p.expiresAt,
              timeoutMs: options.confirmationTimeoutMs,
              ...(p.action.kind === 'transfer'
                ? { agentId: p.action.agentId }
                : { orderId: p.action.orderId }),
            }
            const cancel = setInterval(() => {
              if (!guard.isCurrent())
                void native(data.wc, { mode: 'cancel', runId: p.runId }).catch(() => {})
            }, 100)
            try {
              const result = z
                .object({
                  status: z.enum(['confirmed', 'failed', 'uncertain']),
                  reason: z.string(),
                  evidenceId: z.string().optional(),
                })
                .parse(await native(data.wc, request))
              return result.status === 'confirmed' && result.evidenceId
                ? {
                    status: 'confirmed',
                    reason: result.reason,
                    evidence: {
                      id: result.evidenceId,
                      observedAt: now(),
                      description: result.reason,
                    },
                  }
                : result.status === 'confirmed'
                  ? { status: 'uncertain', reason: '原生成功缺少回执编号，须核对' }
                  : { status: result.status, reason: result.reason }
            } finally {
              clearInterval(cancel)
            }
          }
          if (p.action.kind === 'welcome-text') {
            const result = z.object({ ok: z.boolean() }).parse(
              await data.adapter.sendText(p.target.uid, p.action.text, {
                isCurrent: () => {
                  try {
                    data.assert()
                    return guard.isCurrent()
                  } catch {
                    return false
                  }
                },
              }),
            )
            return result.ok
              ? await inspect(row)
              : { status: 'uncertain', reason: '文字适配器未确认送达，须核对且不得重发' }
          }
          if (p.action.kind === 'welcome-video') {
            if (!guard.isCurrent()) return { status: 'failed', reason: '视频发送前批准已失效' }
            data.assert()
            const cancel = setInterval(() => {
              try {
                data.assert()
                if (guard.isCurrent()) return
              } catch {
                /* Cancellation continues in page. */
              }
              void data.wc
                .executeJavaScript(buildPddVideoScript({ mode: 'cancel', runId: p.runId }), true)
                .catch(() => {})
            }, 100)
            try {
              const result = z
                .object({
                  status: z.enum(['started', 'failure', 'uncertain']),
                  attempted: z.boolean(),
                  accepted: z.boolean(),
                  reason: z.string().optional(),
                })
                .parse(
                  await data.wc.executeJavaScript(
                    buildPddVideoScript({
                      mode: 'execute',
                      runId: p.runId,
                      uid: p.target.uid,
                      pageId: p.basis.pageId,
                      url: p.action.url,
                      proof: row.nativeProof,
                      expiresAt: p.expiresAt,
                      timeoutMs: options.confirmationTimeoutMs,
                    }),
                    true,
                  ),
                )
              delete row.bytes
              if (!result.attempted)
                return { status: 'failed', reason: result.reason ?? '原生视频素材入口未执行' }
              const deadline = Date.now() + (options.confirmationTimeoutMs ?? 10000)
              do {
                const checked = await inspect(row)
                if (checked.status === 'confirmed' || !guard.isCurrent() || Date.now() >= deadline)
                  return checked
                await new Promise<void>((resolve) => setTimeout(resolve, 250))
              } while (Date.now() < deadline)
              return {
                status: 'uncertain',
                reason: '原生视频已尝试，缺少准确卖家服务器回显，禁止重发',
              }
            } finally {
              clearInterval(cancel)
            }
          }
          if (!row.bytes || !p.media)
            return { status: 'failed', reason: '没有受控媒体资源，未执行' }
          if (!guard.isCurrent()) return { status: 'failed', reason: '媒体发送前批准已失效' }
          data.assert()
          const payload = {
            uid: p.target.uid,
            page: p.basis.pageId,
            review: row.review,
            reviewSource: row.reviewSource,
            sellerIdentity: row.page.sellerIdentity,
            mimeType: p.media.mimeType,
            filename: `lingtu-${p.media.sha256.slice(0, 16)}.${p.media.mimeType.split('/')[1].replace('jpeg', 'jpg')}`,
            base64: Buffer.from(row.bytes).toString('base64'),
            kind: p.action.kind === 'welcome-image' ? 'image' : 'video',
          }
          const uploaded = z
            .object({ attempted: z.boolean(), reason: z.string().optional() })
            .parse(
              await data.wc.executeJavaScript(
                `/*lingtu-pdd-operations:upload*/(${dispatchPddMediaUpload.toString()})(${JSON.stringify(payload)})`,
                true,
              ),
            )
          delete row.bytes
          if (!uploaded.attempted)
            return { status: 'failed', reason: uploaded.reason ?? '原生入口未接受媒体操作' }
          const deadline = Date.now() + (options.confirmationTimeoutMs ?? 10000)
          do {
            const result = await inspect(row)
            if (result.status === 'confirmed' || !guard.isCurrent() || Date.now() >= deadline)
              return result
            await new Promise<void>((resolve) => setTimeout(resolve, 250))
          } while (Date.now() < deadline)
          return { status: 'uncertain', reason: '媒体回显超时，禁止重发' }
        } catch {
          delete row.bytes
          return { status: 'uncertain', reason: '平台动作后的结果无法确定，请只读核对，禁止重发' }
        }
      }),
    inspect: (p) =>
      scoped(p.target.storeId, async () => {
        const row = records.get(p.runId)
        if (!row?.attempted || JSON.stringify(row.prepared) !== JSON.stringify(p))
          return {
            status: 'uncertain',
            reason: '缺少本次原始操作基线，请在原平台人工核对，不恢复批准',
          }
        try {
          return await inspect(row)
        } catch {
          return { status: 'uncertain', reason: '只读核对暂不可用，仍不可重发' }
        }
      }),
  }
}
