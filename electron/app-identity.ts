import path from 'node:path'

/**
 * Must equal `appId` in config/electron-builder.json: the NSIS shortcut stores
 * that value as its AppUserModelID, and Windows only groups the taskbar button
 * (and routes notifications) to the branded shortcut when the process reports
 * the same identity. Without this call the packaged process has no application
 * identity ("The process has no application identity") and the shell falls back
 * to the executable/default Electron identity.
 */
export const WINDOWS_APP_USER_MODEL_ID = 'top.lttlt.yunduo.customer.service'

/** A display/package rename must not create an empty account or lose encrypted platform sessions. */
export function resolveAppUserData(appData: string, explicitDirectory: string): string {
  return explicitDirectory
    ? path.resolve(explicitDirectory)
    : path.join(appData, 'yunduo-ui-restored')
}
