import { getDesktop } from './desktop'
import type { BackendBridge } from '../contracts/backend'

/** 浏览器仅预览，不把失败的持久化伪装成保存成功。 */
export function getBackendBridge(): BackendBridge | undefined {
  const desktop = getDesktop()
  if (
    !desktop.isElectron ||
    !desktop.backendSnapshot ||
    !desktop.backendExecute ||
    !desktop.onBackendEvent ||
    !desktop.presentStore
  )
    return undefined
  return {
    snapshot: desktop.backendSnapshot,
    execute: desktop.backendExecute,
    subscribe: desktop.onBackendEvent,
    presentStore: desktop.presentStore,
  }
}
