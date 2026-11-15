import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { KnowledgeRepository } from './index'
import type { KnowledgePipelineHandler } from './pipeline'
import { createCollectorMaterials, type CollectedImage } from './collector-materials'
import type { createPddLearningProvider } from '../pdd-learning-provider'
import {
  platformLearningIdentitySchema,
  platformLearningPageSchema,
  platformLearningProductSchema,
  type PlatformLearningIdentity,
} from '../../src/shared/contracts/platform-learning'
import {
  knowledgePipelineInputSchema,
  type KnowledgeCatalogPage,
  type KnowledgePipelineInput,
} from '../../src/shared/contracts/knowledge-pipeline'
import type { KnowledgeJob, ProductBinding } from '../../src/shared/contracts/knowledge'
export interface KnowledgeCollectorOptions {
  repository: KnowledgeRepository
  provider: Pick<ReturnType<typeof createPddLearningProvider>, 'identity' | 'collectProducts'>
  readImage?(input: {
    identity: PlatformLearningIdentity
    url: string
    signal: AbortSignal
  }): Promise<{ bytes: Uint8Array; mimeType: string }>
  assertActive(): void
  getStore(id: string): { id: string; platform: string } | undefined
  changed?(): void
}
const range = { maxPages: 1000, maxRecords: 10000, productStatus: 'on-sale' as const }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const leaseSchema = z.object({ id: z.string(), revision: z.number().int().positive() }).strict()
const recordSchema = z
  .object({ item: platformLearningProductSchema, cursor: z.string().nullable() })
  .strict()
const payloadSchema = z
  .object({
    version: z.literal(1),
    identity: platformLearningIdentitySchema,
    records: z.array(recordSchema).max(1000),
    productIds: z.array(z.string()).max(1000),
    leases: z.array(leaseSchema),
    scope: z.string(),
  })
  .strict()
type RecordItem = z.infer<typeof recordSchema>
interface Scope {
  token: string
  identity: PlatformLearningIdentity
  search: string
  records: Map<string, RecordItem>
  next: string | null
  pageCount: number
  total: number | null
  complete: boolean
  reliable: boolean
  expires: number
  busy: boolean
}
/** Owns read-only collect jobs. Other pipeline kinds are deliberately delegated by the dispatcher. */
export function createKnowledgeCollector(
  options: KnowledgeCollectorOptions,
): KnowledgePipelineHandler {
  const repo = options.repository,
    materials = createCollectorMaterials(repo)
  const scopes = new Map<string, Scope>(),
    cursors = new Map<string, { scope: string; native: string }>()
  const controllers = new Map<string, AbortController>(),
    timers = new Map<string, ReturnType<typeof setTimeout>>()
  const removed = new Set<string>()
  let closed = false
  const thumbnailAssets = new Map<string, string>()
  const thumbnailLoads = new Map<
    string,
    { storeId: string; controller: AbortController; promise: Promise<{ assetId: string }> }
  >()
  function check(storeId: string, signal?: AbortSignal) {
    if (closed || removed.has(storeId)) throw Error('采集任务或店铺已关闭')
    options.assertActive()
    signal?.throwIfAborted()
    const store = options.getStore(storeId)
    if (!store || store.id !== storeId || store.platform !== 'pdd-web')
      throw Error('拼多多店铺不存在或平台采集未接入')
  }
  async function verify(identity: PlatformLearningIdentity, signal?: AbortSignal) {
    check(identity.storeId, signal)
    const current = await options.provider.identity(identity.storeId)
    check(identity.storeId, signal)
    if (digest(current) !== digest(identity)) throw Error('平台账号或店铺身份已变化')
  }
  function jobFor(storeId: string, id: string) {
    check(storeId)
    const job = repo.getJob(id)
    if (!job || job.storeId !== storeId || !['collect', 'daily-check'].includes(job.kind))
      throw Error('采集任务不属于此店铺')
    return job
  }
  function writeJob(job: KnowledgeJob, patch: Parameters<KnowledgeRepository['updateJob']>[1]) {
    check(job.storeId)
    const result = repo.updateJob(job.id, patch)
    options.changed?.()
    return result
  }
  function leasesFor(storeId: string, ids: string[]) {
    return repo
      .listBindings()
      .filter((row) => row.storeId === storeId && ids.includes(row.productId))
      .map(({ id, revision }) => ({ id, revision }))
  }
  function assertLeases(storeId: string, leases: z.infer<typeof leaseSchema>[]) {
    check(storeId)
    for (const lease of leases) {
      const binding = repo.getBinding(lease.id)
      if (!binding?.active || binding.storeId !== storeId || binding.revision !== lease.revision)
        throw Error('商品绑定已变化或解除，采集未保存')
    }
  }
  function assertSelectionLease(job: KnowledgeJob, payload: z.infer<typeof payloadSchema>) {
    const saved = z.array(leaseSchema).parse(repo.getJob(job.id)?.checkpoint.bindingLeases ?? [])
    assertLeases(job.storeId, payload.leases)
    assertLeases(job.storeId, saved)
    const allowed = new Set([...payload.leases, ...saved].map((lease) => lease.id))
    if (
      repo
        .listBindings()
        .some(
          (binding) =>
            binding.storeId === job.storeId &&
            payload.productIds.includes(binding.productId) &&
            !allowed.has(binding.id),
        )
    )
      throw Error('商品或SKU绑定集合已变化，采集未保存')
  }
  async function readPage(
    identity: PlatformLearningIdentity,
    cursor: string | null,
    signal: AbortSignal,
    catalogOnly: boolean,
    productIds?: string[],
  ) {
    check(identity.storeId, signal)
    const raw = await options.provider.collectProducts({
      identity,
      range,
      cursor,
      signal,
      catalogOnly,
      productIds,
      quiet: true,
    })
    check(identity.storeId, signal)
    const page = platformLearningPageSchema.parse(raw)
    if (digest(page.identity) !== digest(identity)) throw Error('采集页面身份不一致')
    const items = page.items.map((item) => platformLearningProductSchema.parse(item))
    if (new Set(items.map((item) => item.id)).size !== items.length) throw Error('目录商品编号重复')
    await verify(identity, signal)
    return { ...page, items }
  }
  async function catalog(
    input: Extract<KnowledgePipelineInput, { action: 'catalog' }>,
  ): Promise<KnowledgeCatalogPage> {
    check(input.storeId)
    for (const [token, scope] of scopes) if (scope.expires < Date.now()) scopes.delete(token)
    for (const [token, cursor] of cursors) if (!scopes.has(cursor.scope)) cursors.delete(token)
    const signal = new AbortController().signal
    let scope: Scope,
      native: string | null = null
    if (input.cursor) {
      const saved = cursors.get(input.cursor)
      const previous = saved && scopes.get(saved.scope)
      if (
        !saved ||
        !previous ||
        previous.identity.storeId !== input.storeId ||
        previous.search !== (input.search ?? '')
      )
        throw Error('目录游标或筛选已失效，请重新读取')
      scope = previous
      native = saved.native
      if (scope.next !== native) throw Error('目录页已经推进，请重新读取')
    } else {
      const identity = await options.provider.identity(input.storeId)
      check(input.storeId)
      for (const load of thumbnailLoads.values())
        if (load.storeId === input.storeId) load.controller.abort()
      scope = {
        token: randomUUID(),
        identity,
        search: input.search ?? '',
        records: new Map(),
        next: null,
        pageCount: 0,
        total: null,
        complete: false,
        reliable: true,
        expires: Date.now() + 30 * 60000,
        busy: false,
      }
      // Bound snapshots to the current store; the previous manager selection cannot silently change scope.
      for (const [token, previous] of scopes)
        if (previous.identity.storeId === input.storeId) scopes.delete(token)
      scopes.set(scope.token, scope)
    }
    if (scope.busy) throw Error('此目录正在读取，请稍后重试')
    scope.busy = true
    try {
      await verify(scope.identity, signal)
      const page = await readPage(scope.identity, native, signal, true)
      if (scope.pageCount > 0 && scope.total !== null && scope.total !== page.total)
        throw Error('目录总量已变化，请重新读取')
      const first = scope.pageCount === 0
      if (first) scope.total = page.total ?? null
      if (page.items.some((item) => scope.records.has(item.id)))
        throw Error('目录分页返回重复商品，未声称完整范围')
      for (const item of page.items) scope.records.set(item.id, { item, cursor: native })
      scope.pageCount++
      scope.reliable &&= page.rangeComplete === true
      scope.next = page.nextCursor
      if (scope.pageCount >= range.maxPages || scope.records.size >= 10000) {
        if (scope.next) scope.reliable = false
        scope.next = null
      }
      scope.complete =
        scope.reliable &&
        page.exhausted &&
        scope.total !== null &&
        scope.records.size === scope.total
      const matching = [...scope.records.values()].filter(
        ({ item }) =>
          !scope.search ||
          `${item.title} ${item.id}`.toLocaleLowerCase().includes(scope.search.toLocaleLowerCase()),
      )
      const items = page.items.filter((item) =>
        matching.some((record) => record.item.id === item.id),
      )
      const nextCursor = scope.next ? randomUUID() : null
      if (nextCursor) cursors.set(nextCursor, { scope: scope.token, native: scope.next! })
      return {
        identityVersion: digest(scope.identity),
        scopeToken: scope.token,
        items: items.map((item) => ({
          productId: item.id,
          title: item.title,
          ...(item.merchantCode !== undefined ? { merchantCode: item.merchantCode } : {}),
          hasThumbnail: Boolean(item.thumbnailUrl),
        })),
        nextCursor,
        total: scope.search ? (scope.complete ? matching.length : null) : scope.total,
        complete: scope.complete,
        range: `在售商品；${page.scope}；已核对${scope.records.size}/${scope.total ?? '未知'}；${scope.search ? '标题/编号筛选仅覆盖已核对页；' : ''}${scope.complete ? '目录总量与全部页一致' : '范围尚未完整，全部筛选采集不可用'}`,
      }
    } catch (cause) {
      scope.complete = false
      scope.reliable = false
      throw cause
    } finally {
      scope.busy = false
    }
  }
  function currentJob(id: string, controller: AbortController) {
    const job = repo.getJob(id)
    if (!job) throw Error('采集任务不存在')
    check(job.storeId, controller.signal)
    if (controllers.get(id) !== controller || job.status !== 'running')
      throw Error('采集任务已暂停或取消')
    assertLeases(job.storeId, z.array(leaseSchema).parse(job.checkpoint.bindingLeases ?? []))
    return job
  }
  async function catalogThumbnail(
    input: Extract<KnowledgePipelineInput, { action: 'catalog-thumbnail' }>,
  ) {
    check(input.storeId)
    const scope = scopes.get(input.scopeToken)
    const valid = () => {
      check(input.storeId)
      if (
        !scope ||
        scopes.get(input.scopeToken) !== scope ||
        scope.expires < Date.now() ||
        scope.identity.storeId !== input.storeId ||
        digest(scope.identity) !== input.identityVersion
      )
        throw Error('目录已改变，请重新读取缩略图')
    }
    valid()
    const item = scope!.records.get(input.productId)?.item
    if (!item?.thumbnailUrl || !options.readImage) throw Error('此商品暂无已核对的缩略图')
    const key = `${input.scopeToken}:${input.productId}`
    await verify(scope!.identity)
    valid()
    const cached = thumbnailAssets.get(key)
    if (cached) return { assetId: cached }
    const loading = thumbnailLoads.get(key)
    if (loading) return loading.promise
    const controller = new AbortController()
    const promise = (async () => {
      const image = await options.readImage!({
        identity: scope!.identity,
        url: item.thumbnailUrl!,
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()
      valid()
      await verify(scope!.identity, controller.signal)
      valid()
      if (!image.bytes.byteLength || image.bytes.byteLength > 2 * 1024 * 1024)
        throw Error('目录缩略图超过2MB或为空')
      const asset = repo.transaction(() => {
        valid()
        controller.signal.throwIfAborted()
        return repo.addAsset(image.bytes, {
          name: `目录缩略图-${input.productId}`,
          mimeType: image.mimeType,
        })
      })
      thumbnailAssets.set(key, asset.id)
      if (thumbnailAssets.size > 512) thumbnailAssets.delete(thumbnailAssets.keys().next().value!)
      return { assetId: asset.id }
    })()
    thumbnailLoads.set(key, { storeId: input.storeId, controller, promise })
    try {
      return await promise
    } finally {
      thumbnailLoads.delete(key)
    }
  }
  function schedule(job: KnowledgeJob) {
    if (timers.has(job.id) || controllers.has(job.id)) throw Error('采集任务仍在停止，请稍后恢复')
    const timer = setTimeout(() => {
      timers.delete(job.id)
      const controller = new AbortController()
      controllers.set(job.id, controller)
      void run(job.id, controller).finally(() => {
        if (controllers.get(job.id) === controller) controllers.delete(job.id)
      })
    }, 0)
    timers.set(job.id, timer)
  }
  async function run(id: string, controller: AbortController) {
    try {
      let job = repo.getJob(id)!
      if (!job || job.status !== 'queued') return
      check(job.storeId, controller.signal)
      job = writeJob(job, { expectedRevision: job.revision, status: 'running', error: '' })
      const payload = payloadSchema.parse(job.payload)
      await verify(payload.identity, controller.signal)
      currentJob(id, controller)
      assertSelectionLease(job, payload)
      let records = payload.records
      if (!records.length && payload.productIds.length) {
        // Existing-binding refresh still follows verified native catalog pages, never guessed detail URLs.
        records = []
        let cursor: string | null = null
        const seen = new Set<string>()
        for (let count = 0; count < range.maxPages; count++) {
          const page = await readPage(payload.identity, cursor, controller.signal, true)
          currentJob(id, controller)
          for (const item of page.items) {
            if (seen.has(item.id)) throw Error('目录分页重复，刷新未继续')
            seen.add(item.id)
            if (payload.productIds.includes(item.id)) records.push({ item, cursor })
          }
          if (records.length === payload.productIds.length) break
          if (!page.nextCursor) break
          cursor = page.nextCursor
        }
        if (records.length !== payload.productIds.length)
          throw Error('所选绑定商品未在在售目录中全部找到')
      }
      const issues = z.array(z.string()).parse(job.checkpoint.issues ?? [])
      const done = z
        .array(z.string())
        .parse(job.checkpoint.completedIds ?? [])
        .filter((productId) => !issues.some((issue) => issue.startsWith(`${productId}：`)))
      for (const record of records) {
        if (done.includes(record.item.id)) continue
        currentJob(id, controller)
        assertSelectionLease(job, payload)
        const page = await readPage(payload.identity, record.cursor, controller.signal, false, [
          record.item.id,
        ])
        currentJob(id, controller)
        assertSelectionLease(job, payload)
        if (page.items.length !== 1 || page.items[0]?.id !== record.item.id)
          throw Error('所选目录商品已变化')
        const item = page.items[0],
          images: CollectedImage[] = [],
          assets: { url: string; bytes: Uint8Array; mimeType: string }[] = []
        let imageBytes = 0
        if (item.platformDetail) {
          for (const url of item.platformDetail.images) {
            currentJob(id, controller)
            assertSelectionLease(job, payload)
            try {
              if (!options.readImage) throw Error('图片字节采集尚未接入')
              if (imageBytes >= 50 * 1024 * 1024)
                throw Error('本商品图片累计达到50MB，本次保留未覆盖证据')
              const image = await options.readImage({
                identity: payload.identity,
                url,
                signal: controller.signal,
              })
              currentJob(id, controller)
              assertSelectionLease(job, payload)
              if (
                image.bytes.byteLength > 10 * 1024 * 1024 ||
                imageBytes + image.bytes.byteLength > 50 * 1024 * 1024
              )
                throw Error('图片累计大小超过本次采集边界')
              imageBytes += image.bytes.byteLength
              assets.push({ url, ...image })
            } catch (cause) {
              currentJob(id, controller)
              assertSelectionLease(job, payload)
              images.push({
                url,
                error: cause instanceof Error ? cause.message.slice(0, 200) : '图片读取失败',
              })
            }
          }
        }
        await verify(payload.identity, controller.signal)
        job = currentJob(id, controller)
        assertSelectionLease(job, payload)
        repo.transaction(() => {
          currentJob(id, controller)
          assertSelectionLease(job, payload)
          for (const asset of assets) {
            const registered = repo.addAsset(asset.bytes, {
              name: `平台商品-${item.id}`,
              mimeType: asset.mimeType,
            })
            images.push({ url: asset.url, assetId: registered.id })
          }
          let binding: ProductBinding = materials.writeList(
            job.storeId,
            {
              id: item.id,
              title: item.title,
              description: item.description,
              specifications: item.specifications,
              sourceUrl: item.sourceUrl ?? 'https://mms.pinduoduo.com/goods/goods_list',
            },
            page.capturedAt,
            { scope: page.scope, pageCursor: record.cursor },
          )
          if (item.platformDetail) {
            if (item.platformDetail.productId !== item.id) throw Error('详情与目录商品编号不同')
            binding = materials.write(job.storeId, item.platformDetail, images, {
              scope: page.scope,
              pageCursor: record.cursor,
            }).binding
          }
          done.push(item.id)
          const limitations: string[] = []
          if (
            !item.platformDetail ||
            item.platformDetail.detailStatus !== 'complete' ||
            page.rangeComplete !== true
          )
            limitations.push(`${item.id}：${page.scope}`)
          if (images.some((image) => image.error))
            limitations.push(
              `${item.id}：${images.filter((image) => image.error).length}张图片未取得字节`,
            )
          for (let index = issues.length - 1; index >= 0; index--)
            if (issues[index]!.startsWith(`${item.id}：`)) issues.splice(index, 1)
          issues.push(...limitations)
          // Completion may shrink during partial retries; the durable identity ledger must not.
          // Preserve earlier products' exact leases and extend only this transaction's product family.
          const checkpoints = new Map(
            z
              .array(leaseSchema)
              .parse(job.checkpoint.bindingLeases ?? [])
              .map((lease) => [lease.id, lease]),
          )
          for (const lease of leasesFor(job.storeId, [item.id])) checkpoints.set(lease.id, lease)
          writeJob(job, {
            expectedRevision: job.revision,
            checkpoint: {
              completedIds: done,
              issues,
              bindingLeases: [...checkpoints.values()],
              lastBindingId: binding.id,
            },
            progress: { completed: done.length, total: records.length },
          })
        })
      }
      job = currentJob(id, controller)
      writeJob(job, {
        expectedRevision: job.revision,
        status: issues.length ? 'needs-confirmation' : 'succeeded',
        error: issues.length ? `部分采集：${issues.slice(0, 5).join('；')}`.slice(0, 4000) : '',
      })
    } catch (cause) {
      // Cancellation/disposal never converts an intentionally stopped job into success or a late failure.
      try {
        if (closed || controller.signal.aborted) return
        const job = repo.getJob(id)
        if (!job || job.status !== 'running') return
        writeJob(job, {
          expectedRevision: job.revision,
          status: 'paused',
          error: (cause instanceof Error ? cause.message : '平台采集未完成').slice(0, 4000),
        })
      } catch {
        /* Account disposal may already have closed the writer. No late mutation is allowed. */
      }
    }
  }
  async function start(input: Extract<KnowledgePipelineInput, { action: 'start' }>) {
    check(input.storeId)
    let identity: PlatformLearningIdentity,
      records: RecordItem[] = [],
      productIds: string[] = [],
      scopeText = '明确已绑定商品刷新'
    const selection = input.catalog
    if (selection) {
      const scope = scopes.get(selection.scopeToken)
      if (
        !scope ||
        scope.expires < Date.now() ||
        scope.identity.storeId !== input.storeId ||
        digest(scope.identity) !== selection.identityVersion
      )
        throw Error('目录身份或范围已失效')
      const matching = [...scope.records.values()].filter(
        ({ item }) =>
          !scope.search ||
          `${item.title} ${item.id}`.toLocaleLowerCase().includes(scope.search.toLocaleLowerCase()),
      )
      if (selection.allMatching) {
        if (!scope.complete || selection.total !== matching.length || matching.length > 1000)
          throw Error('全部筛选目录范围或总量尚未核对，请明确选择已验证商品')
        records = matching
      } else {
        productIds = [...new Set(selection.productIds)]
        records = productIds.map((id) => {
          const record = matching.find((record) => record.item.id === id)
          if (!record) throw Error('所选商品不在当前已验证目录范围')
          return record
        })
      }
      identity = scope.identity
      productIds = records.map((record) => record.item.id)
      scopeText = `在售目录；筛选${scope.search || '全部'}；明确选择${records.length}项`
    } else {
      const bindings = (input.bindingIds ?? []).map((id) => repo.getBinding(id))
      if (bindings.some((binding) => !binding?.active || binding.storeId !== input.storeId))
        throw Error('商品绑定无效')
      productIds = [...new Set(bindings.map((binding) => binding!.productId))]
      // Use an already verified main-owned catalog identity; a new catalog is an explicit prerequisite.
      const scope = [...scopes.values()].find(
        (scope) => scope.identity.storeId === input.storeId && scope.expires > Date.now(),
      )
      if (!scope && input.kind !== 'daily-check') throw Error('请先读取此店铺在售目录核对身份')
      identity =
        input.kind === 'daily-check'
          ? await options.provider.identity(input.storeId)
          : scope!.identity
      check(input.storeId)
    }
    if (!productIds.length || productIds.length > 1000) throw Error('请明确选择1至1000个商品')
    const payload = payloadSchema.parse({
      version: 1,
      identity,
      records,
      productIds,
      leases: leasesFor(input.storeId, productIds),
      scope: scopeText,
    })
    const job = repo.createJob({
      storeId: input.storeId,
      kind: input.kind === 'daily-check' ? 'daily-check' : 'collect',
      payload,
    })
    options.changed?.()
    schedule(job)
    return { jobId: job.id }
  }
  function stop(storeId: string, id: string, status: 'paused' | 'cancelled') {
    const job = jobFor(storeId, id)
    if (['succeeded', 'cancelled'].includes(job.status)) throw Error('采集任务已经结束')
    controllers.get(id)?.abort()
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    writeJob(job, { expectedRevision: job.revision, status })
    return { jobId: id }
  }
  return {
    handles(input) {
      return (
        input.action === 'catalog' ||
        input.action === 'catalog-thumbnail' ||
        (input.action === 'start' && ['collect', 'daily-check'].includes(input.kind)) ||
        (['pause', 'resume', 'cancel'].includes(input.action) &&
          'jobId' in input &&
          ['collect', 'daily-check'].includes(repo.getJob(input.jobId)?.kind ?? ''))
      )
    },
    async capabilities(storeId) {
      try {
        check(storeId)
        await options.provider.identity(storeId)
        check(storeId)
        return {
          catalog: true,
          collect: !repo.readOnly,
          dailyCheck: !repo.readOnly,
          reason: repo.readOnly
            ? '知识迁移失败，采集写入已暂停，请核对迁移诊断'
            : '仅采集原料；学习与审核发布独立执行',
        }
      } catch (cause) {
        return {
          catalog: false,
          collect: false,
          reason: cause instanceof Error ? cause.message : '平台未就绪',
        }
      }
    },
    async request(raw) {
      const input = knowledgePipelineInputSchema.parse(raw)
      if (input.action === 'catalog') return catalog(input)
      if (input.action === 'catalog-thumbnail') return catalogThumbnail(input)
      if (input.action === 'start' && ['collect', 'daily-check'].includes(input.kind))
        return start(input)
      if (input.action === 'pause' || input.action === 'cancel')
        return stop(input.storeId, input.jobId, input.action === 'cancel' ? 'cancelled' : 'paused')
      if (input.action === 'resume') {
        const job = jobFor(input.storeId, input.jobId)
        if (!['paused', 'needs-confirmation', 'failed'].includes(job.status))
          throw Error('只有已暂停或部分采集任务可以恢复')
        if (job.kind === 'daily-check' && job.payload.pendingDaily === true) {
          const result = await start({
            action: 'start',
            kind: 'daily-check',
            storeId: job.storeId,
            bindingIds: z.array(z.string()).parse(job.payload.bindingIds),
          })
          writeJob(job, {
            expectedRevision: job.revision,
            status: 'cancelled',
            error: '已由人工重新核对并继续检查',
          })
          return result
        }
        payloadSchema.parse(job.payload)
        if (controllers.has(job.id) || timers.has(job.id))
          throw Error('采集任务仍在停止，请稍后恢复')
        const resumed = writeJob(job, {
          expectedRevision: job.revision,
          status: 'queued',
          error: '',
        })
        schedule(resumed)
        return { jobId: job.id }
      }
      throw Error('此采集操作未接入')
    },
    removeStore(storeId) {
      for (const load of thumbnailLoads.values())
        if (load.storeId === storeId) load.controller.abort()
      for (const [id, controller] of controllers)
        if (repo.getJob(id)?.storeId === storeId) controller.abort()
      for (const [id, timer] of timers)
        if (repo.getJob(id)?.storeId === storeId) {
          clearTimeout(timer)
          timers.delete(id)
        }
      for (const [token, scope] of scopes)
        if (scope.identity.storeId === storeId) scopes.delete(token)
      removed.add(storeId)
    },
    dispose() {
      if (closed) return
      for (const load of thumbnailLoads.values()) load.controller.abort()
      thumbnailLoads.clear()
      thumbnailAssets.clear()
      for (const [id, controller] of controllers) {
        controller.abort()
        const job = repo.getJob(id)
        if (job?.status === 'running')
          try {
            writeJob(job, { expectedRevision: job.revision, status: 'paused' })
          } catch {
            /* Closing account cannot accept writes. */
          }
      }
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      controllers.clear()
      scopes.clear()
      cursors.clear()
      closed = true
    },
  }
}
