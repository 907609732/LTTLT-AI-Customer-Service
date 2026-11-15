import { knowledgePipelineInputSchema } from '@/shared/contracts/knowledge-pipeline'
import { getKnowledgeBridge } from '@/shared/platform/knowledge'
import { getBackendBridge } from '@/shared/platform/backend'
import type {
  KnowledgeCommand,
  KnowledgeQuery,
  KnowledgeQueryResults,
  KnowledgeTrial,
} from '@/shared/contracts/knowledge-client'
import type {
  KnowledgeDraftInput,
  KnowledgeVersion,
  KnowledgeEntry,
  KnowledgeResolveInput,
} from '@/shared/contracts/knowledge'
import type {
  KnowledgePipelineInput,
  KnowledgePipelineResults,
} from '@/shared/contracts/knowledge-pipeline'
export async function openKnowledgeManager(storeId: string) {
  const bridge = getKnowledgeBridge(),
    backend = getBackendBridge()
  if (!bridge || !backend) throw Error('知识库需要桌面版；浏览器仅供预览')
  const snapshot = await backend.snapshot()
  await bridge.open({ workspaceId: snapshot.workspaceId, storeId })
}
export function createKnowledgeClient(workspaceId: string) {
  const bridge = getKnowledgeBridge()
  const request = (input: Parameters<NonNullable<typeof bridge>['request']>[0]) => {
    if (!bridge) return Promise.reject(Error('知识库需要桌面版；浏览器仅供预览'))
    return bridge.request(input)
  }
  return {
    recommendations(bindingId: string) {
      return request({ workspaceId, operation: 'recommendations', bindingId }) as Promise<
        {
          canonical: import('@/shared/contracts/knowledge').CanonicalProduct
          reasons: string[]
          score: number
        }[]
      >
    },
    entryHistory(entryId: string) {
      return request({ workspaceId, operation: 'entry-history', entryId }) as Promise<
        { version: KnowledgeVersion; reviewed: boolean }[]
      >
    },
    deleteFamily(input: {
      canonicalId: string
      expectedRevision: number
      bindings: { id: string; expectedRevision: number }[]
    }) {
      return request({ workspaceId, operation: 'delete-family', ...input })
    },
    export(storeId: string, format: 'csv' | 'json', canonicalId?: string) {
      return request({
        workspaceId,
        operation: 'export',
        storeId,
        format,
        canonicalId,
      }) as Promise<{ text: string; count: number; message: string }>
    },
    reassociate(input: import('@/shared/contracts/knowledge-client').KnowledgeReassociateInput) {
      return request({ workspaceId, operation: 'reassociate-product', input }) as Promise<{
        bindings: import('@/shared/contracts/knowledge').ProductBinding[]
      }>
    },
    query<T extends KnowledgeQuery>(query: T): Promise<KnowledgeQueryResults[T['type']]> {
      return request({ workspaceId, operation: 'query', query }) as Promise<
        KnowledgeQueryResults[T['type']]
      >
    },
    general(page: import('@/shared/contracts/knowledge').KnowledgePageInput) {
      return request({ workspaceId, operation: 'general-entries', page }) as Promise<
        import('@/shared/contracts/knowledge').KnowledgePage<KnowledgeEntry>
      >
    },
    command(command: KnowledgeCommand) {
      return request({ workspaceId, operation: 'command', command })
    },
    saveDraft(draft: KnowledgeDraftInput) {
      return request({
        workspaceId,
        operation: 'command',
        command: { type: 'save-draft', draft },
      }) as Promise<KnowledgeVersion>
    },
    publish(entry: KnowledgeVersion) {
      return request({
        workspaceId,
        operation: 'command',
        command: {
          type: 'publish',
          review: {
            entryId: entry.id,
            expectedDraftRevision: entry.revision,
            expectedSourceRevisions: Object.fromEntries(
              entry.sourceRefs.map((ref) => [ref.sourceId, ref.revision]),
            ),
          },
        },
      }) as Promise<KnowledgeEntry & { affectedBindings: unknown[] }>
    },
    trial(input: KnowledgeResolveInput) {
      return request({ workspaceId, operation: 'trial', input }) as Promise<KnowledgeTrial>
    },
    asset(assetId: string) {
      return request({ workspaceId, operation: 'asset', assetId }) as Promise<string>
    },
    sourceHistory(sourceId: string) {
      return request({ workspaceId, operation: 'source-history', sourceId }) as Promise<
        import('@/shared/contracts/knowledge').KnowledgeSource[]
      >
    },
    pipeline<T extends KnowledgePipelineInput>(
      input: T,
    ): Promise<KnowledgePipelineResults[T['action']]> {
      return request({
        workspaceId,
        operation: 'pipeline',
        input: knowledgePipelineInputSchema.parse(input),
      }) as Promise<KnowledgePipelineResults[T['action']]>
    },
    backup(canonicalId?: string) {
      return request({ workspaceId, operation: 'backup', canonicalId }) as Promise<
        import('@/shared/contracts/knowledge').KnowledgeBackupManifest & { directory: string }
      >
    },
    restorePreview() {
      return request({ workspaceId, operation: 'restore-preview' }) as Promise<
        import('@/shared/contracts/knowledge-client').KnowledgeRestorePreview | null
      >
    },
    restore(token: string) {
      return request({ workspaceId, operation: 'restore', token }) as Promise<{
        workspaceId: string
        recovered: boolean
        message: string
        context: import('@/shared/contracts/knowledge-client').KnowledgeWindowContext
      }>
    },
    context: () => bridge?.context(),
    onContext: bridge?.onContext,
    onCloseRequest: bridge?.onCloseRequest,
    hide: () => bridge?.hide(workspaceId),
  }
}
