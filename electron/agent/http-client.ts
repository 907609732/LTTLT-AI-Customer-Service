import { request } from 'node:http'
import type { z } from 'zod'
import type { agentConnectionSchema } from '../../src/shared/contracts/agent'

/** Direct loopback connection; never forward the bearer through the host's HTTP proxy. */
export function callLocalAgent(
  connection: z.output<typeof agentConnectionSchema>,
  input: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(input)
    const req = request(
      {
        hostname: '127.0.0.1',
        port: connection.port,
        path: '/v1/tools/call',
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: 'Bearer ' + connection.token,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 2 * 1024 * 1024) {
            req.destroy(Error('响应过大'))
            return
          }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          clearTimeout(timer)
          try {
            resolve({
              status: res.statusCode ?? 500,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            })
          } catch (cause) {
            reject(cause)
          }
        })
      },
    )
    const timer = setTimeout(() => req.destroy(Error('请求结果未知')), 45000)
    timer.unref()
    req.on('error', (cause) => {
      clearTimeout(timer)
      reject(cause)
    })
    req.end(body)
  })
}
