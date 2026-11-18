import { createHash } from 'node:crypto'
import type { LocalRuntime } from '../local-runtime'
import { agentCallSchema } from '../../src/shared/contracts/agent'
import type { KnowledgeScope } from '../../src/shared/contracts/knowledge'
import {
  agentConfigSchemaDescription,
  applyAgentConfig,
  getAgentConfig,
  previewAgentConfig,
} from './settings'

export function createAgentService(options: {
  version: string
  runtime(): Pick<LocalRuntime, 'snapshot' | 'knowledge' | 'execute'>
}) {
  const writes = new Map<string, { hash: string; result: Promise<unknown> }>()
  let cacheWorkspace = ''
  const call = async (raw: unknown): Promise<unknown> => {
    const input = agentCallSchema.parse(raw)
    const runtime = options.runtime(),
      before = runtime.snapshot(),
      w = before.workspaceId
    if (cacheWorkspace !== w) {
      writes.clear()
      cacheWorkspace = w
    }
    const current = () => {
      const next = options.runtime().snapshot()
      if (
        next.workspaceId !== w ||
        next.managed.restartRequired ||
        next.managed.active.mode !== before.managed.active.mode ||
        next.managed.active.apiOrigin !== before.managed.active.apiOrigin ||
        next.managed.active.portalOrigin !== before.managed.active.portalOrigin ||
        (before.managed.active.mode === 'managed' &&
          (!next.managed.session.account ||
            next.managed.session.account.userId !== before.managed.session.account?.userId ||
            !['signed_in', 'offline'].includes(next.managed.session.status)))
      )
        throw Error('账号工作区已改变，请重新获取状态；未返回旧结果')
    }
    if (input.tool === 'lingtu_status') {
      let available = true
      try {
        runtime.knowledge()
      } catch {
        available = false
      }
      return {
        available,
        version: options.version,
        workspaceId: w,
        mode: before.managed.active.mode,
        sessionStatus: before.managed.session.status,
        stores: before.stores.length,
        tools: ['query', 'catalog', 'collect', 'draft', 'config'],
        requiresHuman: ['clear', 'publish', 'send'],
      }
    }
    if (input.tool === 'lingtu_config_schema') return agentConfigSchemaDescription
    if (input.args.workspaceId !== w) throw Error('账号工作区已改变，请重新获取状态')
    if (
      before.managed.restartRequired ||
      (before.managed.active.mode === 'managed' &&
        (!before.managed.session.account ||
          !['signed_in', 'offline'].includes(before.managed.session.status)))
    )
      throw Error('当前账号尚未登录或需要重启')
    const storeId = 'storeId' in input.args ? input.args.storeId : undefined
    if (storeId && !before.stores.some((s) => s.id === storeId)) throw Error('店铺不存在或已移除')
    const run = async (): Promise<unknown> => {
      current()
      if (input.tool === 'lingtu_get_config') return getAgentConfig(runtime.snapshot(), input.args)
      if (input.tool === 'lingtu_preview_config')
        return previewAgentConfig(runtime.snapshot(), input.args, input.args.patch)
      if (input.tool === 'lingtu_apply_config') {
        const result = await applyAgentConfig(
          runtime,
          input.args,
          input.args.expectedVersion,
          input.args.patch,
          input.args.requestId,
        )
        current()
        return result
      }
      if (input.tool === 'lingtu_list_stores')
        return {
          workspaceId: w,
          stores: before.stores.map((s) => ({
            id: s.id,
            storeName: s.storeName,
            platform: s.platform,
            aiEnabled: s.aiEnabled,
            runtime: s.runtime,
          })),
        }
      if (input.tool === 'lingtu_open_store') {
        const result = await runtime.execute({
          workspaceId: w,
          action: 'open-store',
          storeId: input.args.storeId,
          values: {},
        })
        current()
        return result
      }
      const knowledge = runtime.knowledge()
      let result: unknown
      switch (input.tool) {
        case 'lingtu_summary':
          result = await knowledge.request({
            workspaceId: w,
            operation: 'query',
            query: { type: 'summary', storeId: input.args.storeId },
          })
          break
        case 'lingtu_list_products':
        case 'lingtu_list_knowledge':
        case 'lingtu_list_jobs': {
          const args = input.args
          result = await knowledge.request({
            workspaceId: w,
            operation: 'query',
            query: {
              type:
                input.tool === 'lingtu_list_products'
                  ? 'products'
                  : input.tool === 'lingtu_list_knowledge'
                    ? 'entries'
                    : 'jobs',
              page: {
                storeId: args.storeId,
                search: args.search,
                offset: args.offset,
                limit: args.limit,
              },
            },
          })
          if (input.tool === 'lingtu_list_jobs') {
            const jobs = knowledge.repository.listJobs({
              storeId: args.storeId,
              offset: args.offset,
              limit: args.limit,
              search: args.search,
            })
            result = {
              ...jobs,
              items: jobs.items.map((j) => ({
                id: j.id,
                revision: j.revision,
                storeId: j.storeId,
                kind: j.kind,
                status: j.status,
                progress: j.progress,
                error: j.error.slice(0, 1000),
              })),
            }
          }
          break
        }
        case 'lingtu_read_catalog':
          result = await knowledge.request({
            workspaceId: w,
            operation: 'pipeline',
            input: {
              action: 'catalog',
              storeId: input.args.storeId,
              search: input.args.search,
              cursor: input.args.cursor,
            },
          })
          break
        case 'lingtu_start_collection': {
          const args = input.args
          result = await knowledge.request({
            workspaceId: w,
            operation: 'pipeline',
            input: {
              action: 'start',
              kind: 'collect',
              storeId: args.storeId,
              bindingIds: [],
              sourceIds: [],
              catalog: {
                identityVersion: args.identityVersion,
                scopeToken: args.scopeToken,
                productIds: args.productIds,
                total: args.total,
                allMatching: false,
              },
            },
          })
          break
        }
        case 'lingtu_save_draft': {
          const args = input.args,
            repo = knowledge.repository
          const owns = (scope: KnowledgeScope) =>
            scope.kind === 'store'
              ? scope.storeId === args.storeId
              : scope.kind === 'binding' &&
                repo.getBinding(scope.bindingId)?.storeId === args.storeId
          if (
            args.bindingId &&
            (!repo.getBinding(args.bindingId)?.active ||
              !owns({ kind: 'binding', bindingId: args.bindingId }))
          )
            throw Error('商品不属于当前店铺')
          if (Boolean(args.id) !== Boolean(args.expectedRevision))
            throw Error('编辑草稿必须提供条目ID和当前版本')
          if (args.id) {
            const old = repo.getEntry(args.id)
            if (!old || !owns(old.draft.scope) || (old.approved && !owns(old.approved.scope)))
              throw Error('只能编辑本店私有知识草稿')
          }
          result = await knowledge.request({
            workspaceId: w,
            operation: 'command',
            command: {
              type: 'save-draft',
              draft: {
                id: args.id,
                expectedRevision: args.expectedRevision,
                scope: args.bindingId
                  ? { kind: 'binding', bindingId: args.bindingId }
                  : { kind: 'store', storeId: args.storeId },
                question: args.question,
                answer: args.answer,
                keywords: args.keywords,
                field: args.field,
                sourceRefs: args.sourceRefs,
                origin: 'model',
                expiresAt: args.expiresAt,
              },
            },
          })
          break
        }
      }
      current()
      return { workspaceId: w, result }
    }
    if ('requestId' in input.args) {
      const a = input.args
      const key = `${w}:${a.requestId}`,
        hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      const existing = writes.get(key)
      if (existing) {
        if (existing.hash !== hash) throw Error('requestId已用于其他请求')
        return existing.result.then((result) => {
          current()
          return result
        })
      }
      if (writes.size >= 500) throw Error('本次运行写入请求已达上限，请重启软件后继续')
      const result = run()
      writes.set(key, { hash, result })
      return result
    }
    return run()
  }
  return { call }
}
