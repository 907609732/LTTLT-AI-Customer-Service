import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeDailyCheck } from '../electron/knowledge/daily'

it('checks once per eligible shop Beijing day, catches a later login, persists day and pauses captcha without automatic retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-daily-'))
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  let now = Date.parse('2026-11-15T00:59:00Z'),
    second = false,
    calls = 0
  for (const storeId of ['a', 'b']) {
    const c = repo.saveCanonical({ title: storeId })
    repo.bindProduct({ canonicalId: c.id, storeId, productId: storeId })
  }
  const options = {
    repository: repo,
    now: () => now,
    available: () => true,
    stores: () => ['a', ...(second ? ['b'] : [])],
    start: async (storeId: string, bindingIds: string[]) => {
      calls++
      if (storeId === 'b') throw Error('验证码，需要人工核对')
      const job = repo.createJob({ kind: 'daily-check', storeId, payload: { bindingIds } })
      repo.updateJob(job.id, { expectedRevision: job.revision, status: 'succeeded' })
      return { jobId: job.id }
    },
  }
  let daily = createKnowledgeDailyCheck(options)
  try {
    await daily.tick()
    expect(calls).toBe(0)
    now += 60000
    await daily.tick()
    await daily.tick()
    expect(calls).toBe(1)
    second = true
    await daily.tick()
    await daily.tick()
    expect(calls).toBe(2)
    expect(repo.listJobs({ storeId: 'b' }).items[0]).toMatchObject({
      kind: 'daily-check',
      status: 'paused',
      error: '验证码，需要人工核对',
    })
    daily.dispose()
    daily = createKnowledgeDailyCheck(options)
    await daily.tick()
    expect(calls).toBe(2)
    for (let i = 0; i < 101; i++) {
      const job = repo.createJob({ kind: 'collect', storeId: 'b', payload: {} })
      repo.updateJob(job.id, { expectedRevision: job.revision, status: 'succeeded' })
    }
    now += 86400000
    await daily.tick()
    expect(calls).toBe(3) // unresolved captcha remains manual across days
  } finally {
    daily.dispose()
    repo.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
