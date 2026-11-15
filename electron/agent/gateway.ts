import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** Local authenticated transport only. It never opens a generic execute, file or database route. */
export async function createAgentGateway(options: {
  directory: string
  call(input: unknown): Promise<unknown>
  connectorPath?: string
}) {
  const token = randomBytes(32).toString('hex')
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      let body = JSON.stringify(value)
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
        status = 413
        body = JSON.stringify({ ok: false, error: '结果超过2MB，请缩小分页或搜索范围；未截断资料' })
      }
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
    }
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}`) {
      send(403, { error: '仅允许本机AI连接器' })
      return
    }
    const given = Buffer.from(req.headers.authorization ?? ''),
      expected = Buffer.from('Bearer ' + token)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      send(401, { error: 'AI连接口令已过期或无效' })
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/tools/call') {
      send(404, { error: '接口不存在' })
      return
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      send(415, { error: '需要JSON请求' })
      return
    }
    try {
      if (Number(req.headers['content-length'] ?? 0) > 1024 * 1024) {
        send(413, { error: '请求超过1MB' })
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk)
        if (size > 1024 * 1024) {
          send(413, { error: '请求超过1MB' })
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const result = await options.call(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      send(200, { ok: true, data: result })
    } catch (cause) {
      send(400, {
        ok: false,
        error: cause instanceof Error ? cause.message.slice(0, 2000) : '调用失败',
      })
    }
  })
  server.requestTimeout = 60000
  server.headersTimeout = 10000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('AI接口未能监听本机端口')
  const port = address.port
  const connectionFile = join(options.directory, 'ai-interface', 'connection.json')
  try {
    mkdirSync(join(options.directory, 'ai-interface'), { recursive: true })
    writeFileSync(
      connectionFile,
      JSON.stringify({ version: 1, port, url: `http://127.0.0.1:${port}/v1/tools/call`, token }),
      { mode: 0o600 },
    )
    if (options.connectorPath)
      writeFileSync(
        join(options.directory, 'ai-interface', 'mcp-config.json'),
        JSON.stringify(
          {
            mcpServers: {
              'lingtu-ai': {
                command: 'node',
                args: [options.connectorPath, '--connection-file', connectionFile],
              },
            },
          },
          null,
          2,
        ),
        { mode: 0o600 },
      )
  } catch (cause) {
    server.close()
    throw cause
  }
  let closed = false
  return {
    connectionFile,
    async close() {
      if (closed) return
      closed = true
      try {
        const saved = JSON.parse(readFileSync(connectionFile, 'utf8')) as { token?: string }
        if (saved.token === token) unlinkSync(connectionFile)
      } catch {
        /* Another instance or damaged descriptor is never removed. */
      }
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
