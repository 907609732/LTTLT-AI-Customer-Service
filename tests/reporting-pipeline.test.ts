import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createReportingPipeline } from '../electron/reporting-pipeline'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { emptyReview } from '../src/shared/contracts/review'

it('observes bounded archives without counting arbitrary seller replies as AI and survives archive eviction', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-pipeline-'))
  try {
    const now = Date.now(),
      snapshot = emptySnapshot()
    snapshot.stores = [
      {
        id: 's',
        platform: 'pdd-web',
        storeName: 's',
        group: '',
        aiEnabled: false,
        runtime: { open: false, online: false },
      },
    ]
    snapshot.conversations = [
      {
        storeId: 's',
        uid: 'private',
        name: 'private',
        status: 'pending',
        messages: [
          { from: 'seller', content: 'private body', ts: now },
          { from: 'buyer', content: 'private buyer', ts: now },
        ],
      },
    ]
    const pipeline = createReportingPipeline(dir, () => now)
    pipeline.observe(snapshot)
    pipeline.observe(snapshot)
    expect(pipeline.snapshot().today.real['seller-message']).toBe(1)
    expect(pipeline.snapshot().today.real['ai-sent']).toBe(0)
    snapshot.conversations = []
    pipeline.observe(snapshot)
    expect(createReportingPipeline(dir, () => now).snapshot().today.real['buyer-message']).toBe(1)
    expect(pipeline.snapshot().today.complete).toBe(false)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

it('counts only submitted completed reply generations and timestamped confirmed deliveries', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-evidence-'))
  try {
    const now = Date.now(),
      snapshot = emptySnapshot()
    snapshot.stores = [
      {
        id: 's',
        platform: 'pdd-web',
        storeName: 's',
        group: '',
        aiEnabled: false,
        runtime: { open: false, online: false },
      },
    ]
    const trace = {
      id: 'trace',
      at: now - 10,
      storeId: 's',
      storeName: 's',
      uid: 'u',
      buyerName: '',
      model: '',
      messages: '',
      thread: '',
      reply: 'private reply',
      error: '',
      purpose: 'reply' as const,
      submittedAt: now - 9,
      completedAt: now - 5,
    }
    snapshot.review = {
      ...emptyReview(),
      traces: [
        trace,
        { ...trace, id: 'compression', purpose: 'compression' },
        { ...trace, id: 'unsubmitted', submittedAt: undefined },
        { ...trace, id: 'failure', error: 'private error' },
      ],
      replies: [
        {
          id: 'r',
          at: now - 7,
          storeId: 's',
          storeName: '',
          uid: 'u',
          buyerName: '',
          text: 'private body',
          traceId: 'trace',
          status: 'sent',
          reason: '',
        },
      ],
      logs: [],
    }
    const pipeline = createReportingPipeline(dir, () => now)
    pipeline.observe(snapshot)
    expect(pipeline.snapshot().today.real['ai-generated']).toBe(1)
    expect(pipeline.snapshot().today.real['ai-failed']).toBe(1)
    expect(pipeline.snapshot().today.real['ai-sent']).toBe(0)
    snapshot.review.logs.push({
      id: 'log',
      at: now,
      storeId: 's',
      storeName: '',
      uid: 'u',
      buyerName: '',
      kind: '',
      text: '',
      ai: {
        stage: 'sent',
        submitted: true,
        code: 'sent',
        reason: '',
        updatedAt: now,
        traceId: 'trace',
      },
    })
    pipeline.observe(snapshot)
    expect(pipeline.snapshot().today.real['ai-sent']).toBe(1)
    const result = pipeline.snapshot({
      workspaceId: '',
      stores: [
        {
          storeId: 's',
          storeName: '',
          platform: 'pdd-web',
          kind: 'aftersale',
          status: 'error',
          complete: false,
          message: '',
          total: 50,
          items: [],
        },
      ],
    })
    expect(result.aftersales[0]?.total).toBeNull()
    expect(result.aftersales[0]?.scope).toBe('current-merchant-pending')
    expect(result.aftersales[0]?.queryWindow).toBe('last-3-months')
  } finally {
    rmSync(dir, { recursive: true })
  }
})
