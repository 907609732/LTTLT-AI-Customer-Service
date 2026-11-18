import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentConnectionSchema } from '../../src/shared/contracts/agent'

/** Same default the desktop writes; connectors never accept a port/token argument. */
export function defaultAgentConnectionFile(): string {
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')))
  return join(appData, 'yunduo-ui-restored', 'ai-interface', 'connection.json')
}

export function readAgentConnection(file: string) {
  try {
    return agentConnectionSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    // JSON parser errors can quote private descriptor contents; never return them to an AI client.
    throw Error('本机连接文件不可用或格式无效，请启动最新版灵兔AI并使用该实例的连接文件')
  }
}
