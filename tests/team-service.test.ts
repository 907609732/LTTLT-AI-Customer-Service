import { describe, expect, it } from 'vitest'
import { createTeamService } from '../src/modules/account/services/team-service'

describe('team service restricted transport', () => {
  it('uses only typed team paths and validates acknowledgements', async () => {
    const calls: unknown[] = []
    const service = createTeamService(async (request) => {
      calls.push(request)
      return { ok: true }
    })
    await service.accept(3)
    await service.execute(3, { action: 'assign', revision: 7, ticketId: 8, userId: 20 })
    expect(calls).toEqual([
      { method: 'POST', path: '/teams/3/accept', body: {} },
      {
        method: 'POST',
        path: '/teams/3/actions',
        body: { action: 'assign', revision: 7, ticketId: 8, userId: 20 },
      },
    ])
    await expect(service.accept(-1)).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })
  it('rejects malformed responses and unavailable or failed transports', async () => {
    await expect(createTeamService(async () => ({ ok: false })).accept(1)).rejects.toThrow()
    await expect(
      createTeamService(async () => ({ teams: [{ team: { id: 1 } }] })).list(),
    ).rejects.toThrow()
    await expect(
      createTeamService(async () => {
        throw new Error('team_forbidden')
      }).list(),
    ).rejects.toThrow('team_forbidden')
  })
  it('prevents arbitrary action fields and versionless mutations before transport', async () => {
    let calls = 0
    const service = createTeamService(async () => {
      calls++
      return { ok: true }
    })
    await expect(
      service.execute(1, { action: 'assign', revision: 0, ticketId: 1, userId: 2 }),
    ).rejects.toThrow()
    await expect(
      service.execute(
        1,
        JSON.parse(
          '{"action":"assign","revision":1,"ticketId":1,"userId":2,"url":"https://other.test"}',
        ),
      ),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
})
