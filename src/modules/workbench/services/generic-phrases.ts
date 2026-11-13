import { copyBuiltinPhrase } from '@/shared/platform/clipboard'
import type { GenericPhrase } from '@/shared/customer-service/library'

/** Does not populate or send a platform message; the user reviews the copied wording. */
export async function copyGenericPhrase(phrase: GenericPhrase): Promise<void> {
  await copyBuiltinPhrase(phrase.id)
}
