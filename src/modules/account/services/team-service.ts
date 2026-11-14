import { z } from 'zod'
import type { InjectionKey } from 'vue'

const id = z.number().int().positive().max(4294967295)
const userId = z.number().int().positive().max(2147483647)
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const teamRoleSchema = z.enum(['owner', 'admin', 'agent', 'auditor'])
const mutableRole = z.enum(['admin', 'agent', 'auditor'])
export const teamSchema = z.object({
  id,
  ownerId: userId,
  name: z.string().min(1).max(80),
  revision,
})
export const teamMemberSchema = z.object({
  teamId: id,
  userId,
  role: teamRoleSchema,
  state: z.enum(['active', 'invited', 'disabled']),
})
const shopSchema = z.object({
  teamId: id,
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(80),
})
const grantSchema = z.object({ teamId: id, userId, shopId: z.string().min(1).max(128) })
const ticketSchema = z.object({
  id,
  teamId: id,
  shopId: z.string().min(1).max(128),
  text: z.string().max(4000),
  status: z.enum(['pending', 'working', 'waiting', 'done']),
  assignee: z.number().int().nonnegative(),
  createdBy: userId,
})
const noteSchema = z.object({
  id,
  teamId: id,
  ticketId: id,
  userId,
  text: z.string().max(2000),
  at: z.number().int().nonnegative(),
})
const auditSchema = z.object({
  id,
  teamId: id,
  actor: userId,
  action: z.string().max(40),
  userId: z.number().int().nonnegative(),
  shopId: z.string().max(128),
  ticketId: z.number().int().nonnegative(),
  role: z.string().max(16).default(''),
  active: z.boolean().default(false),
  allowed: z.boolean().default(false),
  status: z.string().max(16).default(''),
  at: z.number().int().nonnegative(),
})
export const teamSnapshotSchema = z.object({
  team: teamSchema,
  self: teamMemberSchema,
  members: z.array(teamMemberSchema),
  shops: z.array(shopSchema),
  grants: z.array(grantSchema),
  tickets: z.array(ticketSchema).max(200),
  notes: z.array(noteSchema).max(500),
  audits: z.array(auditSchema).max(100),
})
const shopId = z.string().trim().min(1).max(128)
export const teamCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), revision, userId, role: mutableRole }).strict(),
  z
    .object({
      action: z.literal('member'),
      revision,
      userId,
      role: mutableRole,
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('register-shop'),
      revision,
      shopId,
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ action: z.literal('grant'), revision, userId, shopId, allowed: z.boolean() }).strict(),
  z
    .object({
      action: z.literal('create-ticket'),
      revision,
      shopId,
      text: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal('assign'),
      revision,
      ticketId: id,
      userId: z.number().int().nonnegative().max(2147483647),
    })
    .strict(),
  z
    .object({
      action: z.literal('status'),
      revision,
      ticketId: id,
      status: ticketSchema.shape.status,
    })
    .strict(),
  z
    .object({
      action: z.literal('note'),
      revision,
      ticketId: id,
      text: z.string().trim().min(1).max(2000),
    })
    .strict(),
])
export type TeamCommand = z.infer<typeof teamCommandSchema>
export type TeamAction = TeamCommand extends infer T
  ? T extends { revision: number }
    ? Omit<T, 'revision'>
    : never
  : never
export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>
export type TeamMember = z.infer<typeof teamMemberSchema>
export type TeamTicket = z.infer<typeof ticketSchema>
export const teamListSchema = z.object({
  teams: z.array(z.object({ team: teamSchema, member: teamMemberSchema })),
})
export type TeamMembership = z.infer<typeof teamListSchema>['teams'][number]

/** App injects a main-process authenticated allowlisted transport. Never expose
 * bearer tokens or a general URL/method proxy to a component or renderer. */
export interface TeamRequest {
  method: 'GET' | 'POST'
  path: string
  body?: { name: string } | TeamCommand | Record<string, never>
}
export type TeamTransport = (request: TeamRequest) => Promise<unknown>
export interface TeamService {
  available: boolean
  list(): Promise<TeamMembership[]>
  create(name: string): Promise<z.infer<typeof teamSchema>>
  snapshot(teamId: number): Promise<TeamSnapshot>
  accept(teamId: number): Promise<void>
  execute(teamId: number, command: TeamCommand): Promise<void>
}
export const teamServiceKey: InjectionKey<TeamService> = Symbol('team-service')
const acknowledgement = z.object({ ok: z.literal(true) })
export function createTeamService(transport: TeamTransport): TeamService {
  return {
    available: true,
    async list() {
      return teamListSchema.parse(await transport({ method: 'GET', path: '/teams' })).teams
    },
    async create(name) {
      const body = z.object({ name: z.string().trim().min(1).max(80) }).parse({ name })
      return teamSchema.parse(await transport({ method: 'POST', path: '/teams', body }))
    },
    async snapshot(teamId) {
      return teamSnapshotSchema.parse(
        await transport({ method: 'GET', path: `/teams/${id.parse(teamId)}` }),
      )
    },
    async accept(teamId) {
      acknowledgement.parse(
        await transport({ method: 'POST', path: `/teams/${id.parse(teamId)}/accept`, body: {} }),
      )
    },
    async execute(teamId, command) {
      const path = `/teams/${id.parse(teamId)}/actions`
      const body = teamCommandSchema.parse(command)
      acknowledgement.parse(await transport({ method: 'POST', path, body }))
    },
  }
}
const unavailable = async (): Promise<never> => {
  throw new Error('团队服务尚未接通，请完成托管团队接口接入后重试')
}
export const unavailableTeamService: TeamService = {
  available: false,
  list: unavailable,
  create: unavailable,
  snapshot: unavailable,
  accept: unavailable,
  execute: unavailable,
}
