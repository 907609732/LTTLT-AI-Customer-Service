import { ref, type Ref } from 'vue'
import type {
  KnowledgeClearPreview,
  KnowledgeRestorePreview,
  KnowledgeWindowContext,
} from '@/shared/contracts/knowledge-client'
import { createKnowledgeClient } from './manager-service'

/**
 * 备份/恢复/清空是唯一会替换整个知识库上下文的流程，因此单独持有预览与
 * restoreLease。普通读取继续用 manager 注入的受租约保护 client()；
 * restore/clear 成功后工作区会被替换，必须使用未套旧租约 guard 的原始
 * createKnowledgeClient，且只有 owner 应用新上下文后才算成功。
 */
export function useKnowledgeMaintenance(options: {
  client: () => Pick<
    ReturnType<typeof createKnowledgeClient>,
    'backup' | 'restorePreview' | 'clearPreview'
  >
  workspace: Ref<string>
  storeId: Ref<string>
  currentStoreName: () => string | undefined
  captureLease: () => { revision: number; workspaceId: string; storeId: string }
  leaseRevision: () => number
  contextRevision: () => number
  runtimeWorkspaceId: () => string
  isDisposed: () => boolean
  assertCaptured: (revision: number, workspaceId: string, storeId: string) => void
  closeEditor: () => Promise<void>
  applyReplacementContext: (context: KnowledgeWindowContext) => Promise<void>
  notice: Ref<string>
}) {
  const clearScope = ref<'store' | 'account'>('store'),
    clearPreview = ref<KnowledgeClearPreview>(),
    clearConfirmation = ref(''),
    restorePreview = ref<KnowledgeRestorePreview>()
  let restoreLease:
    | {
        workspaceId: string
        storeId: string
        revision: number
        contextRevision: number
      }
    | undefined

  function clearRestorePreview() {
    restorePreview.value = undefined
    restoreLease = undefined
  }

  async function backup(canonicalId?: string) {
    const result = await options.client().backup(canonicalId)
    options.notice.value = `${result.scope?.kind === 'store' ? `店铺「${options.currentStoreName() || result.scope.storeId}」备份` : result.scope?.kind === 'family' ? `同款全部店铺/SKU备份（${result.scope.storeIds.length}店，${result.scope.bindingIds.length}个绑定；含完整原件）` : '全库一致快照备份'}完成：${result.directory}`
  }

  async function backupStore() {
    const shop = options.storeId.value,
      name = options.currentStoreName() || shop
    if (!shop) throw Error('请先选择店铺')
    const result = await options.client().backup(undefined, shop)
    options.notice.value = `店铺「${name}」备份完成：${result.directory}`
  }

  async function chooseRestore() {
    await options.closeEditor()
    const lease = options.captureLease(),
      context = options.contextRevision()
    const preview = await options.client().restorePreview()
    if (!preview) return
    options.assertCaptured(lease.revision, lease.workspaceId, lease.storeId)
    if (preview.targetStoreId && preview.targetStoreId !== lease.storeId)
      throw Error('所选本店备份属于其他店铺，请重新选择')
    restorePreview.value = preview
    restoreLease = {
      workspaceId: lease.workspaceId,
      storeId: lease.storeId,
      revision: lease.revision,
      contextRevision: context,
    }
  }

  async function chooseStoreRestore() {
    const shop = options.storeId.value
    if (!shop) throw Error('请先选择店铺')
    const lease = options.captureLease(),
      context = options.contextRevision()
    await options.closeEditor()
    options.assertCaptured(lease.revision, lease.workspaceId, lease.storeId)
    const preview = await options.client().restorePreview(shop)
    if (!preview) return
    options.assertCaptured(lease.revision, lease.workspaceId, lease.storeId)
    if (preview.targetStoreId !== shop)
      throw Error('本店恢复预览目标已变化，请重新选择当前店铺备份')
    restorePreview.value = preview
    restoreLease = {
      workspaceId: lease.workspaceId,
      storeId: lease.storeId,
      revision: lease.revision,
      contextRevision: context,
    }
  }

  async function restoreBackup() {
    const preview = restorePreview.value,
      lease = restoreLease
    if (!preview) return
    clearRestorePreview()
    if (
      !lease ||
      options.isDisposed() ||
      options.workspace.value !== lease.workspaceId ||
      options.runtimeWorkspaceId() !== lease.workspaceId ||
      options.storeId.value !== lease.storeId ||
      options.leaseRevision() !== lease.revision ||
      options.contextRevision() !== lease.contextRevision
    )
      throw Error('店铺、账号或知识库上下文已改变，请重新预览恢复范围')
    if (preview.targetStoreId && preview.targetStoreId !== options.storeId.value)
      throw Error('恢复预览所属店铺已改变，请重新预览')
    // 恢复会替换工作区租约；这里故意不用 client() 的旧租约 guard。
    const service = createKnowledgeClient(options.workspace.value)
    options.notice.value = ''
    // Restore intentionally replaces the lease. The owner returns the verified NEW context.
    const result = await service.restore(preview.token)
    await options.applyReplacementContext(result.context)
    options.notice.value = result.message
  }

  async function previewClear() {
    await options.closeEditor()
    clearConfirmation.value = ''
    clearPreview.value = await options
      .client()
      .clearPreview(
        clearScope.value === 'store'
          ? { kind: 'store', storeId: options.storeId.value }
          : { kind: 'account' },
      )
  }

  async function clearKnowledge() {
    const preview = clearPreview.value
    if (!preview || clearConfirmation.value !== preview.confirmation)
      throw Error('请输入完整确认文字')
    // 清空同样会替换工作区，绕过旧租约 guard；成功与否由 owner 的上下文交接决定。
    const service = createKnowledgeClient(options.workspace.value)
    const confirmation = clearConfirmation.value
    options.notice.value = ''
    clearPreview.value = undefined
    clearConfirmation.value = ''
    const result = await service.clear(preview.token, confirmation)
    await options.applyReplacementContext(result.context)
    options.notice.value = result.message
  }

  /** 店铺/账号切换时同时失效预览和确认输入，避免旧目标继续可提交。 */
  function reset() {
    clearRestorePreview()
    clearPreview.value = undefined
    clearConfirmation.value = ''
    clearScope.value = 'store'
  }

  return {
    restorePreview,
    clearScope,
    clearPreview,
    clearConfirmation,
    backup,
    backupStore,
    chooseRestore,
    chooseStoreRestore,
    restoreBackup,
    previewClear,
    clearKnowledge,
    clearRestorePreview,
    reset,
  }
}
