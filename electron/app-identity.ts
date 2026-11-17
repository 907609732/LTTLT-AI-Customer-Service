import path from 'node:path'

/** Match the installer shortcut AppUserModelID so Windows groups packaged windows consistently. */
export const WINDOWS_APP_USER_MODEL_ID = 'top.lttlt.yunduo.customer.service'

/** A display/package rename must not create an empty account or lose encrypted platform sessions. */
export function resolveAppUserData(appData: string, explicitDirectory: string): string {
  return explicitDirectory
    ? path.resolve(explicitDirectory)
    : path.join(appData, 'yunduo-ui-restored')
}
