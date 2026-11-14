import type {
  SchedulerBridge,
  SchedulerCommand,
  SchedulerSnapshot,
} from '../src/shared/contracts/scheduler'

/** Merge this small whitelist into the existing contextBridge object. */
export function createSchedulerPreload(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): SchedulerBridge {
  return {
    schedulerSnapshot: (workspaceId) =>
      invoke('scheduler:snapshot', workspaceId) as Promise<SchedulerSnapshot>,
    schedulerExecute: (command: SchedulerCommand) =>
      invoke('scheduler:execute', command) as Promise<SchedulerSnapshot>,
  }
}
