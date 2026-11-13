import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Build tools run only against the pinned generated tree; no deployment/bootstrap is invoked.
const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(server, '..')
const upstream = path.join(server, '.upstream')
// An optional physical cache avoids slow/EFS volumes and Windows junction binary-link failures.
// The canonical source and all final products remain under server/.
const buildRoot = process.env.YUNDUO_SERVER_BUILD_DIR
  ? path.resolve(process.env.YUNDUO_SERVER_BUILD_DIR)
  : upstream
if (
  buildRoot !== upstream &&
  (buildRoot.startsWith(upstream + path.sep) || upstream.startsWith(buildRoot + path.sep))
)
  throw new Error('Build cache must be separate from the canonical upstream tree')
const web = path.join(buildRoot, 'web')
const output = path.join(server, 'artifacts')
const bin = path.join(server, 'bin')
const bundledBun = path.join(
  process.env.APPDATA || '',
  'npm',
  'node_modules',
  'bun',
  'bin',
  'bun.exe',
)
const bun =
  process.env.YUNDUO_SERVER_BUN ||
  (process.platform === 'win32' && fs.existsSync(bundledBun) ? bundledBun : 'bun')
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH'
const env = {
  ...process.env,
  // Scripts such as "bun check" must use this same pinned executable, not an older global Bun.
  [pathKey]: path.isAbsolute(bun)
    ? path.dirname(bun) + path.delimiter + (process.env[pathKey] || '')
    : process.env[pathKey],
  GOSUMDB:
    process.env.GOSUMDB === 'off' ? 'sum.golang.org' : process.env.GOSUMDB || 'sum.golang.org',
}
const steps: { name: string; code: number; durationMs: number }[] = []
fs.mkdirSync(output, { recursive: true })
fs.mkdirSync(bin, { recursive: true })
function run(
  name: string,
  command: string,
  args: string[],
  cwd = root,
  additions: NodeJS.ProcessEnv = {},
) {
  console.log('\n' + name)
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd,
    env: { ...env, ...additions },
    stdio: 'inherit',
    windowsHide: true,
  })
  const code = result.status ?? 1
  steps.push({ name, code, durationMs: Date.now() - started })
  if (result.error) throw result.error
  if (code !== 0) throw new Error(name + ' failed with exit code ' + code)
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Server verification requires Node.js >=24')
  const version = spawnSync(bun, ['--version'], { encoding: 'utf8', windowsHide: true })
  if (version.status !== 0 || version.stdout.trim() !== '1.4.4')
    throw new Error('Bun 1.4.4 is required; set YUNDUO_SERVER_BUN to its executable path')
  run('Prepare pinned server', process.execPath, [path.join(server, 'scripts', 'prepare.mjs')])
  if (buildRoot !== upstream) {
    fs.mkdirSync(buildRoot, { recursive: true })
    fs.cpSync(upstream, buildRoot, {
      recursive: true,
      filter: (file) => {
        const parts = path.relative(upstream, file).split(path.sep)
        return !parts.includes('node_modules') && !(parts[0] === 'web' && parts[1] === 'dist')
      },
    })
  }
  run(
    'Go managed regression (SQLite)',
    'go',
    [
      'test',
      './lingtu',
      './lingtuhost',
      './middleware',
      './controller',
      './service',
      './common',
      './relay/helper',
      './relay/channel/aws',
      './relay/channel/xunfei',
      '-run',
      'Test(Device|Desktop|Trial|Concurrent|Settlement|Social|Credential|GORM|Lingtu|LocalHTTP)',
      '-count=1',
      '-timeout=180s',
    ],
    upstream,
    { LINGTU_TEST_ENGINE: '', LINGTU_TEST_DSN: '' },
  )
  run('Install locked web dependencies', bun, ['install', '--frozen-lockfile'], web, {
    BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || path.join(buildRoot, 'bun-cache'),
  })
  run('Verify generated overlays', process.execPath, [
    '--test',
    path.join(server, 'tests', 'preparation.test.mjs'),
  ])
  run(
    'Generate native routes',
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {Generator,getConfig} from '@tanstack/router-generator'; const root=process.cwd(); await new Generator({config:getConfig({},root),root}).run();",
    ],
    web,
  )
  run('Native web types', bun, ['run', 'typecheck'], web)
  run(
    'Changed native frontend lint',
    bun,
    [
      'x',
      'oxlint',
      '-c',
      '.oxlintrc.json',
      'src/features/lingtu',
      'src/routes/lingtu',
      'src/features/auth/sign-in/index.tsx',
      'src/features/auth/sign-up/components/sign-up-form.tsx',
      'src/features/auth/hooks/use-oauth-login.ts',
      'src/routes/oauth/$provider.tsx',
      'src/features/auth/secure-verification/types.ts',
      'src/lib/http-client.ts',
      'src/lib/auth-session.ts',
    ],
    web,
  )
  run(
    'Native frontend tests',
    bun,
    ['run', 'test', 'src/features/lingtu', 'src/features/auth/api.test.ts', '--maxWorkers=2'],
    web,
  )
  run('Build native administration frontend', bun, ['run', 'build'], web, {
    VITE_MANAGED_API_ORIGIN: process.env.VITE_MANAGED_API_ORIGIN || 'https://api-kefu.lttlt.top',
  })
  if (buildRoot !== upstream)
    fs.cpSync(path.join(web, 'dist'), path.join(upstream, 'web', 'dist'), { recursive: true })
  run(
    'Build Linux amd64 service',
    'go',
    ['build', '-trimpath', '-o', path.join(bin, 'lingtu-managed'), '.'],
    upstream,
    { GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' },
  )
  fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(bin, 'NEW-API-LICENSE'))
  fs.writeFileSync(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        status: 'passed',
        checkedAt: new Date().toISOString(),
        node: process.versions.node,
        bun: '1.4.4',
        webBuildDirectory: web,
        database: 'isolated SQLite',
        steps,
        boundaries:
          'No production deployment, real provider credentials, buyer sends or MySQL/PostgreSQL runtime claims.',
      },
      null,
      2,
    ),
  )
} catch (error) {
  fs.writeFileSync(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        status: 'failed',
        checkedAt: new Date().toISOString(),
        steps,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
