import { z } from 'zod'

export const assistAlertKinds = ['consult', 'handoff', 'ticket', 'aftersale'] as const
export const assistPreferencesSchema = z
  .object({
    pinned: z.boolean(),
    docked: z.boolean(),
    soundEnabled: z.boolean(),
    volume: z.number().min(0).max(1),
    sort: z.enum(['newest', 'oldest']),
    alertKinds: z.array(z.enum(assistAlertKinds)).max(4),
  })
  .strict()
export const assistPreferencesPatchSchema = assistPreferencesSchema.partial().strict()
export type AssistPreferences = z.infer<typeof assistPreferencesSchema>
export type AssistPreferencesPatch = z.infer<typeof assistPreferencesPatchSchema>
export interface AssistWindowState extends AssistPreferences {
  workspaceId: string
  open: boolean
  isAssistWindow: boolean
}
export const defaultAssistPreferences = (): AssistPreferences => ({
  pinned: true,
  docked: true,
  soundEnabled: false,
  volume: 0.5,
  sort: 'newest',
  alertKinds: [...assistAlertKinds],
})
export type AssistMainSection = 'workorder' | 'settings'
export const openAssistConversationSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().min(1).max(64),
    conversationId: z.string().min(1).max(200),
  })
  .strict()
export type OpenAssistConversationInput = z.infer<typeof openAssistConversationSchema>
