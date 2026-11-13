import { getDesktop } from './desktop'
import { genericPhrases } from '../customer-service/library'

/** Desktop copying uses a trusted, ID-only bridge; browser copying requires a user gesture. */
export async function copyBuiltinPhrase(id: string): Promise<void> {
  const phrase = genericPhrases.find((row) => row.id === id)
  if (!phrase) throw new Error('通用话术不存在，请刷新后重试')
  const desktop = getDesktop()
  if (desktop.isElectron) {
    if (!desktop.copyGenericPhrase) throw new Error('话术复制能力尚未加载，请重启软件')
    return desktop.copyGenericPhrase(id)
  }
  if (!navigator.clipboard?.writeText) throw new Error('当前环境无法复制，请选中话术手动复制')
  await navigator.clipboard.writeText(phrase.reply)
}
