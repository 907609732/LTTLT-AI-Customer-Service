import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
const activeDirectories = new Set<string>()
const key = (directory: string) => {
  let path = resolve(directory)
  try {
    path = realpathSync(path)
  } catch {
    /* New restore destination. */
  }
  return process.platform === 'win32' ? path.toLowerCase() : path
}
export function assertKnowledgeWriterStopped(directory: string) {
  if (activeDirectories.has(key(directory)))
    throw Error('知识库writer仍打开，请先停止任务并关闭仓储')
}
export function registerKnowledgeWriter(directory: string) {
  assertKnowledgeWriterStopped(directory)
  activeDirectories.add(key(directory))
}
export function unregisterKnowledgeWriter(directory: string) {
  activeDirectories.delete(key(directory))
}
