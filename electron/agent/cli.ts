import { parseArgs } from 'node:util'
import { z } from 'zod'
import { callLocalAgent } from './http-client'
import { defaultAgentConnectionFile, readAgentConnection } from './connection-file'
import type { AgentToolName } from '../../src/shared/contracts/agent'

declare const __APP_VERSION__: string

const help = `灵兔AI本机配置命令行 ${__APP_VERSION__}

用法:
  lingtu-cli.cjs status [--connection-file <路径>]
  lingtu-cli.cjs stores --json <JSON> [--connection-file <路径>]
  lingtu-cli.cjs config schema [--json <JSON>] [--connection-file <路径>]
  lingtu-cli.cjs config get --json <JSON> [--connection-file <路径>]
  lingtu-cli.cjs config preview --json <JSON> [--connection-file <路径>]
  lingtu-cli.cjs config apply --json <JSON> [--connection-file <路径>]

--json 也可省略并从 stdin 读取 JSON。输出为结构化 JSON；失败时退出码非0。
config get 参数示例:
  {"workspaceId":"...","group":"welcome","storeId":"..."}
先运行 status 获取 workspaceId，再用 stores {"workspaceId":"..."} 查询 storeId。
config preview 额外接受 "patch"；config apply 还须唯一 "requestId"，并将
get/preview 返回的 "version" 填入 "expectedVersion"。分组固定为 reply-pacing、welcome、vision。
写操作不会自动重试；结果未知时先重新读取配置。请先启动最新版灵兔AI。
`

class UsageError extends Error {}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new UsageError('缺少 --json，且标准输入不是管道'))
      return
    }
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

async function readJson(value: string | undefined): Promise<unknown> {
  const text = value ?? (await readStdin())
  if (!text.trim()) throw new UsageError('缺少JSON参数：请使用 --json 或通过stdin提供')
  try {
    return JSON.parse(text)
  } catch {
    throw new UsageError('JSON参数无效')
  }
}

function resolveCommand(
  positionals: string[],
): { tool: AgentToolName; needsJson: boolean } | undefined {
  if (!positionals.length) return undefined
  if (positionals[0] === 'status') {
    if (positionals.length > 1) throw new UsageError('status不接受子命令')
    return { tool: 'lingtu_status', needsJson: false }
  }
  if (positionals[0] === 'stores') {
    if (positionals.length > 1) throw new UsageError('stores不接受子命令')
    return { tool: 'lingtu_list_stores', needsJson: true }
  }
  if (positionals[0] !== 'config') throw new UsageError('未知命令；使用 --help 查看用法')
  const subcommand = positionals[1]
  if (positionals.length > 2) throw new UsageError('config子命令参数过多')
  if (subcommand === 'schema') return { tool: 'lingtu_config_schema', needsJson: false }
  if (subcommand === 'get') return { tool: 'lingtu_get_config', needsJson: true }
  if (subcommand === 'preview') return { tool: 'lingtu_preview_config', needsJson: true }
  if (subcommand === 'apply') return { tool: 'lingtu_apply_config', needsJson: true }
  throw new UsageError('config子命令必须是 schema、get、preview 或 apply')
}

const envelopeSchema = z
  .object({
    ok: z.boolean().optional(),
    data: z.unknown().optional(),
    error: z.string().max(4000).optional(),
  })
  .passthrough()

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'string' },
      'connection-file': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  })
  if (values.help) {
    process.stdout.write(help)
    return
  }
  const command = resolveCommand(positionals)
  if (!command) {
    process.stdout.write(help)
    return
  }
  const input = command.needsJson
    ? await readJson(values.json)
    : values.json === undefined
      ? {}
      : await readJson(values.json)
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new UsageError('JSON参数必须是对象')
  const connection = readAgentConnection(values['connection-file'] ?? defaultAgentConnectionFile())
  const response = await callLocalAgent(connection, { tool: command.tool, args: input })
  const envelope = envelopeSchema.parse(response.body)
  if (response.status !== 200 || !envelope.ok)
    throw new Error(envelope.error || '接口请求未完成；写操作结果未知时先重新读取，不要自动重试')
  process.stdout.write(JSON.stringify({ ok: true, data: envelope.data }) + '\n')
}

main().catch((cause: unknown) => {
  const usage = cause instanceof UsageError
  const message =
    cause instanceof Error
      ? cause.message.slice(0, 2000)
      : '调用失败；请确认灵兔AI已启动并重新读取连接文件'
  process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n')
  process.exitCode = usage ? 2 : 1
})
