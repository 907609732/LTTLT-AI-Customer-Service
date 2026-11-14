export interface PddVideoScriptInput {
  mode: 'read' | 'prepare' | 'execute' | 'cancel'
  runId?: string
  uid?: string
  pageId?: string
  url?: string
  proof?: unknown
  expiresAt?: number
  timeoutMs?: number
}

export interface PddVideoAsset {
  id?: string
  name?: string
  url: string
  sizeBytes: number
  extension: string
  checkStatus: 2
}
export interface PddVideoReadResult {
  status: 'ready' | 'blocked'
  pageId: string
  assets: PddVideoAsset[]
  reason?: string
}
export interface PddVideoPrepareResult {
  status: 'ready' | 'blocked'
  pageId: string
  proof?: string
  label?: string
  reason?: string
}
export interface PddVideoExecuteResult {
  status: 'started' | 'failure' | 'uncertain'
  attempted: boolean
  /** The native callback means request acceptance, never message delivery. */
  accepted: boolean
  reason?: string
}
export type PddVideoScriptResult =
  | PddVideoReadResult
  | PddVideoPrepareResult
  | PddVideoExecuteResult
  | { status: 'cancelled' }

/** Keep all runtime definitions inside this function: its source runs in the platform page.
 * Native Vue methods own authentication and transport; no private HTTP is replayed here. */
async function pddNativeVideo(input: PddVideoScriptInput): Promise<PddVideoScriptResult> {
  type Row = Record<string, unknown>
  interface NativeVm {
    $options?: { name?: string }
    $isDestroyed?: boolean
    currentUid?: unknown
    videoList?: unknown
    $watch?(
      this: NativeVm,
      key: string,
      callback: (value: unknown, previous: unknown) => void,
    ): () => void
    queryVideoList?(this: NativeVm): unknown
    sendVideo?(this: NativeVm, item: Row, callback: () => void): unknown
  }
  interface Snapshot {
    uid: string
    pageId: string
    messages: string
    identity: string
  }
  interface Lease {
    vm: NativeVm
    proof: string
    snapshot: Snapshot
    asset: PddVideoAsset
    expiresAt: number
    attempted: boolean
    accepted: boolean
    cancelled: boolean
  }
  interface State {
    leases: Map<string, Lease>
    cancelled: Map<string, number>
    pending: Map<string, Set<() => void>>
    refreshing: boolean
  }
  const object = (value: unknown): Row => (value && typeof value === 'object' ? (value as Row) : {})
  const norm = (value: unknown) =>
    String(value ?? '')
      .trim()
      .replace(/-\d+-reply$/, '')
      .replace(/-0-all$/, '')
  const view = window as unknown as {
    __pddWeb?: { currentUid?(): string; reviewHistory?(uid: string): unknown }
    __lingtuPddVideoState?: State
  }
  const state = (view.__lingtuPddVideoState ??= {
    leases: new Map(),
    cancelled: new Map(),
    pending: new Map(),
    refreshing: false,
  })
  const runId = typeof input.runId === 'string' && input.runId.length <= 200 ? input.runId : ''
  const now = Date.now()
  // Retain recent attempt/cancellation tombstones; bound page memory without enabling retries.
  for (const [id, lease] of state.leases)
    if (lease.expiresAt < now - 300_000) state.leases.delete(id)
  for (const [id, time] of state.cancelled) if (time < now - 600_000) state.cancelled.delete(id)
  if (input.mode === 'cancel') {
    if (runId) {
      state.cancelled.set(runId, now)
      const lease = state.leases.get(runId)
      if (lease) lease.cancelled = true
      for (const cancel of state.pending.get(runId) ?? []) cancel()
    }
    return { status: 'cancelled' }
  }
  const candidates = Array.from(document.querySelectorAll('.middle-panel'))
    .map((element) => (element as Element & { __vue__?: NativeVm }).__vue__)
    .filter((vm): vm is NativeVm => !!vm && vm.$options?.name === 'middlePanel' && !vm.$isDestroyed)
  const vm = candidates.length === 1 ? candidates[0] : undefined
  const snapshot = (): Snapshot | undefined => {
    try {
      const hook = view.__pddWeb
      const uid = norm(hook?.currentUid?.())
      const review = object(hook?.reviewHistory?.(uid))
      if (
        !vm ||
        vm.$isDestroyed ||
        !uid ||
        norm(vm.currentUid) !== uid ||
        review.known !== true ||
        norm(review.uid) !== uid
      )
        return
      if (
        typeof review.page !== 'string' ||
        !review.page ||
        !Array.isArray(review.messages) ||
        review.messages.length > 1000
      )
        return
      const messages = JSON.stringify(review.messages)
      if (messages.length > 1_000_000) return
      const root = document.querySelector('#app') as
        | (Element & { __vue__?: { $store?: { state?: Row } } })
        | null
      const own = object(root?.__vue__?.$store?.state?.userInfo)
      const fields = [own.id, own.mall_id ?? object(own.mall).mall_id, own.cs_uid].map((value) =>
        String(value ?? '').trim(),
      )
      if (fields.some((value) => !value || value.length > 128)) return
      return { uid, pageId: review.page, messages, identity: JSON.stringify(fields) }
    } catch {
      return
    }
  }
  const initial = snapshot()
  const pageId = initial?.pageId ?? ''
  const blocked = (reason: string): PddVideoReadResult | PddVideoPrepareResult =>
    input.mode === 'read'
      ? { status: 'blocked', pageId, assets: [], reason }
      : { status: 'blocked', pageId, reason }
  const failure = (reason: string, attempted = false, accepted = false): PddVideoExecuteResult => ({
    status: attempted ? 'uncertain' : 'failure',
    attempted,
    accepted,
    reason,
  })
  const sameTarget = (expected: Snapshot, checkMessages = true) => {
    const current = snapshot()
    return (
      !!current &&
      current.uid === expected.uid &&
      current.pageId === expected.pageId &&
      current.identity === expected.identity &&
      (!checkMessages || current.messages === expected.messages)
    )
  }
  const emptyComposer = () => {
    const composer = document.querySelector<HTMLTextAreaElement>('#replyTextarea')
    return !!composer && !composer.disabled && !composer.readOnly && !composer.value.trim()
  }
  const notCancelled = () => !runId || !state.cancelled.has(runId)
  const validExpiry = () =>
    input.expiresAt === undefined ||
    (Number.isFinite(input.expiresAt) && input.expiresAt > Date.now())
  const nativeAsset = (value: unknown): PddVideoAsset | undefined => {
    const item = object(value)
    if (
      item.check_status !== 2 ||
      item.file_type !== 'video' ||
      item.is_deleted === true ||
      item.is_deleted === 1 ||
      item.is_deleted === '1' ||
      Number(object(item.info).status) === 1 ||
      typeof item.size !== 'number' ||
      !Number.isSafeInteger(item.size) ||
      item.size <= 0 ||
      item.size >= 314572800 ||
      typeof item.url !== 'string' ||
      item.url.length > 10000 ||
      typeof item.extension !== 'string'
    )
      return
    try {
      const url = new URL(item.url)
      if (url.protocol !== 'https:' || url.username || url.password) return
    } catch {
      return
    }
    const id =
      typeof item.id === 'string' || typeof item.id === 'number'
        ? String(item.id).slice(0, 200)
        : undefined
    const name = typeof item.name === 'string' ? item.name.slice(0, 200) : undefined
    return {
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      url: item.url,
      sizeBytes: item.size,
      extension: item.extension.slice(0, 20),
      checkStatus: 2,
    }
  }
  const uniqueAsset = (rows: unknown[], url: string) => {
    const matches = rows.filter((item) => object(item).url === url)
    if (matches.length !== 1) return
    const asset = nativeAsset(matches[0])
    if (asset) return { asset, item: object(matches[0]) }
  }
  const timeout = Number.isFinite(input.timeoutMs)
    ? Math.max(10, Math.min(input.timeoutMs!, 10000))
    : 5000
  const watchCancellation = (cancel: () => void) => {
    if (!runId) return () => {}
    const pending = state.pending.get(runId) ?? new Set<() => void>()
    pending.add(cancel)
    state.pending.set(runId, pending)
    return () => {
      pending.delete(cancel)
      if (!pending.size) state.pending.delete(runId)
    }
  }
  const freshLibrary = async (): Promise<unknown[]> => {
    if (!vm?.$watch || !vm.queryVideoList || state.refreshing)
      throw Error('视频素材库正在读取或原生查询不可用')
    state.refreshing = true
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const previous = vm.videoList
        let finished = false
        let unwatch = () => {}
        let removeCancellation = () => {}
        const finish = (value?: unknown[]) => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          unwatch()
          removeCancellation()
          if (value) resolve(value)
          else reject(Error('未获得本次原生视频查询的新结果'))
        }
        const timer = setTimeout(() => finish(), timeout)
        removeCancellation = watchCancellation(() => finish())
        try {
          unwatch = vm.$watch!.call(vm, 'videoList', (value) => {
            // queryVideoList assigns a new mapped array only after its native request resolves.
            if (value !== previous && value === vm.videoList && Array.isArray(value)) finish(value)
          })
          vm.queryVideoList!.call(vm)
        } catch {
          finish()
        }
      })
    } finally {
      state.refreshing = false
    }
  }

  if (input.mode === 'execute') {
    const lease = state.leases.get(runId)
    if (lease?.attempted) return failure('此批准已调用原生发送，不会重复调用', true, lease.accepted)
    if (
      !vm ||
      !initial ||
      !lease ||
      !input.proof ||
      lease.proof !== input.proof ||
      lease.vm !== vm ||
      lease.cancelled ||
      !notCancelled() ||
      !validExpiry() ||
      lease.expiresAt <= Date.now() ||
      input.uid !== lease.snapshot.uid ||
      input.pageId !== lease.snapshot.pageId ||
      input.url !== lease.asset.url ||
      !sameTarget(lease.snapshot) ||
      !emptyComposer() ||
      !Array.isArray(vm.videoList) ||
      vm.videoList.length > 100 ||
      typeof vm.sendVideo !== 'function'
    )
      return failure('视频批准、目标会话、素材或人工草稿已变化')
    const selected = uniqueAsset(vm.videoList, lease.asset.url)
    if (!selected || JSON.stringify(selected.asset) !== JSON.stringify(lease.asset))
      return failure('已批准视频的审核状态或素材字段已变化')
    // Set the tombstone before entering native code; throws and absent callbacks must not retry.
    lease.attempted = true
    return new Promise<PddVideoExecuteResult>((resolve) => {
      let finished = false
      let removeCancellation = () => {}
      const finish = (accepted: boolean, reason?: string) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        removeCancellation()
        lease.accepted = accepted
        resolve({
          status: accepted ? 'started' : 'uncertain',
          attempted: true,
          accepted,
          ...(reason ? { reason } : {}),
        })
      }
      const timer = setTimeout(
        () => finish(false, '原生发送已调用，尚无受理回调；须核对服务器消息'),
        timeout,
      )
      removeCancellation = watchCancellation(() =>
        finish(false, '原生调用后批准已取消，发送结果须复核'),
      )
      try {
        vm.sendVideo!.call(vm, selected.item, () => {
          if (
            !notCancelled() ||
            lease.cancelled ||
            lease.expiresAt <= Date.now() ||
            !sameTarget(lease.snapshot, false)
          )
            finish(false, '原生回调到达时批准或目标已变化')
          else finish(true)
        })
      } catch {
        finish(false, '原生调用后发生异常，发送结果不确定')
      }
    })
  }

  if (
    !vm ||
    !initial ||
    (input.uid !== undefined && input.uid !== initial.uid) ||
    (input.pageId !== undefined && input.pageId !== initial.pageId)
  )
    return blocked('原生视频目标会话或页面不可确认')
  if (
    input.mode === 'prepare' &&
    (!runId ||
      typeof input.url !== 'string' ||
      !input.url ||
      !notCancelled() ||
      !validExpiry() ||
      !emptyComposer() ||
      typeof vm.sendVideo !== 'function')
  )
    return blocked('视频准备缺少有效批准目标，或人工草稿已存在')
  let rows: unknown[]
  try {
    rows = await freshLibrary()
  } catch {
    return blocked('原生视频素材库未产生新查询结果，请稍后重试')
  }
  if (!sameTarget(initial) || !notCancelled() || rows.length > 100)
    return blocked('读取视频期间目标或批准已变化')
  if (input.mode === 'read')
    return {
      status: 'ready',
      pageId,
      assets: rows.map(nativeAsset).filter((asset): asset is PddVideoAsset => !!asset),
    }
  if (!emptyComposer() || !validExpiry()) return blocked('读取视频后批准已过期或人工草稿已变化')
  const selected = uniqueAsset(rows, input.url!)
  if (!selected) return blocked('未找到唯一、审核通过且小于300MiB的已入库视频')
  const previous = state.leases.get(runId)
  if (
    previous &&
    (previous.attempted ||
      previous.cancelled ||
      previous.expiresAt <= Date.now() ||
      previous.vm !== vm ||
      previous.snapshot.messages !== initial.messages ||
      previous.snapshot.uid !== initial.uid ||
      previous.snapshot.pageId !== initial.pageId ||
      previous.snapshot.identity !== initial.identity ||
      JSON.stringify(previous.asset) !== JSON.stringify(selected.asset) ||
      (input.proof !== undefined && input.proof !== previous.proof))
  )
    return blocked('此批准已失效或素材已变化，需要重新审核')
  if (!previous && (input.proof !== undefined || state.leases.size >= 100))
    return blocked('视频批准状态不可复用，请重新准备')
  const lease = previous ?? {
    vm,
    proof: crypto.randomUUID(),
    snapshot: initial,
    asset: selected.asset,
    expiresAt: Math.min(input.expiresAt ?? Date.now() + 60000, Date.now() + 300000),
    attempted: false,
    accepted: false,
    cancelled: false,
  }
  if (input.expiresAt !== undefined) lease.expiresAt = Math.min(lease.expiresAt, input.expiresAt)
  state.leases.set(runId, lease)
  return {
    status: 'ready',
    pageId,
    proof: lease.proof,
    label: `发送已审核视频「${selected.asset.name || '视频素材'}」`,
  }
}

export function buildPddVideoScript(input: PddVideoScriptInput): string {
  return `/*lingtu-pdd-video*/(${pddNativeVideo.toString()})(${JSON.stringify(input)})`
}
