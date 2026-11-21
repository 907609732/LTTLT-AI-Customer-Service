import { getDesktop } from '@/shared/platform/desktop'

/** 教程使用固定官方地址，仍经既有受限 openExternal 桥接打开。 */
export const OFFICIAL_TUTORIAL_URL =
  'https://github.com/907609732/LTTLT-AI-Customer-Service#快速使用'

function isOfficialTutorialUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.username &&
      !url.password &&
      url.pathname === '/907609732/LTTLT-AI-Customer-Service' &&
      decodeURIComponent(url.hash) === '#快速使用'
    )
  } catch {
    return false
  }
}

export async function openOfficialTutorial(): Promise<void> {
  const desktop = getDesktop()
  if (!desktop.isElectron) throw new Error('浏览器预览不支持打开使用教程')
  if (!isOfficialTutorialUrl(OFFICIAL_TUTORIAL_URL)) throw new Error('使用教程地址无效')
  await desktop.openExternal(OFFICIAL_TUTORIAL_URL)
}
