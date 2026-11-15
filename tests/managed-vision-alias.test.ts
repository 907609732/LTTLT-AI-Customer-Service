// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const { createBackend } = createRequire(import.meta.url)(
  '../vendor/lingtu-runtime/electron/backend.cjs',
) as {
  createBackend(options: unknown): {
    snapshot(): { capabilities: { vision: { supported: boolean } } }
    dispose(): void
  }
}
it('shows server-authorized alias vision and preserves denial', () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-vision-alias-'))
  let vision = true
  const backend = createBackend({
    dataDir: directory,
    modelMode: 'managed',
    managedCapabilities: () => ({ vision, model: 'managed-2', maxImages: 4 }),
  })
  try {
    expect(backend.snapshot().capabilities.vision.supported).toBe(true)
    vision = false
    expect(backend.snapshot().capabilities.vision.supported).toBe(false)
  } finally {
    backend.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
