import { ref, type Ref } from 'vue'
import type { KnowledgeMiss, KnowledgeMissStatus } from '@/shared/contracts/knowledge'
import type { createKnowledgeClient } from './manager-service'

/**
 * 待学问题只持有状态筛选、处理中标记和对应命令。列表刷新、分页和租约
 * 所有者仍是 manager；sameLease 的每个条件都由 manager 的只读回调提供。
 */
export function useKnowledgeMiss(options: {
  client: () => Pick<ReturnType<typeof createKnowledgeClient>, 'command'>
  workspace: Ref<string>
  storeId: Ref<string>
  page: Ref<number>
  total: Ref<number>
  notice: Ref<string>
  error: Ref<string>
  refresh(): Promise<void>
  leaseRevision(): number
  isDisposed(): boolean
  runtimeWorkspaceId(): string
}) {
  const misses = ref<KnowledgeMiss[]>([]),
    missStatus = ref<KnowledgeMissStatus>('open'),
    missUpdating = ref('')

  async function changeMissStatus(next: KnowledgeMissStatus) {
    if (next === missStatus.value) return
    missStatus.value = next
    missUpdating.value = ''
    options.notice.value = ''
    options.error.value = ''
    // Status is part of the server query; never paginate an already-fetched open-page slice.
    options.page.value = 0
    await options.refresh()
  }
  async function updateMissDisposition(miss: KnowledgeMiss, status: KnowledgeMissStatus) {
    if (missUpdating.value) return
    const w = options.workspace.value,
      s = options.storeId.value,
      revision = options.leaseRevision(),
      sameLease = () =>
        !options.isDisposed() &&
        options.workspace.value === w &&
        options.storeId.value === s &&
        options.leaseRevision() === revision &&
        options.runtimeWorkspaceId() === w
    missUpdating.value = miss.id
    options.notice.value = ''
    options.error.value = ''
    try {
      await options.client().command({ type: 'update-miss', missId: miss.id, status })
      if (!sameLease()) return
      misses.value = misses.value.filter((row) => row.id !== miss.id)
      options.total.value = Math.max(0, options.total.value - 1)
      options.page.value = Math.min(
        options.page.value,
        Math.max(0, Math.ceil(options.total.value / 20) - 1),
      )
      await options.refresh()
      if (!sameLease()) return
      options.notice.value =
        status === 'resolved'
          ? '已标记为已解决，仅记录处理状态，不会生成或发布答案；补充答案请另存草稿并审核。'
          : status === 'ignored'
            ? '已忽略该待学问题，仅记录处理状态，不会生成或发布答案。'
            : '已重新打开，问题回到待处理列表。'
    } catch (cause) {
      // A store/account switch during the write must not paint its old failure onto the new shop.
      if (sameLease()) throw cause
    } finally {
      if (sameLease()) missUpdating.value = ''
    }
  }

  return { misses, missStatus, missUpdating, changeMissStatus, updateMissDisposition }
}
