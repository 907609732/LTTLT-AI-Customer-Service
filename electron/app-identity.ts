import path from 'node:path'

/** A display/package rename must not create an empty account or lose encrypted platform sessions. */
export function resolveAppUserData(appData: string, explicitDirectory: string): string {
  return explicitDirectory
    ? path.resolve(explicitDirectory)
    : path.join(appData, 'yunduo-ui-restored')
}
