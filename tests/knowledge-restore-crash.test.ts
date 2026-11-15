// @vitest-environment node
import { build } from 'esbuild'
import { fork, type ChildProcess, type ForkOptions } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge/repository'

let buildDirectory: string
let childModule: string
beforeAll(async () => {
  buildDirectory = mkdtempSync(join(tmpdir(), 'knowledge-crash-child-build-'))
  childModule = join(buildDirectory, 'runner.cjs')
  await build({
    entryPoints: ['tests/fixtures/knowledge-restore-child.ts'],
    outfile: join(buildDirectory, 'child.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
  writeFileSync(
    childModule,
    "require('./child.cjs').run(...process.argv.slice(2)).catch(error => { console.error(error); process.exit(1) })",
  )
})
afterAll(() => rmSync(buildDirectory, { recursive: true, force: true }))
function launch(mode: string, directory: string, backupDirectory = '') {
  const options: ForkOptions & { windowsHide: boolean } = {
    windowsHide: true,
    env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }
  return fork(childModule, [mode, directory, backupDirectory], options)
}
function message(
  child: ChildProcess,
): Promise<{ phase?: string; opened?: boolean; message?: string }> {
  return new Promise((resolve, reject) => {
    let errors = ''
    child.stderr?.on('data', (data: Buffer) => {
      errors += data.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Error('isolated child timed out'))
    }, 10000)
    child.once('message', (value) => {
      clearTimeout(timer)
      resolve(value as { phase?: string; opened?: boolean; message?: string })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(Error(`child exited before message: ${code}: ${errors}`))
    })
    child.once('error', reject)
  })
}
async function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGKILL')
  await exited
}
function disk(directory: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((item) => item.isFile())
      .map((item) => {
        const path = join(item.parentPath, item.name)
        return [path, createHash('sha256').update(readFileSync(path)).digest('hex')]
      }),
  )
}
it.each(['knowledge.sqlite', 'knowledge.sqlite-wal', 'knowledge.sqlite-shm', 'installed'])(
  'fails closed on fresh owner startup after a real process kill at %s replacement',
  async (phase) => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-restore-crash-'))
    const directory = join(root, 'account')
    let child: ChildProcess | undefined
    const repo = createKnowledgeRepository({ directory, workspaceId: 'seed' })
    try {
      repo.saveCanonical({ title: 'snapshot knowledge' })
      const backup = repo.createBackup(join(root, 'backups'))
      repo.saveCanonical({ title: 'old knowledge retained' })
      repo.dispose()
      child = launch('wal', directory)
      expect((await message(child)).phase).toBe('wal-ready')
      await kill(child)
      child = undefined
      expect(existsSync(join(directory, 'knowledge.sqlite-wal'))).toBe(true)
      expect(existsSync(join(directory, 'knowledge.sqlite-shm'))).toBe(true)
      const before = disk(directory)
      child = launch(`restore:${phase}`, directory, backup.directory)
      expect((await message(child)).phase).toBe(phase)
      await kill(child)
      child = undefined
      const interrupted = disk(directory)
      child = launch('open', directory)
      const started = await message(child)
      await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
      child = undefined
      expect(started.opened).toBe(false)
      expect(started.message).toContain('恢复中断')
      expect(started.message).toContain(directory)
      expect(disk(directory)).toEqual(interrupted)
      expect(Object.values(interrupted)).toEqual(expect.arrayContaining(Object.values(before)))
      expect(
        readdirSync(directory).some((name) => /^knowledge-restore-.*\.sqlite$/.test(name)),
      ).toBe(true)
    } finally {
      if (child) await kill(child)
      repo.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  },
  20000,
)
