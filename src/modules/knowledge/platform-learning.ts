import type { InjectionKey } from 'vue'
import type { PlatformLearningTransport } from '@/shared/contracts/platform-learning'

/** App assembly injects a lease-checked desktop adapter; browser previews remain read-only. */
export const platformLearningTransportKey: InjectionKey<PlatformLearningTransport> = Symbol(
  'platform-learning-transport',
)

export type {
  PlatformLearningTransport,
  PlatformLearningSnapshot,
  PlatformLearningStart,
  PlatformLearningTaskRequest,
  PlatformLearningReview,
  PlatformLearningOpenSource,
} from '@/shared/contracts/platform-learning'
