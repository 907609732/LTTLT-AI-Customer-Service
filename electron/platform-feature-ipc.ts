import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { LocalRuntime } from './local-runtime'
import {
  platformLearningSnapshotRequestSchema,
  platformLearningStartSchema,
  platformLearningTaskRequestSchema,
  platformLearningReviewSchema,
  platformLearningSnapshotSchema,
  platformLearningOpenSourceSchema,
} from '../src/shared/contracts/platform-learning'
import {
  orderRequestSchema,
  platformOrderSnapshotSchema,
} from '../src/shared/contracts/platform-orders'
import {
  receptionCommandSchema,
  parseReceptionSnapshot,
} from '../src/shared/contracts/platform-operations'

/** Fixed operations only; platform pages have neither this preload nor an authorized application frame. */
export function registerPlatformFeatureIpc(options: {
  runtime: LocalRuntime
  authorize(event: IpcMainInvokeEvent): unknown
}) {
  const names: string[] = []
  const sameWorkspace = (workspaceId: string) => {
    if (options.runtime.snapshot().workspaceId !== workspaceId)
      throw Error('工作区已变化，请刷新后重试')
  }
  const register = (name: string, handle: (input: unknown) => Promise<unknown>) => {
    names.push(name)
    ipcMain.handle(name, (event, input: unknown) => {
      options.authorize(event)
      return handle(input)
    })
  }
  for (const operation of ['snapshot', 'start', 'pause', 'resume', 'cancel', 'review'] as const) {
    register(`platform-learning:${operation}`, async (input) => {
      const schema =
        operation === 'snapshot'
          ? platformLearningSnapshotRequestSchema
          : operation === 'start'
            ? platformLearningStartSchema
            : operation === 'review'
              ? platformLearningReviewSchema
              : platformLearningTaskRequestSchema
      const request = schema.parse(input)
      sameWorkspace(request.workspaceId)
      const value = await options.runtime.platformLearning()[operation](request)
      sameWorkspace(request.workspaceId)
      return platformLearningSnapshotSchema.parse(value)
    })
  }
  register('platform-learning:open-source', async (input) => {
    const request = platformLearningOpenSourceSchema.parse(input)
    sameWorkspace(request.workspaceId)
    await options.runtime.openPlatformLearningSource(request)
    sameWorkspace(request.workspaceId)
  })
  register('platform-orders:request', async (input) => {
    const request = orderRequestSchema.parse(input)
    sameWorkspace(request.workspaceId)
    const value = await options.runtime.platformOrders().execute(request)
    sameWorkspace(request.workspaceId)
    return platformOrderSnapshotSchema.parse(value)
  })
  register('reception:snapshot', async (input) => {
    const workspaceId = z.string().uuid().parse(input)
    sameWorkspace(workspaceId)
    const value = await options.runtime.receptionOperations().snapshot()
    sameWorkspace(workspaceId)
    return parseReceptionSnapshot(value)
  })
  register('reception:execute', async (input) => {
    const request = receptionCommandSchema.parse(input)
    sameWorkspace(request.workspaceId)
    const value = await options.runtime.receptionOperations().execute(request)
    sameWorkspace(request.workspaceId)
    return parseReceptionSnapshot(value)
  })
  return () => {
    for (const name of names) ipcMain.removeHandler(name)
  }
}
