import { existsSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { resolve } from 'node:path'

export const restoreIntentName = 'knowledge-restore-intent.json'

/** This error contains only the trusted account directory, never paths read from a marker. */
export class KnowledgeRestoreInterruptedError extends Error {
  readonly directory: string
  constructor(directory: string) {
    const root = resolve(directory)
    super(`知识库恢复中断，已停止启动以保护原资料。恢复材料目录：${root}`)
    this.name = 'KnowledgeRestoreInterruptedError'
    this.directory = root
  }
}

export function assertNoInterruptedKnowledgeRestore(directory: string) {
  // Even an empty/corrupt marker fails closed; do not follow or delete its claimed paths.
  if (existsSync(resolve(directory, restoreIntentName)))
    throw new KnowledgeRestoreInterruptedError(directory)
}

export function syncKnowledgeFile(path: string) {
  const fd = openSync(path, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export function syncKnowledgeDirectory(path: string) {
  // Windows cannot open a directory through Node's fsync API. Files themselves are flushed.
  if (process.platform === 'win32') return
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
