import {
  phraseLibrarySchema,
  type CustomPhrasesBridge,
} from '../src/shared/customer-service/custom-phrases'

export function createCustomPhrasesPreload(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): CustomPhrasesBridge {
  return {
    list: async (scope) => phraseLibrarySchema.parse(await invoke('custom-phrases:list', scope)),
    save: async (scope, input) =>
      phraseLibrarySchema.parse(await invoke('custom-phrases:save', scope, input)),
    remove: async (scope, input) =>
      phraseLibrarySchema.parse(await invoke('custom-phrases:remove', scope, input)),
    import: async (scope, input) =>
      phraseLibrarySchema.parse(await invoke('custom-phrases:import', scope, input)),
    copy: async (scope, input) => {
      await invoke('custom-phrases:copy', scope, input)
    },
  }
}
