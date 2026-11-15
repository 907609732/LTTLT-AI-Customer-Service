import { defineStore } from 'pinia'
import { watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'

export interface ReceptionSettingsDraft {
  welcome?: { text: string; enabled: boolean; version: number }
  inherited?: boolean
  keywords?: string
  globalKeywords?: string
}
export interface ReceptionRuleDraft {
  form: {
    id: string
    revision: number
    enabled: boolean
    text: string
    agentId: string
    media: { kind: 'welcome-image' | 'welcome-video'; url: string }[]
  }
  dirty: boolean
}
/** 仅在本窗口暂存向导草稿；账号/工作区变化立即清除，不写入业务配置。 */
export const useReceptionDraftCache = defineStore('reception-setup-drafts', () => {
  const runtime = useRuntimeStore()
  const settings = new Map<string, ReceptionSettingsDraft>()
  const rules = new Map<string, ReceptionRuleDraft>()
  watch(
    () => runtime.snapshot.workspaceId,
    () => {
      settings.clear()
      rules.clear()
    },
    { flush: 'sync' },
  )
  const key = (workspaceId: string, storeId: string, view: string) =>
    JSON.stringify([workspaceId, storeId, view])
  function getSettings(workspaceId: string, storeId: string, view: string) {
    return settings.get(key(workspaceId, storeId, view))
  }
  function putSettings(
    workspaceId: string,
    storeId: string,
    view: string,
    draft: ReceptionSettingsDraft,
  ) {
    if (workspaceId === runtime.snapshot.workspaceId)
      settings.set(key(workspaceId, storeId, view), draft)
  }
  function getRule(workspaceId: string, storeId: string, trigger: string) {
    return rules.get(key(workspaceId, storeId, trigger))
  }
  function putRule(
    workspaceId: string,
    storeId: string,
    trigger: string,
    draft: ReceptionRuleDraft,
  ) {
    if (workspaceId !== runtime.snapshot.workspaceId) return
    if (draft.dirty) rules.set(key(workspaceId, storeId, trigger), draft)
    else rules.delete(key(workspaceId, storeId, trigger))
  }
  return { getSettings, putSettings, getRule, putRule }
})
