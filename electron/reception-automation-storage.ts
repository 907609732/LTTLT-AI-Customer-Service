import { ReceptionAutomation } from './reception-automation-runtime'
import { createAutomationStore } from './scheduler-storage'
import type { ReceptionScheduler } from './scheduler-runtime'

export function createFileReceptionAutomation(options: {
  directory: string
  scheduler: ReceptionScheduler
}) {
  const storage = createAutomationStore(options.directory, 'reception-rules.json')
  return new ReceptionAutomation({ scheduler: options.scheduler, ...storage })
}
