import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { KnowledgeSource, KnowledgeSourceLocator } from '../../src/shared/contracts/knowledge'
import type { KnowledgeRepository } from './repository'
export const importDigest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
// A file name at the same selected destination denotes a replacement document. Bytes are versions,
// never identity. Original registrations remain immutable and retain their own file metadata.
export interface ImportDocument {
  key: string
  label: string
  targets: string[]
  productRows: boolean
  lease: string | null
  partKeys: string[]
}
export function logicalPosition(locator: KnowledgeSourceLocator) {
  return Object.entries(locator)
    .filter(([key]) => !['assetId', 'imageAssetId'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
}
export function partIdentity(
  label: string,
  target: string | undefined,
  locator: KnowledgeSourceLocator,
  productRow = false,
) {
  return importDigest([label, target ?? '', productRow ? [] : logicalPosition(locator)])
}
export function originalFileType(name: string) {
  const extension = extname(name).toLowerCase()
  const mimeType =
    (
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  return { name, extension, mimeType }
}
export function documentSources(
  repo: KnowledgeRepository,
  storeId: string,
  document: ImportDocument,
) {
  return repo
    .listSources({ storeId })
    .filter(
      (source) =>
        source.label === document.label &&
        source.locator.assetId &&
        (document.productRows || document.targets.includes(source.bindingId ?? '')),
    )
}
export function sourcePartIdentity(
  repo: KnowledgeRepository,
  source: KnowledgeSource,
  productRows: boolean,
) {
  const target =
    productRows && source.bindingId
      ? repo.getBinding(source.bindingId)?.productId
      : source.bindingId
  return partIdentity(source.label, target, source.locator, productRows)
}
export function invalidateRemovedParts(
  repo: KnowledgeRepository,
  storeId: string,
  documents: ImportDocument[],
) {
  for (const document of documents) {
    const retained = new Set<string>()
    for (const source of documentSources(repo, storeId, document)) {
      const key = sourcePartIdentity(repo, source, document.productRows)
      const current = document.partKeys.includes(key) && !retained.has(key)
      retained.add(key)
      if (source.removed || current) continue
      repo.saveSource({
        id: source.id,
        expectedRevision: source.revision,
        storeId: source.storeId,
        bindingId: source.bindingId,
        kind: source.kind,
        label: source.label,
        text: source.text,
        locator: source.locator,
        assetIds: source.assetIds,
        removed: true,
      })
    }
  }
}
