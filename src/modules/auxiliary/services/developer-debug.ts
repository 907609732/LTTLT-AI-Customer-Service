import type { DeveloperDebugBridge } from '@/shared/contracts/developer-debug'
import { getDesktop } from '@/shared/platform/desktop'

/** auxiliary 模块自己的调试服务边界；组件不直接接触 Electron/IPC。 */
export function getDeveloperDebugBridge(): DeveloperDebugBridge | undefined {
  return getDesktop().developerDebug
}
