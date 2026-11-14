import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ReceptionScheduler } from './scheduler-runtime'
import type { SchedulerTask, SchedulerTaskInput } from '../src/shared/contracts/scheduler'

/** The path is supplied only by the workspace owner, never by renderer commands. */
export function createFileScheduler(options: {
  workspaceId: string
  directory: string
  capability?: (task: SchedulerTask) => string
  validateTask: (task: SchedulerTaskInput) => void
}) {
  const storage = createAutomationStore(options.directory, 'reception-scheduler.json')
  return new ReceptionScheduler({
    workspaceId: options.workspaceId,
    capability: options.capability,
    validateTask: options.validateTask,
    load: storage.load,
    save: storage.save,
  })
}

/** Only fixed domain filenames; never exposed to IPC. Domain constructors validate loaded data. */
export function createAutomationStore(
  directory: string,
  filename: 'reception-scheduler.json' | 'reception-rules.json',
) {
  const path = join(directory, filename)
  mkdirSync(directory, { recursive: true })
  return {
    load: (): unknown =>
      existsSync(path) ? JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) : undefined,
    save: (state: unknown) => {
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, JSON.stringify(state), {
          encoding: 'utf8',
          flag: 'wx',
          flush: true,
        })
        renameSync(temporary, path)
      } finally {
        rmSync(temporary, { force: true })
      }
    },
  }
}
