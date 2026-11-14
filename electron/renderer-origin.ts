import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function isRendererFileUrl(value: string, rendererPath: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return false
    // Chromium and Node encode unreserved characters differently (for example ~ / %7E).
    // Compare the decoded exact file instead of loosening the trusted renderer directory.
    const actual = path.resolve(fileURLToPath(url))
    const expected = path.resolve(rendererPath)
    return process.platform === 'win32'
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected
  } catch {
    return false
  }
}
