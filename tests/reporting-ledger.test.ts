import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReportingLedger } from '../electron/reporting-ledger'

const now = new Date(2026, 10, 14, 12).getTime()
const folders: string[] = []
const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reporting-'))
  folders.push(dir)
  return path.join(dir, 'reporting.json')
}
afterEach(() => folders.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))
describe('privacy preserving reporting ledger', () => {
  it('reports an unavailable persistence directory without throwing during cleanup', () => {
    const blocker = setup()
    const ledger = new ReportingLedger(path.join(blocker, 'nested', 'events.json'), () => now)
    writeFileSync(blocker, 'directory replaced by file')
    expect(() =>
      ledger.record({
        id: 'one',
        storeId: 's',
        platform: 'pdd-web',
        kind: 'buyer-message',
        at: now,
      }),
    ).not.toThrow()
    expect(ledger.report(now - 1, now + 1).persistence).toBe('error')
    expect(ledger.report(now - 1, now + 1).real['buyer-message']).toBe(0)
  })
  it('deduplicates durable event evidence across restarts and separates simulation', () => {
    const file = setup()
    const ledger = new ReportingLedger(file, () => now)
    const event = {
      id: 'trace-private',
      storeId: 'store',
      platform: 'pdd-web',
      kind: 'ai-sent' as const,
      at: now,
    }
    expect(ledger.record(event)).toBe(true)
    expect(ledger.record(event)).toBe(false)
    const restored = new ReportingLedger(file, () => now)
    expect(restored.record(event)).toBe(false)
    restored.record({ ...event, id: 'sim', platform: 'sim-local' })
    const report = restored.report(now - 1, now + 1)
    expect(report.real['ai-sent']).toBe(1)
    expect(report.simulated['ai-sent']).toBe(1)
    expect(readFileSync(file, 'utf8')).not.toContain('trace-private')
    expect(JSON.stringify(report)).not.toContain('store')
  })
  it('rejects future/invalid evidence and expires records outside 30 local calendar days', () => {
    const ledger = new ReportingLedger(setup(), () => now)
    const event = {
      id: 'one',
      storeId: 'a',
      platform: 'pdd-web',
      kind: 'buyer-message' as const,
      at: now,
    }
    expect(ledger.record({ ...event, at: now + 1 })).toBe(false)
    expect(ledger.record({ ...event, at: NaN })).toBe(false)
    expect(ledger.record({ ...event, at: new Date(2026, 9, 15).getTime() })).toBe(false)
    ledger.record(event)
    expect(ledger.report(now, now + 1).real['buyer-message']).toBe(1)
    expect(ledger.report(now - 1, now).real['buyer-message']).toBe(0)
  })
  it('does not overwrite corrupted historical data or pretend persistence succeeded', () => {
    const file = setup()
    writeFileSync(file, '{broken')
    const ledger = new ReportingLedger(file, () => now)
    expect(ledger.report(0, now + 1).persistence).toBe('error')
    expect(
      ledger.record({ id: 'x', storeId: 'a', platform: 'pdd-web', kind: 'ai-sent', at: now }),
    ).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('{broken')
  })
})
