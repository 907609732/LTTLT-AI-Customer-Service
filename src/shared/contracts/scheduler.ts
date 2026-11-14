import { z } from 'zod'

const id = z.string().trim().min(1).max(128)
export const automationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome-text'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('welcome-image'), url: z.url().startsWith('https://') }).strict(),
  z.object({ kind: z.literal('welcome-video'), url: z.url().startsWith('https://') }).strict(),
  z.object({ kind: z.literal('transfer'), agentId: id }).strict(),
  z
    .object({
      kind: z.literal('payment-reminder'),
      text: z.string().trim().min(1).max(2000),
      orderId: id,
    })
    .strict(),
])
export const scheduleSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('once'), at: z.number().int().nonnegative().max(8640000000000000) })
    .strict(),
  z.object({ type: z.literal('interval'), minutes: z.number().int().min(1).max(525600) }).strict(),
  z
    .object({
      type: z.literal('daily'),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      timezone: z
        .string()
        .max(80)
        .refine((zone) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: zone }).format()
            return true
          } catch {
            return false
          }
        }, '请选择有效的 IANA 时区'),
    })
    .strict(),
])
export const schedulerTaskInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    storeId: id,
    uid: id,
    enabled: z.boolean(),
    action: automationActionSchema,
    schedule: scheduleSchema,
  })
  .strict()
export const schedulerTaskSchema = schedulerTaskInputSchema.extend({
  id,
  nextAt: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
})
export const schedulerRunSchema = z
  .object({
    id,
    taskId: id,
    storeId: id,
    uid: id,
    occurrence: z.number().int().nonnegative(),
    action: automationActionSchema,
    state: z.enum(['pending', 'blocked', 'cancelled', 'expired']),
    reason: z.string().max(300),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict()
export const schedulerStateSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(schedulerTaskSchema).max(100),
    runs: z.array(schedulerRunSchema).max(500),
    receipts: z
      .array(z.object({ key: id, expiresAt: z.number().int().nonnegative() }).strict())
      .max(10000)
      .default([]),
  })
  .strict()
export type AutomationAction = z.infer<typeof automationActionSchema>
export type SchedulerTaskInput = z.infer<typeof schedulerTaskInputSchema>
export type SchedulerTask = z.infer<typeof schedulerTaskSchema>
export type SchedulerRun = z.infer<typeof schedulerRunSchema>
export type SchedulerState = z.infer<typeof schedulerStateSchema>
export interface SchedulerSnapshot extends SchedulerState {
  workspaceId: string
  running: boolean
  error?: string
}
export const schedulerCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('save'),
      workspaceId: id,
      id: id.optional(),
      revision: z.number().int().positive().optional(),
      task: schedulerTaskInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('enable'),
      workspaceId: id,
      id,
      enabled: z.boolean(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove'),
      workspaceId: id,
      id,
      revision: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal('cancel'), workspaceId: id, id }).strict(),
])
export type SchedulerCommand = z.infer<typeof schedulerCommandSchema>
export interface SchedulerBridge {
  schedulerSnapshot(workspaceId: string): Promise<SchedulerSnapshot>
  schedulerExecute(command: SchedulerCommand): Promise<SchedulerSnapshot>
}
