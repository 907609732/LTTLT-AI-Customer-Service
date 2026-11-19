import type { Router } from 'vue-router'
import type { KnowledgeBridge } from '@/shared/contracts/knowledge-client'
/** 主窗口接收固定目的地；异步快照不得把旧账号导航带入新账号。 */
export function installKnowledgeNavigation(
  bridge: Pick<KnowledgeBridge, 'onNavigate'> | undefined,
  router: Router,
  runtime: { snapshot: { workspaceId: string }; refresh(): Promise<void> },
  report: (message: string) => void,
) {
  let ticket = 0
  let disposed = false
  const off = bridge?.onNavigate?.((input) => {
    const current = ++ticket
    void (async () => {
      if (input.workspaceId !== runtime.snapshot.workspaceId) await runtime.refresh()
      if (disposed || current !== ticket || input.workspaceId !== runtime.snapshot.workspaceId)
        return
      if (input.target === 'home' && router.currentRoute.value.name !== 'knowledge-manager') return
      await router.push(input.target === 'library' ? '/knowledge' : '/')
    })().catch((cause: unknown) => {
      if (!disposed && current === ticket)
        report(cause instanceof Error ? cause.message : '无法打开知识库，请重试')
    })
  })
  return () => {
    disposed = true
    ticket++
    off?.()
  }
}
