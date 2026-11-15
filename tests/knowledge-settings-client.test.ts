import { expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createKnowledgeClient } from '../src/modules/knowledge/manager-service'
const bridge = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/shared/platform/knowledge', () => ({ getKnowledgeBridge: () => bridge }))

it('sends reactive knowledge settings as cloneable IPC data', async () => {
  bridge.request.mockImplementation(async (input: unknown) => structuredClone(input))
  const settings = reactive({
    dynamicTtlMinutes: 60,
    dailyCheckTime: '09:00',
    dailyCheckEnabled: false,
    lastDailyCheckAt: 0,
  })
  const result = await createKnowledgeClient('workspace').command({
    type: 'save-settings',
    settings,
  })
  expect(result).toMatchObject({ command: { settings: { dailyCheckEnabled: false } } })
  expect(settings.dailyCheckEnabled).toBe(false)
})
