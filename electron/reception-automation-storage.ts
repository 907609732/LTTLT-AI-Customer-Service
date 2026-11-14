import { ReceptionAutomation } from './reception-automation-runtime'
import { createAutomationStore } from './scheduler-storage'
import type { ReceptionScheduler } from './scheduler-runtime'
import { z } from 'zod'

export interface ReceptionRuleEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
const envelopeSchema = z
  .object({ version: z.literal(1), encrypted: z.literal(true), ciphertext: z.string().min(1) })
  .strict()

export function createFileReceptionAutomation(options: {
  directory: string
  scheduler: ReceptionScheduler
  encryption: ReceptionRuleEncryption
  now?(): number
}) {
  const storage = createAutomationStore(options.directory, 'reception-rules.json')
  const requireEncryption = () => {
    if (!options.encryption.isEncryptionAvailable())
      throw new Error('系统加密不可用，接待规则未保存；不会降级为明文')
  }
  const load = (): unknown => {
    const saved = storage.load()
    if (saved === undefined) return undefined
    requireEncryption()
    const envelope = envelopeSchema.parse(saved)
    return JSON.parse(options.encryption.decryptString(Buffer.from(envelope.ciphertext, 'base64')))
  }
  const save = (rules: unknown) => {
    requireEncryption()
    storage.save({
      version: 1,
      encrypted: true,
      ciphertext: options.encryption.encryptString(JSON.stringify(rules)).toString('base64'),
    })
  }
  return new ReceptionAutomation({ scheduler: options.scheduler, load, save, now: options.now })
}
