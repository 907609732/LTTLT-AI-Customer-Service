import type { KnowledgeModelPort } from './knowledge-runtime'
import { VisionModelSettingsStore, type VisionSafeStorage } from './vision-model-settings'
import { VisionModelRuntime } from './vision-model-runtime'
import {
  defaultVisionModelSnapshot,
  visionModelExpectedSchema,
  type VisionModelSnapshot,
} from '../src/shared/contracts/vision'

function hasImage(messages: Parameters<KnowledgeModelPort['complete']>[0]['messages']): boolean {
  return messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((part) => part.type === 'image_url'),
  )
}

/** A corrupt independent vision file blocks only image work; text keeps the original port. */
function unavailablePort(base: KnowledgeModelPort, reason: string): KnowledgeModelPort {
  const message = `图片模型配置不可用：${reason}；文字模型仍可用，请恢复备份后重新配置图片模型。`
  return {
    complete: async (input) => {
      if (hasImage(input.messages)) throw new Error(message)
      return base.complete(input)
    },
    vision: () => ({ supported: false, maxImages: 0, reason: message }),
    identity: () => `${base.identity?.() ?? 'configured'}|vision:unavailable`,
    minimumIntervalMs: () => base.minimumIntervalMs?.() ?? 0,
  }
}

export interface VisionModelAssembly {
  error: string
  snapshot(): VisionModelSnapshot
  wrap(base: KnowledgeModelPort): KnowledgeModelPort
  execute(action: string, payload: unknown): Promise<Record<string, unknown>>
}

/**
 * The local vision domain is assembled once and contained here. A bad file does not
 * prevent the rest of the local runtime from starting; only independent image work fails.
 */
export function createVisionModelAssembly(options: {
  dataDir: string
  safeStorage: VisionSafeStorage
  assertActive(): void
  modelSource(): 'local' | 'managed'
  request?: typeof fetch
}): VisionModelAssembly {
  let store: VisionModelSettingsStore | undefined
  let runtime: VisionModelRuntime | undefined
  let error = ''
  try {
    store = new VisionModelSettingsStore({
      dataDir: options.dataDir,
      safeStorage: options.safeStorage,
      assertActive: options.assertActive,
    })
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  return {
    error,
    snapshot() {
      return (
        store?.snapshot() ?? {
          ...defaultVisionModelSnapshot(),
          status: 'stale',
          reason: `图片模型配置不可用：${error || '无法读取配置'}；请恢复备份后重新配置。`,
        }
      )
    },
    wrap(base) {
      if (!store)
        return options.modelSource() === 'managed'
          ? base
          : unavailablePort(base, error || '无法读取配置')
      runtime = new VisionModelRuntime({
        store,
        base,
        modelSource: options.modelSource,
        assertActive: options.assertActive,
        ...(options.request ? { request: options.request } : {}),
      })
      return runtime.knowledgePort()
    },
    async execute(action, payload) {
      options.assertActive()
      if (!store) throw new Error(`图片模型不可用：${error || '无法读取配置'}`)
      const view = () => {
        const value = store!.view()
        return { snapshot: value.snapshot, revision: value.revision }
      }
      if (action === 'get-vision-model-settings') return view()
      if (action === 'save-vision-model-settings') {
        store.save(payload)
        return view()
      }
      if (action === 'clear-vision-key') {
        store.clearKey(payload)
        return view()
      }
      if (action === 'probe-vision-model' || action === 'verify-vision-model') {
        if (!runtime) throw new Error('图片模型端口尚未就绪，请稍后重试')
        let expected
        try {
          expected = visionModelExpectedSchema.parse(payload)
        } catch {
          throw new Error('图片模型配置已更新，请载入已保存配置后再操作')
        }
        if (action === 'probe-vision-model') {
          const result = await runtime.probe({ expected })
          return { ok: result.ok, message: result.message }
        }
        const result = await runtime.verify({ expected })
        return {
          ok: result.ok,
          message: result.message,
          status: result.status,
          revision: result.revision,
        }
      }
      throw new Error('不支持的图片模型操作')
    },
  }
}
