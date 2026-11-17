import type { LogEntry } from '../../src/shared/contracts/review'
import type {
  DeveloperDebugGmRequest,
  DeveloperDebugGmResult,
} from '../../src/shared/contracts/developer-debug'

export interface GmStore {
  id: string
  storeName: string
  platform: string
  open: boolean
  online: boolean
  authenticated?: boolean | null
  aiEnabled: boolean
  sendMode: 'review' | 'auto'
}
export interface GmPopupStatus {
  mode: 'allow' | 'block'
  applied: boolean
  url: string
  message: string
}
export interface GmPopupPort {
  status(storeId: string): GmPopupStatus
  set(storeId: string, mode: 'allow' | 'block'): GmPopupStatus
}
export interface GmTerminalStatus {
  connected: boolean
  cwd: string
  sessionId: string
}
export interface GmRegistryOptions {
  workspaceId: string
  appVersion: string
  stores(): GmStore[]
  logs(): LogEntry[]
  popup: GmPopupPort
  terminal(): GmTerminalStatus
}

const MAX_OUTPUT = 12000
const MAX_LOG_LINES = 80
const MAX_LOGS = 100
const redact = (value: string) =>
  value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|pk)-[a-zA-Z0-9_-]{8,}/g, '[密钥已隐藏]')
    .replace(
      /(api[-_ ]?key|authorization|cookie|password|secret|access[-_ ]?token|refresh[-_ ]?token)(\s*[:=]\s*)([^\s,;}"']+)/gi,
      '$1$2[已隐藏]',
    )
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, '$1[已隐藏]')
const truncate = (value: string) =>
  redact(value).length > MAX_OUTPUT
    ? `${redact(value).slice(0, MAX_OUTPUT)}\n[输出已达上限，已截断]`
    : redact(value)

/** 不做 JS 求值；每条命令仅读取本进程的显式有界投影。 */
export function createGmRegistry(options: GmRegistryOptions) {
  const store = (id: string | undefined) => {
    if (!id) throw new Error('请先选择店铺')
    const target = options.stores().find((row) => row.id === id)
    if (!target) throw new Error('店铺不存在或已移除')
    return target
  }
  const commands: Record<string, (args: string[], request: DeveloperDebugGmRequest) => string> = {
    help: () =>
      [
        '可用命令：',
        '  help                     显示本帮助',
        '  status                   当前源码调试、工作区与窗口状态',
        '  stores                   本机店铺及平台/在线状态（不含凭据）',
        '  logs [数量]              最近运行日志，默认 20，范围 1～100',
        '  pdd-popup status         查看所选拼多多店铺的本次弹窗策略',
        '  pdd-popup allow          允许所选店铺的常规 HTTP(S)/about:blank 新窗口',
        '  pdd-popup block          恢复厂商默认：外部浏览器打开并拒绝内嵌新窗',
        '',
        '命令只作用于当前源码监控窗口和当前工作区；不提供任意 JS、exec 或发送买家消息。',
        'GM 成功不代表买家回复已发送，发送仍以回复批准和平台回执为准。',
      ].join('\n'),
    status: () => {
      const stores = options.stores()
      const pdd = stores.filter((row) => row.platform === 'pdd-web')
      const terminal = options.terminal()
      return [
        `版本: v${options.appVersion}（源码调试）`,
        `工作区: ${options.workspaceId}`,
        `店铺: ${stores.length} 家，拼多多 ${pdd.length} 家`,
        `终端: ${terminal.connected ? `已连接 ${terminal.cwd}` : '未连接'}`,
        '调试能力仅绑定当前回复监控窗口的服务主 frame，不向平台页或其他窗口开放。',
      ].join('\n')
    },
    stores: () => {
      const rows = options.stores()
      if (!rows.length) return '当前工作区没有店铺。'
      return rows
        .slice(0, 50)
        .map((row) => {
          const state = row.open ? (row.online ? '在线' : '已打开/未在线') : '未打开'
          const auth =
            row.authenticated === true
              ? '已登录'
              : row.authenticated === false
                ? '未登录'
                : '登录未知'
          return `${row.id} | ${row.storeName} | ${row.platform} | ${state} | ${auth} | AI:${
            row.aiEnabled ? '开' : '关'
          } | ${row.sendMode === 'auto' ? '自动发送' : '审核发送'}${
            row.platform === 'pdd-web' ? ' | mms.pinduoduo.com' : ''
          }`
        })
        .join('\n')
    },
    logs: (args) => {
      if (args.length > 1) throw new Error('用法：logs [数量]，例如 logs 20 或 logs[20]')
      const raw = args[0] ?? '20'
      if (!/^\d+$/.test(raw)) throw new Error('logs 数量必须是 1～100 的整数')
      const count = Number(raw)
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_LOGS)
        throw new Error('logs 数量必须在 1～100 之间')
      const rows = options.logs().slice(-count).slice(-MAX_LOG_LINES)
      if (!rows.length) return '本次运行暂无日志。'
      return rows
        .map((row) => {
          const time = new Date(row.at).toLocaleTimeString('zh-CN', { hour12: false })
          const reason = row.ai?.reason ? ` | ${row.ai.reason}` : ''
          return `[${time}] ${row.kind} | ${row.storeName || '全局'} | ${
            row.buyerName || row.uid || '—'
          }${reason}\n${row.text.slice(0, 500)}`
        })
        .join('\n')
    },
  }

  function pddPopup(args: string[], request: DeveloperDebugGmRequest) {
    if (args.length !== 1) throw new Error('用法：pdd-popup status|allow|block')
    const target = store(request.storeId)
    if (target.platform !== 'pdd-web')
      throw new Error('pdd-popup 仅支持当前工作区中的拼多多内嵌店铺')
    const action = args[0]
    if (action === 'status') {
      const value = options.popup.status(target.id)
      return [
        `店铺: ${target.storeName} (${target.id})`,
        `策略: ${value.mode === 'allow' ? 'allow' : 'block（厂商默认）'}`,
        `生效: ${value.applied ? '是' : '否'}${value.url ? ` | ${value.url}` : ''}`,
        value.message || '策略只在本次源码运行内有效，重启恢复默认。',
      ].join('\n')
    }
    if (action !== 'allow' && action !== 'block')
      throw new Error('未知 pdd-popup 操作，仅支持 status、allow、block')
    const value = options.popup.set(target.id, action)
    return [
      `店铺: ${target.storeName} (${target.id})`,
      `已${action === 'allow' ? '允许常规网页新窗口' : '恢复厂商默认外部打开并拒绝新窗口'}。`,
      `当前生效: ${value.applied ? '是' : '否'}${value.url ? ` | ${value.url}` : ''}`,
      value.message,
      '未改变验证码、登录、网页 window.close、回复批准或发送行为；正常重启恢复默认。',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return {
    run(request: DeveloperDebugGmRequest): DeveloperDebugGmResult {
      try {
        if (request.workspaceId !== options.workspaceId)
          throw new Error('工作区已变化，请重新打开回复监控')
        const input = request.input.trim()
        if (!input) throw new Error('请输入 GM 命令；输入 help 查看可用命令')
        const normalized = input.replace(/^(logs)\[(\d+)\]$/i, '$1 $2')
        const tokens = normalized.split(/\s+/)
        const name = (tokens.shift() ?? '').toLowerCase()
        if (!name) throw new Error('请输入 GM 命令')
        if (name === 'pdd-popup') return { ok: true, text: truncate(pddPopup(tokens, request)) }
        const command = commands[name]
        if (!command)
          return { ok: false, text: truncate(`未知命令: ${name}；输入 help 查看可用命令。`) }
        if (['help', 'status', 'stores'].includes(name) && tokens.length)
          throw new Error(`命令 ${name} 不接受参数`)
        return { ok: true, text: truncate(command(tokens, request)) }
      } catch (error) {
        return {
          ok: false,
          text: truncate(error instanceof Error ? error.message : String(error)),
        }
      }
    },
  }
}
export type GmRegistry = ReturnType<typeof createGmRegistry>
