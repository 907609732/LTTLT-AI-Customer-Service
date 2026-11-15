import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { callLocalAgent } from './http-client'
import {
  agentConnectionSchema,
  agentToolSchemas,
  agentToolDescriptions,
  type AgentToolName,
} from '../../src/shared/contracts/agent'

declare const __APP_VERSION__: string
const appData =
  process.env.APPDATA ??
  (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--connection-file'))
  throw Error('用法：node lingtu-mcp.cjs [--connection-file 完整连接文件路径]')
const connectionFile = args.length
  ? args[1]!
  : join(appData, 'yunduo-ui-restored', 'ai-interface', 'connection.json')

async function invoke(tool: AgentToolName, input: unknown) {
  try {
    const connection = agentConnectionSchema.parse(JSON.parse(readFileSync(connectionFile, 'utf8')))
    const response = await callLocalAgent(connection, { tool, args: input })
    const envelope = z
      .object({
        ok: z.boolean().optional(),
        data: z.unknown().optional(),
        error: z.string().max(4000).optional(),
      })
      .parse(response.body)
    if (response.status !== 200 || !envelope.ok)
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: envelope.error || '接口请求未完成，请查看当前任务后再操作；不要自动重试写入',
          },
        ],
      }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(envelope.data) }],
      structuredContent: { data: envelope.data },
    }
  } catch {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: '灵兔AI未运行、连接已失效或请求结果未知。请打开最新版软件；写操作先查询任务或知识，不要自动重试。',
        },
      ],
    }
  }
}
serveStdio(() => {
  const server = new McpServer({ name: 'lingtu-ai', version: __APP_VERSION__ })
  function register(name: AgentToolName) {
    const schema = agentToolSchemas[name]
    const readOnly = ![
      'lingtu_open_store',
      'lingtu_start_collection',
      'lingtu_save_draft',
    ].includes(name)
    server.registerTool(
      name,
      {
        description: agentToolDescriptions[name],
        inputSchema: schema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint:
            name === 'lingtu_open_store' ||
            name === 'lingtu_read_catalog' ||
            name === 'lingtu_start_collection',
        },
      },
      async (input: unknown) => invoke(name, input),
    )
  }
  for (const name of Object.keys(agentToolSchemas)) register(name as AgentToolName)
  return server
})
