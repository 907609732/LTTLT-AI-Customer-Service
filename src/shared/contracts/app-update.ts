export interface AppUpdateResult {
  currentVersion: string
  latestVersion: string | null
  status: 'available' | 'current' | 'unpublished'
  releaseUrl: string | null
}
