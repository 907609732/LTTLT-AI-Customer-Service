import { createRequire } from 'node:module'
import { join } from 'node:path'
// Desktop builds are CJS; Vitest transforms ESM. Avoid import.meta in the CJS bundle.
export const knowledgeRequire = createRequire(
  typeof __filename === 'string' ? __filename : join(process.cwd(), 'package.json'),
)
