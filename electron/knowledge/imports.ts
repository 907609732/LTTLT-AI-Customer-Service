import { randomUUID } from 'node:crypto'
import {
  importDigest as digest,
  originalFileType,
  partIdentity,
  sourcePartIdentity,
  invalidateRemovedParts,
  type ImportDocument,
} from './import-identity'
import type { KnowledgeRepository } from './repository'
import type {
  KnowledgeJob,
  KnowledgeAsset,
  KnowledgeSourceRef,
  KnowledgeSourceLocator,
  ProductBinding,
} from '../../src/shared/contracts/knowledge'
import type { KnowledgeImportPreview } from '../../src/shared/contracts/knowledge-pipeline'
import { parseKnowledgeFile, type ParsedPart } from './sources'
export const ORIGINAL_LABEL = '原文件：'
interface ImportItem {
  key: string
  partKey: string
  label: string
  text: string
  locator: KnowledgeSourceLocator
  assetIds: string[]
  product?: ParsedPart['product']
  intent?: ParsedPart['intent']
  chat?: boolean
  bindingId?: string
  duplicate: boolean
}
interface ImportPlan {
  storeId: string
  sourceRefs: KnowledgeSourceRef[]
  bindings: ProductBinding[]
  membership: string
  items: ImportItem[]
  documents: ImportDocument[]
}
export function createKnowledgeImporter(options: {
  repository: KnowledgeRepository
  assertStore?(storeId: string): void
  assertActive(): void
  changed(): void
}) {
  const repo = options.repository
  const workers = new Map<string, AbortController>()
  let closed = false
  const membership = (storeId: string) =>
    JSON.stringify(
      repo
        .listBindings()
        .filter((b) => b.storeId === storeId)
        .map((b) => [b.id, b.revision])
        .sort(),
    )
  function active(storeId: string, bindingId?: string) {
    if (closed) throw Error('导入服务已关闭')
    options.assertActive()
    options.assertStore?.(storeId)
    if (bindingId) {
      const b = repo.getBinding(bindingId)
      if (!b?.active || b.storeId !== storeId) throw Error('目标商品已变化')
    }
  }
  function registerFiles(
    storeId: string,
    files: { name: string; bytes: Uint8Array }[],
    bindingId?: string,
  ) {
    active(storeId, bindingId)
    return repo.transaction(() =>
      files.map((file) => {
        const asset = repo.addAsset(file.bytes, {
          name: file.name,
          mimeType: originalFileType(file.name).mimeType,
        })
        const old = repo
          .listSources({ storeId })
          .find(
            (s) =>
              s.label === ORIGINAL_LABEL + file.name &&
              s.locator.assetId === asset.id &&
              s.bindingId === bindingId,
          )
        const sourceId =
          old?.id ??
          repo.saveSource({
            storeId,
            bindingId,
            kind: 'document',
            label: ORIGINAL_LABEL + file.name,
            text: '原始文件已登记；尚未解析。',
            locator: { assetId: asset.id },
            assetIds: [asset.id],
          }).id
        if (!repo.getMetadata(`original-file:${sourceId}`))
          repo.setMetadata(`original-file:${sourceId}`, JSON.stringify(originalFileType(file.name)))
        return sourceId
      }),
    )
  }
  async function preview(
    storeId: string,
    sourceIds: string[],
    bindingIds: string[],
  ): Promise<KnowledgeImportPreview> {
    active(storeId)
    if (!sourceIds.length) throw Error('请选择资料')
    const bindings = bindingIds.map((id) => {
      active(storeId, id)
      return repo.getBinding(id)!
    })
    const before = membership(storeId),
      refs: KnowledgeSourceRef[] = [],
      items: ImportItem[] = [],
      documents: ImportDocument[] = [],
      warnings: string[] = [],
      encodings: string[] = []
    const seen = new Set<string>()
    for (const id of new Set(sourceIds)) {
      const source = repo.getSource(id)
      if (
        !source ||
        source.storeId !== storeId ||
        !source.label.startsWith(ORIGINAL_LABEL) ||
        !source.locator.assetId
      )
        throw Error('不是当前店铺登记的原始文件')
      refs.push({ sourceId: id, revision: source.revision })
      const original = repo.row<KnowledgeAsset>('assets', source.locator.assetId)!
      const fileMetadata = repo.getMetadata(`original-file:${source.id}`)
      const file = fileMetadata
        ? (JSON.parse(fileMetadata) as { name: string; extension: string; mimeType: string })
        : originalFileType(source.label.slice(ORIGINAL_LABEL.length))
      const parsed = await parseKnowledgeFile(file.name, repo.readAsset(original.id))
      const targets = bindings.length ? bindings.map((b) => b.id) : [source.bindingId ?? '']
      const productRows = parsed.parts.some((part) => Boolean(part.product))
      const documentKey = digest([
        storeId,
        file.name,
        productRows ? ['csv-products'] : [...targets].sort(),
      ])
      const document: ImportDocument = {
        key: documentKey,
        label: file.name,
        targets,
        productRows,
        lease: repo.getMetadata(`import-document:${documentKey}`),
        partKeys: [],
      }
      if (documents.some((existing) => existing.key === document.key))
        throw Error('同一目标不能同时导入多个同名文件；请改名或分别确认替换')
      documents.push(document)
      if (repo.listSources({ storeId }).some((s) => s.label === file.name && !s.removed))
        warnings.push(
          `${file.name}：同名资料按位置更新；被修改或移除位置的已审核引用将失效，旧版本仍可核对。`,
        )
      active(storeId)
      warnings.push(...parsed.warnings)
      encodings.push(`${source.label.slice(ORIGINAL_LABEL.length)}：${parsed.encoding}`)
      for (const part of parsed.parts) {
        const assetIds = [original.id]
        if (part.image)
          assetIds.push(
            repo.addAsset(part.image.bytes, {
              name: `${file.name}图像`,
              mimeType: part.image.mimeType,
            }).id,
          )
        let targets: (ProductBinding | undefined)[] = part.product
          ? [undefined]
          : bindings.length
            ? bindings
            : [source.bindingId ? (repo.getBinding(source.bindingId) ?? undefined) : undefined]
        if (part.intent?.productIds.length) {
          targets = repo
            .listBindings()
            .filter(
              (b) =>
                b.storeId === storeId &&
                !b.skuId &&
                part.intent!.productIds.includes(b.productId) &&
                (!bindings.length || bindings.some((v) => v.id === b.id)),
            )
          if (targets.length !== new Set(part.intent.productIds).size)
            throw Error('意图JSON中有未映射到所选店铺/商品的编号，请先建立对应商品或修正导入文件')
        }
        for (const target of targets) {
          const partKey = partIdentity(
            file.name,
            part.product?.productId ?? target?.id,
            part.locator,
            Boolean(part.product),
          )
          document.partKeys.push(partKey)
          if (target && !document.targets.includes(target.id)) document.targets.push(target.id)
          const key = digest([
            file.name,
            storeId,
            original.id,
            part.locator,
            part.product?.productId,
            target?.id ?? '',
            part.intent ?? null,
          ])
          const previous = repo
            .listSources({ storeId })
            .find(
              (source) =>
                source.locator.assetId &&
                sourcePartIdentity(repo, source, Boolean(part.product)) === partKey,
            )
          const duplicate =
            seen.has(key) ||
            Boolean(
              previous &&
                !previous.removed &&
                previous.locator.assetId === original.id &&
                previous.text === part.text,
            )
          seen.add(key)
          items.push({
            key,
            partKey,
            label: source.label.slice(ORIGINAL_LABEL.length),
            text: part.text,
            locator: {
              ...part.locator,
              assetId: original.id,
              ...(part.image ? { imageAssetId: assetIds.at(-1)! } : {}),
            },
            assetIds,
            product: part.product,
            intent: part.intent,
            chat: part.chat,
            bindingId: target?.id,
            duplicate,
          })
        }
      }
    }
    if (
      before !== membership(storeId) ||
      refs.some((r) => repo.getSource(r.sourceId)?.revision !== r.revision)
    )
      throw Error('预览期间资料或商品已变化，请重试')
    const productRows = new Set<string>()
    for (const item of items)
      if (item.product) {
        if (productRows.has(item.product.productId)) item.duplicate = true
        productRows.add(item.product.productId)
      }
    const previewId = randomUUID(),
      plan: ImportPlan = {
        storeId,
        sourceRefs: refs,
        bindings,
        membership: before,
        items,
        documents,
      }
    repo.setMetadata(`import-preview:${previewId}`, JSON.stringify(plan))
    return {
      previewId,
      files: refs.length,
      parts: items.length,
      duplicates: items.filter((i) => i.duplicate).length,
      encodings,
      warnings,
      rows: items.map((item) => ({
        label: item.label,
        target: item.product
          ? `商品 ${item.product.productId} · ${item.product.title}`
          : item.bindingId
            ? `商品 ${repo.getBinding(item.bindingId)?.productId}`
            : '本店通用问答/资料',
        locator: item.locator,
        text: item.text.slice(0, 2000),
        duplicate: item.duplicate,
        kind: item.intent ? 'intent' : item.product ? 'product' : item.chat ? 'chat' : 'document',
      })),
    }
  }
  interface ImportCheckpoint {
    index: number
    completed: number
    skipped: number
    membership: string
    sourceIds: string[]
  }
  function validate(plan: ImportPlan, currentMembership = plan.membership) {
    active(plan.storeId)
    if (
      (plan.documents ?? []).some(
        (d) => repo.getMetadata(`import-document:${d.key}`) !== d.lease,
      ) ||
      currentMembership !== membership(plan.storeId) ||
      plan.sourceRefs.some((ref) => repo.getSource(ref.sourceId)?.revision !== ref.revision)
    )
      throw Error('预览资料或目标商品已变化，请重新预览')
  }
  function getJob(storeId: string, id: string) {
    active(storeId)
    const job = repo.getJob(id)
    if (!job || job.kind !== 'import' || job.storeId !== storeId) throw Error('导入任务不属于本店')
    return job
  }
  function apply(previewId: string, storeId: string) {
    active(storeId)
    const raw = repo.getMetadata(`import-preview:${previewId}`)
    if (!raw) throw Error('导入预览不存在，请重新选择')
    const plan = JSON.parse(raw) as ImportPlan
    if (plan.storeId !== storeId) throw Error('导入店铺不符')
    validate(plan)
    const job = repo.transaction(() => {
      for (const document of plan.documents ?? []) {
        document.lease = randomUUID()
        repo.setMetadata(`import-document:${document.key}`, document.lease)
      }
      return repo.createJob({ kind: 'import', storeId, payload: { ...plan } })
    })
    repo.setMetadata(`import-preview:${previewId}`, '')
    schedule(job.id)
    return { jobId: job.id }
  }
  function schedule(id: string) {
    const controller = new AbortController()
    workers.set(id, controller)
    setTimeout(() => {
      void run(id, controller).finally(() => {
        if (workers.get(id) === controller) workers.delete(id)
      })
    }, 0)
  }
  async function run(id: string, controller: AbortController) {
    try {
      let job = repo.getJob(id)!
      const plan = job.payload as unknown as ImportPlan
      let cp = (job.checkpoint.index === undefined
        ? { index: 0, completed: 0, skipped: 0, membership: plan.membership, sourceIds: [] }
        : job.checkpoint) as unknown as ImportCheckpoint
      if (!['queued', 'running'].includes(job.status) || controller.signal.aborted || closed) return
      validate(plan, cp.membership)
      repo.transaction(() => invalidateRemovedParts(repo, plan.storeId, plan.documents ?? []))
      job = repo.updateJob(id, {
        expectedRevision: job.revision,
        status: 'running',
        checkpoint: { ...cp },
        progress: { completed: cp.index, total: plan.items.length },
      })
      while (cp.index < plan.items.length) {
        if (closed || controller.signal.aborted) return
        validate(plan, cp.membership)
        const item = plan.items[cp.index]!
        repo.transaction(() => {
          if (item.duplicate) cp.skipped++
          else {
            let binding = item.bindingId ? repo.getBinding(item.bindingId) : null
            if (item.product) {
              binding =
                repo
                  .listBindings()
                  .find(
                    (b) =>
                      b.storeId === plan.storeId &&
                      b.productId === item.product!.productId &&
                      !b.skuId,
                  ) ?? null
              if (!binding)
                binding = repo.bindProduct({
                  storeId: plan.storeId,
                  productId: item.product.productId,
                  title: item.product.title,
                  canonicalId: repo.saveCanonical({ title: item.product.title }).id,
                })
            }
            const previous = repo
              .listSources({ storeId: plan.storeId })
              .find(
                (source) =>
                  source.locator.assetId &&
                  sourcePartIdentity(repo, source, Boolean(item.product)) ===
                    (item.partKey ??
                      partIdentity(
                        item.label,
                        item.product?.productId ?? binding?.id,
                        item.locator,
                        Boolean(item.product),
                      )),
              )
            const source = repo.saveSource({
              id: previous?.id,
              expectedRevision: previous?.revision,
              storeId: plan.storeId,
              bindingId: binding?.id,
              kind: item.chat ? 'chat' : item.assetIds.length > 1 ? 'image' : 'document',
              label: item.label,
              text: item.text,
              locator: item.locator,
              assetIds: item.assetIds,
            })
            if (item.intent)
              repo.saveDraft({
                scope: binding
                  ? { kind: 'binding', bindingId: binding.id }
                  : { kind: 'store', storeId: plan.storeId },
                question: item.intent.question,
                answer: item.intent.answer,
                keywords: item.intent.keywords,
                origin: 'import',
                sourceRefs: [{ sourceId: source.id, revision: source.revision }],
              })
            repo.setMetadata(`import-item:${item.key}`, source.id)
            cp.sourceIds.push(source.id)
            cp.completed++
          }
          cp = { ...cp, index: cp.index + 1, membership: membership(plan.storeId) }
          job = repo.updateJob(id, {
            expectedRevision: job.revision,
            checkpoint: { ...cp },
            progress: { completed: cp.index, total: plan.items.length },
          })
        })
        options.changed()
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      if (!closed && !controller.signal.aborted)
        repo.updateJob(id, {
          expectedRevision: job.revision,
          status: 'succeeded',
          error: cp.skipped ? `${cp.skipped}项重复已跳过` : '',
        })
    } catch (cause) {
      if (!closed && !controller.signal.aborted) {
        const job = repo.getJob(id)!
        repo.updateJob(id, {
          expectedRevision: job.revision,
          status: 'failed',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    } finally {
      if (!closed) options.changed()
    }
  }
  function stop(storeId: string, id: string, cancel = false) {
    const job = getJob(storeId, id)
    workers.get(id)?.abort()
    if (!['succeeded', 'cancelled'].includes(job.status))
      repo.updateJob(id, {
        expectedRevision: job.revision,
        status: cancel ? 'cancelled' : 'paused',
      })
    options.changed()
    return { jobId: id }
  }
  function resume(storeId: string, id: string) {
    const job = getJob(storeId, id)
    if (workers.has(id)) throw Error('导入仍在停止，请稍后')
    if (!['paused', 'failed'].includes(job.status)) throw Error('此任务不能继续')
    const plan = job.payload as unknown as ImportPlan
    validate(
      plan,
      typeof job.checkpoint.membership === 'string' ? job.checkpoint.membership : plan.membership,
    )
    repo.updateJob(id, { expectedRevision: job.revision, status: 'queued', error: '' })
    schedule(id)
    return { jobId: id }
  }
  return {
    registerFiles,
    preview,
    apply,
    resume,
    pause: (s: string, id: string) => stop(s, id),
    cancel: (s: string, id: string) => stop(s, id, true),
    removeStore(storeId: string) {
      for (const job of repo
        .rows<KnowledgeJob>('jobs')
        .filter(
          (j) =>
            j.kind === 'import' &&
            j.storeId === storeId &&
            !['succeeded', 'cancelled'].includes(j.status),
        ))
        stop(storeId, job.id, true)
    },
    dispose() {
      if (closed) return
      for (const controller of workers.values()) controller.abort()
      for (const job of repo
        .rows<KnowledgeJob>('jobs')
        .filter((j) => j.kind === 'import' && ['queued', 'running'].includes(j.status)))
        repo.updateJob(job.id, {
          expectedRevision: job.revision,
          status: 'paused',
          error: '应用退出，等待手动继续',
        })
      closed = true
    },
  }
}
